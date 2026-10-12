import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Redis } from 'ioredis';
import type { Client as MinioClient } from 'minio';
import type { Pool } from 'pg';
import { POSTGRES_POOL } from '../../module/database/constants/database.contants';
import {
  MINIO_CLIENT,
  REDIS_CLIENT,
} from '../../module/health/constants/health.contants';
import { truncateMiddle } from '../format';
import { AppLogger } from '../logger/logger';
import type { SpanHandle } from './tracing.service';
import { TracingService } from './tracing.service';

type LooseFn = (...args: unknown[]) => unknown;
type PgMarkMode = 'suppress' | 'trace';

interface MarkedClient {
  query: LooseFn;
  __nexusPgMode?: PgMarkMode;
  __nexusPgWrapped?: boolean;
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null | undefined)?.then ===
  'function';

const sqlLabel = (args: unknown[]): string => {
  const first = args[0];
  let text: string | undefined;
  if (typeof first === 'string') text = first;
  else if (first && typeof first === 'object' && 'text' in first) {
    const candidate = (first as { text?: unknown }).text;
    if (typeof candidate === 'string') text = candidate;
  }
  if (!text) return 'query';
  return truncateMiddle(text.replace(/\s+/g, ' ').trim(), 60);
};

const minioLabel = (args: unknown[]): string => {
  const options = args[0] as
    | { method?: unknown; bucketName?: unknown; objectName?: unknown }
    | undefined;
  const method =
    typeof options?.method === 'string' ? options.method : 'REQUEST';
  const path = [options?.bucketName, options?.objectName]
    .filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    )
    .join('/');
  return path ? `${method} /${path}` : method;
};

/**
 * Wraps an instrumented call so its span ends when the operation completes —
 * via callback (pg style) or promise (promise style) — without changing what
 * the caller receives.
 */
const tracked = (
  handle: SpanHandle,
  args: unknown[],
  invoke: LooseFn,
): unknown => {
  const callbackIndex = args.findIndex((arg) => typeof arg === 'function');
  let workingArgs = args;

  if (callbackIndex >= 0) {
    workingArgs = [...args];
    const originalCallback = workingArgs[callbackIndex] as (
      error: unknown,
      ...rest: unknown[]
    ) => unknown;
    workingArgs[callbackIndex] = function (
      this: unknown,
      error: unknown,
      ...rest: unknown[]
    ) {
      handle.end(error);
      return originalCallback.call(this, error, ...rest);
    };
  }

  let result: unknown;
  try {
    result = invoke(...workingArgs);
  } catch (error) {
    handle.end(error);
    throw error;
  }

  if (callbackIndex < 0 && isThenable(result)) {
    Promise.resolve(result).then(
      () => handle.end(),
      (error: unknown) => handle.end(error),
    );
  }
  return result;
};

/**
 * Patches postgres, redis and minio clients so every call is timed as a span
 * under the active request trace (and fed to the dependency metrics).
 *
 * - postgres: `pool.query` (covers health checks and drizzle queries),
 *   `pool.connect` (checkout wait / transactions) and each acquired
 *   client's `query`. A client acquired *inside* an open pool.query span is
 *   marked "suppress" so the same SQL is never counted twice.
 * - redis: `sendCommand` — every command funnels through it.
 * - minio: `makeRequestStreamAsync` — the single HTTP primitive all S3
 *   operations resolve to.
 */
