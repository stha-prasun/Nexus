const num = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

/** Latency at or above this many ms is reported as a warning (yellow). */
export const LATENCY_WARN_MS = num(process.env.LATENCY_WARN_MS, 500);

/** Latency at or above this many ms is reported as an error (red). */
export const LATENCY_ERROR_MS = num(process.env.LATENCY_ERROR_MS, 2000);

/** Interval for the periodic colored metrics summary. */
export const METRICS_INTERVAL_MS = num(process.env.METRICS_INTERVAL_MS, 30_000);

/** Sliding window used for request-rate calculations. */
export const RATE_WINDOW_SEC = 60;

/** Error rate (percent) at which the metrics summary turns red. */
export const ERROR_RATE_RED_PCT = num(process.env.ERROR_RATE_RED_PCT, 5);

/** Heap usage ratio (0-1) at which the metrics summary warns. */
export const HEAP_WARN_RATIO = num(process.env.HEAP_WARN_RATIO, 0.9);
