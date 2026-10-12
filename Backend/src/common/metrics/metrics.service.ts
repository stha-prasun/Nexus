import { type ELDHistogram, monitorEventLoopDelay } from 'node:perf_hooks';
import { Injectable } from '@nestjs/common';
import { RATE_WINDOW_SEC } from '../constants/observability.constants';
import { type LatencySummary, Reservoir, summarize } from './stats';

export interface RouteStats {
  count: number;
  errors: number;
  clientErrors: number;
  latencyMs: LatencySummary;
}

export interface DependencyStats {
  count: number;
  errors: number;
  latencyMs: LatencySummary;
}

export interface MetricsSnapshot {
  timestamp: string;
  uptimeSec: number;
  http: {
    requests: {
      total: number;
      errors: number;
      clientErrors: number;
      errorRatePct: number;
      ratePerSec: number;
      rateWindowSec: number;
    };
    latencyMs: LatencySummary;
    routes: Record<string, RouteStats>;
  };
  dependencies: Record<string, DependencyStats>;
  process: {
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
      externalBytes: number;
      heapUsagePct: number;
    };
    cpuPercent: number;
    eventLoopLagMs: {
      p50: number;
      p95: number;
      p99: number;
      max: number;
    };
  };
}

interface Track {
  count: number;
  errors: number;
  clientErrors: number;
  reservoir: Reservoir;
}

const newTrack = (capacity: number): Track => ({
  count: 0,
  errors: 0,
  clientErrors: 0,
  reservoir: new Reservoir(capacity),
});

const routeStatsOf = (track: Track): RouteStats => ({
  count: track.count,
  errors: track.errors,
  clientErrors: track.clientErrors,
  latencyMs: summarize(track.reservoir.toArray()),
});

const dependencyStatsOf = (track: Track): DependencyStats => ({
  count: track.count,
  errors: track.errors,
  latencyMs: summarize(track.reservoir.toArray()),
});

/**
 * In-memory metrics registry: sliding-window latency reservoirs, request and
 * error counters, dependency timings and process gauges. Read through
 * `snapshot()` (JSON at GET /metrics) or the periodic colored summary.
 */
@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly httpLatency = new Reservoir(2048);
  private readonly timestamps = new Reservoir(4096);
  private readonly routes = new Map<string, Track>();
  private readonly dependencies = new Map<string, Track>();
  private total = 0;
  private errors = 0;
  private clientErrors = 0;
  private readonly loopDelay: ELDHistogram = monitorEventLoopDelay({
    resolution: 10,
  });
  private cpuUsage = process.cpuUsage();
  private cpuSampledAt = Date.now();

  observeHttp(input: {
    route: string;
    status: number;
    durationMs: number;
  }): void {
    const { route, status, durationMs } = input;
    const isError = status >= 500;
    const isClientError = status >= 400 && status < 500;

    this.total += 1;
    if (isError) this.errors += 1;
    else if (isClientError) this.clientErrors += 1;

    this.httpLatency.push(durationMs);
    this.timestamps.push(Date.now());

    const track = this.trackFor(this.routes, route, 512);
    track.count += 1;
    if (isError) track.errors += 1;
    else if (isClientError) track.clientErrors += 1;
    track.reservoir.push(durationMs);
  }

  observeDependency(system: string, durationMs: number, ok: boolean): void {
    const track = this.trackFor(this.dependencies, system, 1024);
    track.count += 1;
    if (!ok) track.errors += 1;
    track.reservoir.push(durationMs);
  }

  /** Pure read of the current metrics; never mutates counters. */
  snapshot(): MetricsSnapshot {
    const now = Date.now();
    const windowStart = now - RATE_WINDOW_SEC * 1000;
    const recent = this.timestamps.toArray().filter((t) => t >= windowStart);
    const errorRatePct = this.total > 0 ? (this.errors / this.total) * 100 : 0;

    const routes: Record<string, RouteStats> = {};
    for (const [route, track] of this.routes) {
      routes[route] = routeStatsOf(track);
    }

    const dependencies: Record<string, DependencyStats> = {};
    for (const [system, track] of this.dependencies) {
      dependencies[system] = dependencyStatsOf(track);
    }

    const memory = process.memoryUsage();
    const heapUsagePct =
      memory.heapTotal > 0 ? (memory.heapUsed / memory.heapTotal) * 100 : 0;

    return {
      timestamp: new Date(now).toISOString(),
      uptimeSec: (now - this.startedAt) / 1000,
      http: {
        requests: {
          total: this.total,
          errors: this.errors,
          clientErrors: this.clientErrors,
          errorRatePct,
          ratePerSec: recent.length / RATE_WINDOW_SEC,
          rateWindowSec: RATE_WINDOW_SEC,
        },
        latencyMs: summarize(this.httpLatency.toArray()),
        routes,
      },
      dependencies,
      process: {
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
          externalBytes: memory.external,
          heapUsagePct,
        },
        cpuPercent: this.sampleCpuPercent(),
        eventLoopLagMs: {
          p50: this.loopDelay.percentile(50) / 1e6,
          p95: this.loopDelay.percentile(95) / 1e6,
          p99: this.loopDelay.percentile(99) / 1e6,
          max: this.loopDelay.max / 1e6,
        },
      },
    };
  }

  /**
   * Clears the event-loop lag window so the next periodic summary reports
   * only what happened since the previous one.
   */
  resetEventLoopWindow(): void {
    this.loopDelay.reset();
  }

  // --- internals ----------------------------------------------------------

  private trackFor(
    map: Map<string, Track>,
    key: string,
    capacity: number,
  ): Track {
    let track = map.get(key);
    if (!track) {
      track = newTrack(capacity);
      map.set(key, track);
    }
    return track;
  }

  private sampleCpuPercent(): number {
    const now = Date.now();
    const usage = process.cpuUsage();
    const elapsedUs = (now - this.cpuSampledAt) * 1000;
    const usedUs =
      usage.user - this.cpuUsage.user + (usage.system - this.cpuUsage.system);
    this.cpuUsage = usage;
    this.cpuSampledAt = now;
    if (elapsedUs <= 0) return 0;
    return Math.max(0, (usedUs / elapsedUs) * 100);
  }
}
