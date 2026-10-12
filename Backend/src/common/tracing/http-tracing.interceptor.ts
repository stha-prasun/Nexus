import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { catchError, Observable, throwError } from 'rxjs';
import { LATENCY_WARN_MS } from '../constants/observability.constants';
import {
  byTone,
  colorLatency,
  errorMessage,
  formatDuration,
  type Tone,
} from '../format';
import { dim, red } from '../logger/colors';
import { AppLogger } from '../logger/logger';
import { MetricsService } from '../metrics/metrics.service';
import type { Trace } from './trace-context';
import { TracingService } from './tracing.service';
import { renderWaterfall } from './waterfall';

interface TracedRequest {
  method: string;
  baseUrl?: string;
  originalUrl?: string;
  route?: { path?: string };
  headers: Record<string, string | string[] | undefined>;
}

const routeLabel = (req: TracedRequest): string => {
  const routePath = req.route?.path;
  const path =
    typeof routePath === 'string'
      ? `${req.baseUrl ?? ''}${routePath}`
      : (req.originalUrl ?? '/').split('?')[0];
  return `${req.method} ${path}`;
};

const incomingTraceId = (req: TracedRequest): string | undefined => {
  const raw = req.headers['x-request-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : undefined;
};

const outcomeTone = (status: number, hasError: boolean): Tone => {
  if (hasError || status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'ok';
};

/**
 * One line per request plus the dependency waterfall:
 *
 *   14:03:11.120  INFO  [http] 200 GET /health · 12.4ms · trace 9f2c1ab3
 *   ├── postgres SELECT 1      3.1ms    25%
 *   └── redis ping              1.2ms    10%
 *
 * Green = success, yellow = client error / slow, red = server error.
 */
@Injectable()
export class HttpTracingInterceptor implements NestInterceptor {
  private readonly log: ReturnType<AppLogger['child']>;

  constructor(
    private readonly tracing: TracingService,
    private readonly metrics: MetricsService,
    logger: AppLogger,
  ) {
    this.log = logger.child('http');
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<TracedRequest>();
    const res = http.getResponse<Response>();

    const trace = this.tracing.startTrace(
      routeLabel(req),
      incomingTraceId(req),
    );
    res.setHeader('x-request-id', trace.id);

    let completed = false;
    const finish = (aborted: boolean): void => {
      if (completed) return;
      completed = true;
      this.complete(trace, res, aborted);
    };
    res.on('finish', () => finish(false));
    res.on('close', () => {
      if (!res.writableEnded) finish(true);
    });

    return this.tracing
      .run(trace, () => next.handle())
      .pipe(
        catchError((error: unknown) => {
          trace.error = errorMessage(error);
          return throwError(() => error);
        }),
      );
  }

  // --- internals ----------------------------------------------------------

  private complete(trace: Trace, res: Response, aborted: boolean): void {
    const durationMs = Date.now() - trace.startedAt;
    const status = aborted ? 499 : res.statusCode;
    const hasError = Boolean(trace.error) || status >= 500;

    const root = trace.spans.find((span) => span.isRoot);
    if (root) {
      root.durationMs = durationMs;
      root.status = hasError ? 'error' : 'ok';
      if (trace.error) root.error = trace.error;
    }

    this.metrics.observeHttp({ route: trace.label, status, durationMs });

    const tone = outcomeTone(status, hasError);
    const slow = durationMs >= LATENCY_WARN_MS;
    const statusLabel = aborted ? 'ABORTED' : byTone(tone, String(status));
    const message = [
      statusLabel,
      byTone(tone, trace.label),
      dim('·'),
      colorLatency(durationMs, formatDuration(durationMs)),
      dim('·'),
      dim(`trace ${trace.id}`),
      ...(trace.error ? [dim('·'), red(trace.error)] : []),
    ].join(' ');

    const trailer = renderWaterfall(trace, durationMs) || undefined;
    if (tone === 'error') {
      this.log.error(message, undefined, trailer);
    } else if (tone === 'warn' || slow) {
      this.log.warn(message, undefined, trailer);
    } else {
      this.log.info(message, undefined, trailer);
    }
  }
}
