import { MetricsService } from '../metrics/metrics.service';
import { TracingService } from './tracing.service';

describe('TracingService', () => {
  let tracing: TracingService;
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
    tracing = new TracingService(metrics);
  });

  it('creates a trace with an http root span and the given id', () => {
    const trace = tracing.startTrace('GET /orders', 'abc123');

    expect(trace.id).toBe('abc123');
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0]).toMatchObject({
      id: 'root',
      system: 'http',
      isRoot: true,
      status: 'ok',
    });
  });

  it('generates a hex trace id when none is provided', () => {
    const trace = tracing.startTrace('GET /orders');
    expect(trace.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('parents child spans under the root and records metrics', () => {
    const trace = tracing.startTrace('GET /orders');

    tracing.run(trace, () => {
      const handle = tracing.begin('postgres', 'SELECT 1');
      handle.end();
    });

    expect(trace.spans).toHaveLength(2);
    expect(trace.spans[1]).toMatchObject({
      parentId: 'root',
      system: 'postgres',
      name: 'SELECT 1',
      status: 'ok',
    });
    expect(trace.spans[1].durationMs).toBeGreaterThanOrEqual(0);
    expect(metrics.snapshot().dependencies.postgres.count).toBe(1);
  });

  it('nests spans opened inside handle.run under that span', () => {
    const trace = tracing.startTrace('GET /orders');

    tracing.run(trace, () => {
      const outer = tracing.begin('postgres', 'outer');
      outer.run(() => {
        const inner = tracing.begin('redis', 'inner');
        inner.end();
      });
      outer.end();
    });

    const [root, inner, outer] = trace.spans;
    expect(inner.parentId).toBe(outer.id);
    expect(outer.parentId).toBe(root.id);
    expect(inner.startMs).toBeGreaterThanOrEqual(outer.startMs);
  });

  it('reports isInside only while a span for that system is open', () => {
    expect(tracing.isInside('postgres')).toBe(false);

    const trace = tracing.startTrace('GET /orders');
    tracing.run(trace, () => {
      expect(tracing.isInside('postgres')).toBe(false);
      const handle = tracing.begin('postgres', 'SELECT 1');
      handle.run(() => {
        expect(tracing.isInside('postgres')).toBe(true);
      });
      handle.end();
      expect(tracing.isInside('postgres')).toBe(false);
    });
  });

  it('records metrics for spans opened outside a trace', () => {
    const handle = tracing.begin('redis', 'ping');
    expect(() => handle.end()).not.toThrow();
    expect(metrics.snapshot().dependencies.redis.count).toBe(1);
  });

  it('marks errored spans with the error message', () => {
    const trace = tracing.startTrace('GET /orders');

    tracing.run(trace, () => {
      tracing.begin('postgres', 'SELECT 1').end(new Error('boom'));
    });

    expect(trace.spans[1]).toMatchObject({
      status: 'error',
      error: 'boom',
    });
  });

  it('treats end() as idempotent', () => {
    const trace = tracing.startTrace('GET /orders');

    tracing.run(trace, () => {
      const handle = tracing.begin('redis', 'ping');
      handle.end();
      handle.end();
    });

    expect(trace.spans).toHaveLength(2);
    expect(metrics.snapshot().dependencies.redis.count).toBe(1);
  });

  it('never records http spans as a dependency', () => {
    const trace = tracing.startTrace('GET /orders');

    tracing.run(trace, () => {
      tracing.begin('http', 'inner').end();
    });

    expect(metrics.snapshot().dependencies.http).toBeUndefined();
  });
});
