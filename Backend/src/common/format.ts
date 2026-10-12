import {
  LATENCY_ERROR_MS,
  LATENCY_WARN_MS,
} from './constants/observability.constants';
import { green, red, yellow } from './logger/colors';

export type Tone = 'ok' | 'warn' | 'error';

/** Formats a duration for humans: `0.42ms`, `12.4ms`, `2.10s`. */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
};

export const formatPercent = (value: number, decimals = 1): string =>
  `${value.toFixed(decimals)}%`;

/** Maps a latency to a tone using the configured warn/error thresholds. */
export const latencyTone = (ms: number): Tone => {
  if (ms >= LATENCY_ERROR_MS) return 'error';
  if (ms >= LATENCY_WARN_MS) return 'warn';
  return 'ok';
};

/** Colorizes text by tone: green / yellow / red. */
export const byTone = (tone: Tone, text: string): string => {
  if (tone === 'error') return red(text);
  if (tone === 'warn') return yellow(text);
  return green(text);
};

/** Colorizes a latency value by its warn/error thresholds. */
export const colorLatency = (ms: number, text = formatDuration(ms)): string =>
  byTone(latencyTone(ms), text);

/** Extracts a short, single-line message from any thrown value. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const padEnd = (text: string, width: number): string =>
  text.length >= width ? text : text.padEnd(width, ' ');

export const padStart = (text: string, width: number): string =>
  text.length >= width ? text : text.padStart(width, ' ');

/** Shortens long labels in the middle: `SELECT * FROM very_long_table...`. */
export const truncateMiddle = (text: string, max = 52): string => {
  if (text.length <= max) return text;
  const half = Math.floor((max - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(text.length - half)}`;
};
