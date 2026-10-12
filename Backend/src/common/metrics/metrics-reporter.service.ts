import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  ERROR_RATE_RED_PCT,
  HEAP_WARN_RATIO,
  METRICS_INTERVAL_MS,
} from '../constants/observability.constants';
import {
  byTone,
  colorLatency,
  formatBytes,
  formatDuration,
  formatPercent,
  latencyTone,
  padEnd,
  type Tone,
} from '../format';
import { dim, gray } from '../logger/colors';
import { AppLogger } from '../logger/logger';
import { MetricsService } from './metrics.service';

const worstTone = (...tones: Tone[]): Tone => {
  if (tones.includes('error')) return 'error';
  if (tones.includes('warn')) return 'warn';
  return 'ok';
};

const worstLatencyTone = (samples: number[]): Tone =>
  worstTone(...samples.map((ms) => latencyTone(ms)));

/**
 * Logs a compact colored metrics block every METRICS_INTERVAL_MS:
 *
 *   14:05:00.000  INFO [metrics] 30s · 62 req · 2.1 req/s · err 0 (0.0%)
 *                    http  p50 8.0ms  p95 42.0ms  p99 120ms
 *                    deps  postgres p95 4.0ms · redis p95 1.0ms
 *                    proc  rss 92.1MB · heap 45.2/128MB · cpu 3.2% · loop p99 1.8ms
 */
@Injectable()
export class MetricsReporterService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly log: ReturnType<AppLogger['child']>;
  private timer?: NodeJS.Timeout;
  private windowStartTotal = 0;
  private windowStartErrors = 0;

  constructor(
    private readonly metrics: MetricsService,
    logger: AppLogger,
  ) {
    this.log = logger.child('metrics');
  }

  onApplicationBootstrap(): void {
    const snapshot = this.metrics.snapshot();
    this.windowStartTotal = snapshot.http.requests.total;
    this.windowStartErrors = snapshot.http.requests.errors;
    // 0 (or anything below a second) disables the periodic summary.
    if (METRICS_INTERVAL_MS < 1000) return;
    this.timer = setInterval(() => this.report(), METRICS_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  report(): void {
    try {
      const snapshot = this.metrics.snapshot();
      const windowSec = METRICS_INTERVAL_MS / 1000;

      const totalDelta = snapshot.http.requests.total - this.windowStartTotal;
      const errorDelta = snapshot.http.requests.errors - this.windowStartErrors;
      this.windowStartTotal = snapshot.http.requests.total;
      this.windowStartErrors = snapshot.http.requests.errors;

      const ratePerSec = totalDelta / windowSec;
      const errorRatePct = totalDelta > 0 ? (errorDelta / totalDelta) * 100 : 0;

      const latency = snapshot.http.latencyMs;
      const headerTone = worstTone(
        errorDelta > 0
          ? errorRatePct >= ERROR_RATE_RED_PCT
            ? 'error'
            : 'warn'
          : 'ok',
        latencyTone(latency.p95),
      );

      const header = [
        byTone(headerTone, `${windowSec}s`),
        gray(`${totalDelta} req`),
        gray(`${ratePerSec.toFixed(1)} req/s`),
        errorDelta > 0
          ? byTone(
              headerTone,
              `err ${errorDelta} (${formatPercent(errorRatePct)})`,
            )
          : gray('err 0 (0.0%)'),
      ].join(' · ');

      const trailer = [
        this.httpLine(snapshot),
        this.dependenciesLine(snapshot),
        this.processLine(snapshot),
      ].join('\n');

      if (headerTone === 'error') this.log.error(header, undefined, trailer);
      else if (headerTone === 'warn') this.log.warn(header, undefined, trailer);
      else this.log.info(header, undefined, trailer);

      this.metrics.resetEventLoopWindow();
    } catch (error) {
      this.log.error(
        `metrics report failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // --- lines --------------------------------------------------------------

  private httpLine(snapshot: ReturnType<MetricsService['snapshot']>): string {
    const { p50, p95, p99 } = snapshot.http.latencyMs;
    return `  ${padEnd('http', 6)}${gray(`p50 ${formatDuration(p50)}`)}  ${colorLatency(p95, `p95 ${formatDuration(p95)}`)}  ${gray(`p99 ${formatDuration(p99)}`)}`;
  }

  private dependenciesLine(
    snapshot: ReturnType<MetricsService['snapshot']>,
  ): string {
    const entries = Object.entries(snapshot.dependencies);
    if (entries.length === 0) {
      return `  ${padEnd('deps', 6)}${gray('no traffic')}`;
    }
    const parts = entries.map(([system, stats]) => {
      const tone = latencyTone(stats.latencyMs.p95);
      const value =
        stats.count === 0
          ? gray('-')
          : byTone(tone, formatDuration(stats.latencyMs.p95));
      return `${system} ${value}`;
    });
    const tone = worstLatencyTone(
      entries.map(([, stats]) => stats.latencyMs.p95),
    );
    const label = byTone(tone, padEnd('deps', 6));
    return `  ${label}${dim(parts.join(dim(' · ')))}`;
  }

  private processLine(
    snapshot: ReturnType<MetricsService['snapshot']>,
  ): string {
    const { memory, cpuPercent, eventLoopLagMs } = snapshot.process;
    const heapTone: Tone =
      memory.heapUsagePct >= HEAP_WARN_RATIO * 100 ? 'warn' : 'ok';
    const loopTone = latencyTone(eventLoopLagMs.p99);

    const rss = gray(`rss ${formatBytes(memory.rssBytes)}`);
    const heap = byTone(
      heapTone,
      `heap ${formatBytes(memory.heapUsedBytes)}/${formatBytes(memory.heapTotalBytes)}`,
    );
    const cpu = gray(`cpu ${cpuPercent.toFixed(1)}%`);
    const loop = byTone(
      loopTone,
      `loop p99 ${formatDuration(eventLoopLagMs.p99)}`,
    );

    return `  ${padEnd('proc', 6)}${[rss, heap, cpu, loop].join(gray(' · '))}`;
  }
}
