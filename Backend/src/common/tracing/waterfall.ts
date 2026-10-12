import {
  colorLatency,
  formatDuration,
  padEnd,
  padStart,
  truncateMiddle,
} from '../format';
import { cyan, dim, gray, red } from '../logger/colors';
import type { Span, Trace } from './trace-context';

interface Entry {
  span: Span;
  prefix: string;
}

const treeGlyph = (isLast: boolean): string => (isLast ? '└── ' : '├── ');
const continuation = (isLast: boolean): string => (isLast ? '    ' : '│   ');

const collect = (trace: Trace, rootId: string): Entry[] => {
  const entries: Entry[] = [];
  const walk = (parentId: string, prefix: string): void => {
    const children = trace.spans
      .filter((span) => !span.isRoot && span.parentId === parentId)
      .sort((a, b) => a.startMs - b.startMs);
    children.forEach((span, index) => {
      const isLast = index === children.length - 1;
      entries.push({ span, prefix: `${prefix}${treeGlyph(isLast)}` });
      walk(span.id, `${prefix}${continuation(isLast)}`);
    });
  };
  walk(rootId, '');
  return entries;
};

const renderLine = (
  entry: Entry,
  labelWidth: number,
  rootDurationMs: number,
): string => {
  const { span, prefix } = entry;
  // Pad the plain text first — padding a colored string would count ANSI
  // escape codes and break alignment.
  const label = dim(
    cyan(padEnd(`${span.system} ${truncateMiddle(span.name, 46)}`, labelWidth)),
  );
  const open = span.durationMs === undefined;
  const durationMs = span.durationMs ?? 0;
  const duration = open
    ? gray(padStart('open', 9))
    : colorLatency(durationMs, padStart(formatDuration(durationMs), 9));
  const pct =
    open || rootDurationMs <= 0
      ? gray(padStart('-', 5))
      : gray(
          padStart(
            `${Math.min(100, Math.round((durationMs / rootDurationMs) * 100))}%`,
            5,
          ),
        );
  const error =
    span.status === 'error' && span.error
      ? ` ${red(`✗ ${truncateMiddle(span.error, 40)}`)}`
      : '';
  return `${dim(prefix)}${padEnd(label, labelWidth)}  ${duration}  ${pct}${error}`;
};

/**
 * Renders the per-request waterfall (child spans under the HTTP root):
 *
 *   ├── postgres SELECT 1      3.1ms    25%
 *   ├── redis ping              1.2ms    10%
 *   └── minio GET /            6.8ms    55%
 *
 * Returns an empty string when the request touched no instrumented dependency.
 */
export const renderWaterfall = (
  trace: Trace,
  rootDurationMs: number,
): string => {
  const root = trace.spans.find((span) => span.isRoot);
  if (!root) return '';
  const entries = collect(trace, root.id);
  if (entries.length === 0) return '';

  const labelWidth = Math.min(
    64,
    entries.reduce(
      (max, entry) =>
        Math.max(
          max,
          `${entry.span.system} ${truncateMiddle(entry.span.name, 46)}`.length,
        ),
      0,
    ),
  );

  return entries
    .map((entry) => renderLine(entry, labelWidth, rootDurationMs))
    .join('\n');
};
