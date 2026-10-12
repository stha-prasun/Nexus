import type { Span, Trace } from './trace-context';
import { renderWaterfall } from './waterfall';

const ESC = String.fromCharCode(27);

/** Expected line with the same column widths renderLine uses (label 17). */
const line = (
  prefix: string,
  label: string,
  duration: string,
  pct: string,
): string =>
  `${prefix}${label.padEnd(17)}  ${duration.padStart(9)}  ${pct.padStart(5)}`;

const makeSpan = (
  id: string,
  parentId: string,
  system: Span['system'],
  name: string,
  startMs: number,
  durationMs?: number,
  error?: string,
): Span => ({
  id,
  parentId,
  system,
  name,
  startMs,
  durationMs,
  status: error ? 'error' : 'ok',
  ...(error ? { error } : {}),
});

const makeTrace = (spans: Span[]): Trace => ({
  id: 'trace01',
  label: 'GET /test',
  startedAt: 0,
  spans: [
    {
      id: 'root',
      system: 'http',
      name: 'GET /test',
      startMs: 0,
      durationMs: 100,
      status: 'ok',
      isRoot: true,
    },
    ...spans,
  ],
});

describe('renderWaterfall', () => {
  let savedNoColor: string | undefined;
  let savedForceColor: string | undefined;

  beforeAll(() => {
    savedNoColor = process.env.NO_COLOR;
    savedForceColor = process.env.FORCE_COLOR;
    process.env.NO_COLOR = '1';
  });

  afterAll(() => {
    if (savedNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = savedNoColor;
    if (savedForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = savedForceColor;
  });

  it('renders children in start order with glyphs, durations and percent', () => {
    const trace = makeTrace([
      makeSpan('b', 'root', 'redis', 'ping', 30, 10),
      makeSpan('a', 'root', 'postgres', 'SELECT 1', 1, 25),
      makeSpan('c', 'a', 'postgres', 'nested', 2, 5),
    ]);

    const lines = renderWaterfall(trace, 100).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(line('├── ', 'postgres SELECT 1', '25.0ms', '25%'));
    expect(lines[1]).toBe(line('│   └── ', 'postgres nested', '5.0ms', '5%'));
    expect(lines[2]).toBe(line('└── ', 'redis ping', '10.0ms', '10%'));
  });

  it('returns an empty string when the request touched nothing', () => {
    expect(renderWaterfall(makeTrace([]), 100)).toBe('');
  });

  it('flags error spans with a cross and the error message', () => {
    const trace = makeTrace([
      makeSpan('a', 'root', 'redis', 'ping', 1, 4, 'connect ECONNREFUSED'),
    ]);

    const output = renderWaterfall(trace, 100);
    expect(output).toContain(`✗ connect ECONNREFUSED`);
    expect(output).not.toContain(ESC);
  });

  it('renders still-open spans as open with no percent', () => {
    const trace = makeTrace([makeSpan('a', 'root', 'postgres', 'slow', 1)]);

    const output = renderWaterfall(trace, 100);
    expect(output).toContain('open');
    expect(output).toContain('-');
    expect(output).not.toContain('%');
  });

  it('truncates long labels in the middle', () => {
    const name = `SELECT ${'x'.repeat(80)} FROM orders`;
    const trace = makeTrace([makeSpan('a', 'root', 'postgres', name, 1, 3)]);

    const output = renderWaterfall(trace, 100);
    expect(output).toContain('…');
    expect(output).not.toContain(name);
  });

  it('caps the percent at 100 for spans longer than the root', () => {
    const trace = makeTrace([
      makeSpan('a', 'root', 'postgres', 'SELECT 1', 1, 250),
    ]);

    expect(renderWaterfall(trace, 100)).toContain('100%');
  });
});
