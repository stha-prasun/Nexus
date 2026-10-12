import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

export type SpanSystem = 'http' | 'postgres' | 'redis' | 'minio' | 'custom';

export interface Span {
  id: string;
  parentId?: string;
  system: SpanSystem;
  name: string;
  /** performance.now() at span start. */
  startMs: number;
  durationMs?: number;
  status: 'ok' | 'error';
  error?: string;
  isRoot?: boolean;
}

export interface Trace {
  /** 16-char hex id, also sent as the x-request-id response header. */
  id: string;
  label: string;
  /** Wall-clock start (Date.now()) — used for total request latency. */
  startedAt: number;
  spans: Span[];
  error?: string;
}

export interface TraceContext {
  trace: Trace;
  currentSpanId?: string;
  /** Open span count per system — lets instrumentation skip nested spans. */
  depths: Partial<Record<SpanSystem, number>>;
}

const storage = new AsyncLocalStorage<TraceContext>();

export const runInContext = <T>(context: TraceContext, fn: () => T): T =>
  storage.run(context, fn);

export const currentContext = (): TraceContext | undefined =>
  storage.getStore();

export const newTraceId = (): string => randomBytes(8).toString('hex');
