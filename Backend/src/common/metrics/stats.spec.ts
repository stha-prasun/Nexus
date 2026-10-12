import { percentile, Reservoir, summarize } from './stats';

describe('percentile', () => {
  it('returns 0 for an empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('uses the nearest rank over sorted values', () => {
    const sorted = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile(sorted, 100)).toBe(100);
  });

  it('returns the only sample regardless of percentile', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });
});

describe('summarize', () => {
  it('returns all zeros for no samples', () => {
    expect(summarize([])).toEqual({
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
      p50: 0,
      p95: 0,
      p99: 0,
    });
  });

  it('computes count, min, max, avg and percentiles', () => {
    expect(summarize([10, 30, 20, 40])).toEqual({
      count: 4,
      min: 10,
      max: 40,
      avg: 25,
      p50: 20,
      p95: 40,
      p99: 40,
    });
  });

  it('does not mutate the input array', () => {
    const values = [3, 1, 2];
    summarize(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('Reservoir', () => {
  it('collects values below capacity', () => {
    const reservoir = new Reservoir(3);
    reservoir.push(1);
    reservoir.push(2);
    expect(reservoir.size).toBe(2);
    expect(reservoir.toArray()).toEqual([1, 2]);
  });

  it('overwrites the oldest values once full', () => {
    const reservoir = new Reservoir(3);
    for (const value of [1, 2, 3, 4, 5]) reservoir.push(value);
    expect(reservoir.size).toBe(3);
    expect(reservoir.toArray()).toEqual([4, 5, 3]);
  });

  it('returns a copy, not the internal buffer', () => {
    const reservoir = new Reservoir(2);
    reservoir.push(1);
    const snapshot = reservoir.toArray();
    snapshot.push(99);
    expect(reservoir.toArray()).toEqual([1]);
  });
});