@Injectable()
export class InstrumentationService implements OnApplicationBootstrap {
  private readonly log: ReturnType<AppLogger['child']>;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly tracing: TracingService,
    logger: AppLogger,
  ) {
    this.log = logger.child('instrument');
  }

  onApplicationBootstrap(): void {
    this.instrumentPostgres();
    this.instrumentRedis();
    this.instrumentMinio();
  }

  // --- postgres -----------------------------------------------------------

  private instrumentPostgres(): void {
    const pool = this.resolve<Pool>(POSTGRES_POOL);
    if (!pool) {
      this.log.debug('postgres instrumentation skipped (pool not found)');
      return;
    }

    this.patchPoolQuery(pool);
    this.patchPoolConnect(pool);
    this.log.debug('postgres instrumented (pool.query, pool.connect)');
  }

  private patchPoolQuery(pool: Pool): void {
    const target = pool as unknown as { query: LooseFn };
    if (typeof target.query !== 'function') return;
    const original = target.query.bind(pool);

    target.query = (...args: unknown[]): unknown => {
      // A pool.query inside another open postgres span is already covered.
      if (this.tracing.isInside('postgres')) {
        return original(...args);
      }
      const handle = this.tracing.begin('postgres', sqlLabel(args));
      return handle.run(() => tracked(handle, args, original));
    };
  }

  private patchPoolConnect(pool: Pool): void {
    const target = pool as unknown as { connect: LooseFn };
    if (typeof target.connect !== 'function') return;
    const original = target.connect.bind(pool);

    target.connect = (...args: unknown[]): unknown => {
      // Read synchronously — this runs inside pool.query's span when the
      // driver acquires a connection for an already-tracked query.
      const suppress = this.tracing.isInside('postgres');
      const mark = (client: unknown): void =>
        this.markClient(client, suppress ? 'suppress' : 'trace');
      const handle = suppress
        ? undefined
        : this.tracing.begin('postgres', 'acquire');

      const callbackIndex = args.findIndex((arg) => typeof arg === 'function');
      if (callbackIndex >= 0) {
        const workingArgs = [...args];
        const originalCallback = workingArgs[callbackIndex] as (
          error: unknown,
          client?: unknown,
          ...rest: unknown[]
        ) => unknown;
        workingArgs[callbackIndex] = function (
          this: unknown,
          error: unknown,
          client?: unknown,
          ...rest: unknown[]
        ) {
          if (!error) mark(client);
          handle?.end(error ?? undefined);
          return originalCallback.call(this, error, client, ...rest);
        };
        return original(...workingArgs);
      }

      let result: unknown;
      try {
        result = original(...args);
      } catch (error) {
        handle?.end(error);
        throw error;
      }
      if (isThenable(result)) {
        return Promise.resolve(result).then(
          (client: unknown) => {
            mark(client);
            handle?.end();
            return client;
          },
          (error: unknown) => {
            handle?.end(error);
            throw error;
          },
        );
      }
      mark(result);
      handle?.end();
      return result;
    };
  }

  /** Installs a timing wrapper around an acquired pg client's `query`. */
  private markClient(client: unknown, mode: PgMarkMode): void {
    if (!client || typeof client !== 'object') return;
    const marked = client as MarkedClient;
    if (typeof marked.query !== 'function') return;

    marked.__nexusPgMode = mode;
    if (marked.__nexusPgWrapped) return;
    marked.__nexusPgWrapped = true;

    const original = marked.query.bind(client) as LooseFn;
    marked.query = (...args: unknown[]): unknown => {
      if (marked.__nexusPgMode === 'suppress') return original(...args);
      const handle = this.tracing.begin('postgres', sqlLabel(args));
      return handle.run(() => tracked(handle, args, original));
    };
  }

  // --- redis --------------------------------------------------------------

  private instrumentRedis(): void {
    const redis = this.resolve<Redis>(REDIS_CLIENT);
    const target = redis as unknown as { sendCommand?: LooseFn } | undefined;
    if (!redis || typeof target?.sendCommand !== 'function') {
      this.log.debug('redis instrumentation skipped (client not found)');
      return;
    }

    const original = target.sendCommand.bind(redis) as LooseFn;
    target.sendCommand = (...args: unknown[]): unknown => {
      const command = args[0] as
        | { name?: unknown; promise?: unknown }
        | undefined;
      const name = typeof command?.name === 'string' ? command.name : 'command';
      const handle = this.tracing.begin('redis', name);

      let result: unknown;
      try {
        result = original(...args);
      } catch (error) {
        handle.end(error);
        throw error;
      }

      const completion = isThenable(result) ? result : command?.promise;
      if (isThenable(completion)) {
        Promise.resolve(completion).then(
          () => handle.end(),
          (error: unknown) => handle.end(error),
        );
      } else {
        handle.end();
      }
      return result;
    };
    this.log.debug('redis instrumented (sendCommand)');
  }

  // --- minio --------------------------------------------------------------

  private instrumentMinio(): void {
    const minio = this.resolve<MinioClient>(MINIO_CLIENT);
    const target = minio as unknown as
      | { makeRequestStreamAsync?: LooseFn }
      | undefined;
    if (!minio || typeof target?.makeRequestStreamAsync !== 'function') {
      this.log.debug('minio instrumentation skipped (client not found)');
      return;
    }

    const original = target.makeRequestStreamAsync.bind(minio) as LooseFn;
    target.makeRequestStreamAsync = (...args: unknown[]): unknown => {
      const handle = this.tracing.begin('minio', minioLabel(args));
      let result: unknown;
      try {
        result = handle.run(() => original(...args));
      } catch (error) {
        handle.end(error);
        throw error;
      }
      if (isThenable(result)) {
        return Promise.resolve(result).then(
          (value: unknown) => {
            handle.end();
            return value;
          },
          (error: unknown) => {
            handle.end(error);
            throw error;
          },
        );
      }
      handle.end();
      return result;
    };
    this.log.debug('minio instrumented (makeRequestStreamAsync)');
  }

  // --- helpers ------------------------------------------------------------

  private resolve<T>(token: string): T | undefined {
    try {
      return this.moduleRef.get<T>(token, { strict: false });
    } catch {
      return undefined;
    }
  }
}
