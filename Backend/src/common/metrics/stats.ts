/**
 * Fixed-capacity ring buffer of samples. Keeps the most recent `capacity`
 * values so percentile math stays O(n log n) on a bounded set forever.
 */
export class Reservoir {
  private readonly values: number[] = [];
  private index = 0;

  constructor(private readonly capacity = 1024) {}

  push(value: number): void {
    if (this.values.length < this.capacity) {
      this.values.push(value);
      return;
    }
    this.values[this.index] = value;
    this.index = (this.index + 1) % this.capacity;
  }

  toArray(): number[] {
    return [...this.values];
  }

  get size(): number {
    return this.values.length;
  }
}

export interface LatencySummary {
  count: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

const EMPTY_SUMMARY: LatencySummary = {
  count: 0,
  min: 0,
  max: 0,
  avg: 0,
  p50: 0,
  p95: 0,
  p99: 0,
};

/** Nearest-rank percentile over an ascending-sorted array. */
export const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const clamped = Math.max(0, Math.min(rank, sorted.length - 1));
  return sorted[clamped];
};

/** Computes count/min/max/avg/p50/p95/p99 for a set of samples. */
export const summarize = (values: number[]): LatencySummary => {
  if (values.length === 0) return { ...EMPTY_SUMMARY };
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: total / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
};
