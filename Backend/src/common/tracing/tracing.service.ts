import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { errorMessage } from '../format';
import { MetricsService } from '../metrics/metrics.service';
import {
  currentContext,
  newTraceId,
  runInContext,
  type Span,
  type SpanSystem,
  type Trace,
  type TraceContext,
} from './trace-context';

export interface SpanHandle {
  /** Runs `fn` with this span as the parent for any nested spans it opens. */
  run<T>(fn: () => T): T;
  /** Ends the span (idempotent) and records it + its metrics. */
  end(error?: unknown): void;
}

/**
 * Trace lifecycle: one Trace per HTTP request, child spans for every
 * instrumented dependency call (postgres / redis / minio). The trace is kept
 * in AsyncLocalStorage so nested calls find their parent without plumbing
 * context through every signature.
 */
@Injectable()
export class TracingService {
  constructor(private readonly metrics: MetricsService) {}

  /** Creates a trace with its root (HTTP) span already registered. */
  startTrace(label: string, id?: string): Trace {
    const trace: Trace = {
      id: id ?? newTraceId(),
      label,
      startedAt: Date.now(),
      spans: [],
    };
    trace.spans.push({
      id: 'root',
      system: 'http',
      name: label,
      startMs: 0,
      durationMs: 0,
      status: 'ok',
      isRoot: true,
    });
    return trace;
  }

  /** Executes `fn` inside the trace's async context. */
  run<T>(trace: Trace, fn: () => T): T {
    return runInContext({ trace, currentSpanId: 'root', depths: {} }, fn);
  }

  /** True while a span for `system` is open in the current context. */
  isInside(system: SpanSystem): boolean {
    return (currentContext()?.depths[system] ?? 0) > 0;
  }

  /**
   * Opens a child span under whatever span is currently active. Outside a
   * trace (background code) the span only feeds metrics.
   */
  begin(system: SpanSystem, name: string): SpanHandle {
    const parent = currentContext();
    const span: Span = {
      id: randomBytes(4).toString('hex'),
      parentId: parent?.currentSpanId,
      system,
      name,
      startMs: performance.now(),
      status: 'ok',
    };

    const childContext: TraceContext | undefined = parent
      ? {
          trace: parent.trace,
          currentSpanId: span.id,
          depths: {
            ...parent.depths,
            [system]: (parent.depths[system] ?? 0) + 1,
          },
        }
      : undefined;

    let ended = false;
    const end = (error?: unknown): void => {
      if (ended) return;
      ended = true;
      span.durationMs = performance.now() - span.startMs;
      if (error !== undefined && error !== null) {
        span.status = 'error';
        span.error = errorMessage(error);
      }
      parent?.trace.spans.push(span);
      if (system !== 'http') {
        this.metrics.observeDependency(
          system,
          span.durationMs,
          span.status === 'ok',
        );
      }
    };

    return {
      run: <T>(fn: () => T): T =>
        childContext ? runInContext(childContext, fn) : fn(),
      end,
    };
  }
}
