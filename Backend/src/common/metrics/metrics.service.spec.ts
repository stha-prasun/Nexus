import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  it('tracks totals, error rate and per-route stats', () => {
    metrics.observeHttp({ route: 'GET /health', status: 200, durationMs: 12 });
    metrics.observeHttp({ route: 'GET /health', status: 200, durationMs: 8 });
    metrics.observeHttp({ route: 'POST /orders', status: 500, durationMs: 30 });
    metrics.observeHttp({ route: 'POST /orders', status: 404, durationMs: 5 });

    const snapshot = metrics.snapshot();
    expect(snapshot.http.requests).toMatchObject({
      total: 4,
      errors: 1,
      clientErrors: 1,
      errorRatePct: 25,
    });
    expect(snapshot.http.latencyMs).toMatchObject({
      count: 4,
      min: 5,
      max: 30,
      avg: 13.75,
    });
    expect(snapshot.http.routes['GET /health']).toMatchObject({
      count: 2,
      errors: 0,
    });
    expect(snapshot.http.routes['POST /orders']).toMatchObject({
      count: 2,
      errors: 1,
      clientErrors: 1,
    });
  });

  it('computes the request rate from the sliding window', () => {
    metrics.observeHttp({ route: 'GET /', status: 200, durationMs: 1 });

    const snapshot = metrics.snapshot();
    expect(snapshot.http.requests.rateWindowSec).toBeGreaterThan(0);
    expect(snapshot.http.requests.ratePerSec).toBeCloseTo(
      1 / snapshot.http.requests.rateWindowSec,
      6,
    );
  });

  it('reports zero rate and error rate with no traffic', () => {
    const snapshot = metrics.snapshot();
    expect(snapshot.http.requests).toMatchObject({
      total: 0,
      errorRatePct: 0,
      ratePerSec: 0,
    });
  });

  it('tracks dependency counts, errors and latency', () => {
    metrics.observeDependency('postgres', 4, true);
    metrics.observeDependency('postgres', 6, false);
    metrics.observeDependency('redis', 1, true);

    const snapshot = metrics.snapshot();
    expect(snapshot.dependencies.postgres).toMatchObject({
      count: 2,
      errors: 1,
    });
    expect(snapshot.dependencies.postgres.latencyMs.max).toBe(6);
    expect(snapshot.dependencies.redis).toMatchObject({ count: 1, errors: 0 });
  });

  it('exposes process gauges', () => {
    const { process: proc } = metrics.snapshot();
    expect(proc.memory.rssBytes).toBeGreaterThan(0);
    expect(proc.memory.heapUsagePct).toBeGreaterThan(0);
    expect(proc.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(proc.eventLoopLagMs.p50).toBeGreaterThanOrEqual(0);
    expect(proc.eventLoopLagMs.p99).toBeGreaterThanOrEqual(0);
  });

  it('keeps snapshot() pure — repeated reads do not change counters', () => {
    metrics.observeHttp({ route: 'GET /', status: 200, durationMs: 1 });
    const first = metrics.snapshot();
    const second = metrics.snapshot();
    expect(second.http.requests.total).toBe(first.http.requests.total);
    expect(second.http.latencyMs.count).toBe(first.http.latencyMs.count);
  });
});
