import { Injectable, type LoggerService } from '@nestjs/common';
import { colorEnabled, cyan, dim, gray, green, red, yellow } from './colors';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

export interface ScopedLogger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields, trailer?: string): void;
  warn(message: string, fields?: LogFields, trailer?: string): void;
  error(message: string, fields?: LogFields, trailer?: string): void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

const stripAnsi = (text: string): string => text.replace(ANSI_RE, '');

const pad = (value: number, size = 2): string =>
  String(value).padStart(size, '0');

const timestamp = (): string => {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
};

const levelTag = (level: LogLevel): string => {
  const tag = level.toUpperCase().padEnd(5);
  switch (level) {
    case 'debug':
      return dim(tag);
    case 'info':
      return green(tag);
    case 'warn':
      return yellow(tag);
    case 'error':
      return red(tag);
    default:
      return tag;
  }
};

const formatValue = (value: LogValue): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }
  return String(value);
};

const formatFields = (fields?: LogFields): string => {
  if (!fields) return '';
  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${gray(`${key}=${formatValue(value)}`)}`);
  return pairs.join(' ');
};

/**
 * Single source of truth for log output. Implements Nest's LoggerService so
 * framework boot logs use the exact same format as application logs.
 *
 * Line format: `HH:mm:ss.SSS LEVEL [context] message key=value`
 *   - success / info → green
 *   - warning        → yellow
 *   - error          → red
 */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly level: LogLevel;
  private readonly json: boolean;

  constructor() {
    this.level = normalizeLevel(process.env.LOG_LEVEL);
    this.json = process.env.LOG_JSON === 'true';
  }

  /** Returns a logger bound to a context, e.g. `logger.child('http')`. */
  child(context: string): ScopedLogger {
    return {
      debug: (message, fields) => this.write('debug', message, context, fields),
      info: (message, fields, trailer) =>
        this.write('info', message, context, fields, trailer),
      warn: (message, fields, trailer) =>
        this.write('warn', message, context, fields, trailer),
      error: (message, fields, trailer) =>
        this.write('error', message, context, fields, trailer),
    };
  }

  // --- Nest LoggerService -------------------------------------------------

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.nest('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.nest('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.nest('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.nest('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.nest('debug', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.nest('error', message, optionalParams);
  }

  setLogLevels(): void {
    // Levels are fixed at construction from LOG_LEVEL; nothing to do.
  }

  // --- internals ----------------------------------------------------------

  private nest(
    level: LogLevel,
    message: unknown,
    optionalParams: unknown[],
  ): void {
    let context: string | undefined;
    let stack: string | undefined;
    for (const param of optionalParams) {
      if (typeof param !== 'string') continue;
      if (param.includes('\n')) stack = param;
      else context = param;
    }
    const fields: LogFields | undefined = stack ? { stack } : undefined;
    this.write(level, String(message), context, fields);
  }

  private write(
    level: LogLevel,
    message: string,
    context?: string,
    fields?: LogFields,
    trailer?: string,
  ): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;

    if (this.json) {
      process.stdout.write(
        `${JSON.stringify({
          time: new Date().toISOString(),
          level,
          context,
          msg: stripAnsi(message),
          ...(fields ?? {}),
          ...(trailer ? { trailer: stripAnsi(trailer) } : {}),
        })}\n`,
      );
      return;
    }

    const contextTag = context ? dim(cyan(`[${context}]`)) : '';
    const line = [
      dim(timestamp()),
      levelTag(level),
      contextTag,
      message,
      formatFields(fields),
    ]
      .filter((part) => part.length > 0)
      .join(' ');

    const output = trailer ? `${line}\n${trailer}` : line;
    process.stdout.write(`${colorEnabled() ? output : stripAnsi(output)}\n`);
  }
}

const normalizeLevel = (raw: string | undefined): LogLevel => {
  const value = (raw ?? 'info').toLowerCase();
  if (
    value === 'debug' ||
    value === 'info' ||
    value === 'warn' ||
    value === 'error' ||
    value === 'silent'
  ) {
    return value;
  }
  return 'info';
};
