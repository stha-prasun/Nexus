import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import type { Redis } from 'ioredis';
import { AppLogger } from '../../../../common/logger/logger';
import { REDIS_CLIENT } from '../../../redis/constants/redis.constants';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  sessionKey,
  userSessionsKey,
} from './session.constants';
import type { SessionData, SessionUser } from './session.types';

/** One `MULTI/EXEC` tuple: `[error, result]` per queued command. */
type MultiTuple = [Error | null, unknown];
type MultiResult = MultiTuple[] | null;

const sameSite = (): CookieOptions['sameSite'] => {
  const value = process.env.SESSION_COOKIE_SAME_SITE ?? 'lax';
  return value === 'strict' || value === 'none' ? value : 'lax';
};

/**
 * Redis-backed sessions with a small user snapshot (/auth/me = 1 Redis read,
 * 0 Postgres) plus a per-user sorted-set index of live sids (score = expiry
 * epoch) so revoke-all and future device lists are single round trips.
 *
 * Write policy: session-creating writes go through `MULTI/EXEC` and are
 * inspected — a half-applied write must fail loudly (login → 500), never
 * produce a live-but-unindexed (i.e. unrevocable) session. Revocation is
 * best-effort: tuple errors are logged and the call still resolves (an
 * undestroyed key dies at TTL and stays indexed, so revoke-all can still
 * reach it later).
 */
@Injectable()
export class SessionService {
  private readonly log: ReturnType<AppLogger['child']>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    logger: AppLogger,
  ) {
    this.log = logger.child('session');
  }

  /**
   * Mint a fresh sid and store the snapshot + index it under the user in one
   * MULTI. Also prunes expired members of that user's index as it goes.
   * Throws if the MULTI did not fully apply.
   */
  async create(
    user: SessionUser,
    ttlSeconds: number = SESSION_TTL_SECONDS,
  ): Promise<string> {
    const sid = randomBytes(32).toString('hex');
    const data: SessionData = { ...user, createdAt: new Date().toISOString() };
    const indexKey = userSessionsKey(user.userId);
    const nowSeconds = Math.floor(Date.now() / 1000);

    const multi = this.redis.multi();
    multi.set(sessionKey(sid), JSON.stringify(data), 'EX', ttlSeconds);
    multi.zremrangebyscore(indexKey, '-inf', nowSeconds);
    multi.zadd(indexKey, nowSeconds + ttlSeconds, sid);
    multi.expire(indexKey, ttlSeconds);
    const results = await multi.exec();
    // Throws on any error tuple / null EXEC — never a live-but-unindexed session.
    this.applied(results, 'session create', true);
    return sid;
  }

  async get(sid: string): Promise<SessionData | null> {
    const raw = await this.redis.get(sessionKey(sid));
    // A corrupt payload makes JSON.parse throw — callers treat that as a miss
    // and unindex/clear the cookie.
    return raw === null ? null : (JSON.parse(raw) as SessionData);
  }

  /** Sliding expiry — refresh the TTL when a session is used. */
  async touch(sid: string): Promise<boolean> {
    const result = await this.redis.expire(
      sessionKey(sid),
      SESSION_TTL_SECONDS,
    );
    return result === 1;
  }

  async destroy(sid: string): Promise<void> {
    await this.redis.del(sessionKey(sid));
  }

  /** Delete a session and remove it from its owner's index. Best-effort. */
  async destroyAndUnindex(sid: string, userId: string): Promise<number> {
    const multi = this.redis.multi();
    multi.del(sessionKey(sid));
    multi.zrem(userSessionsKey(userId), sid);
    const results = await multi.exec();
    if (!this.applied(results, 'session destroy') || results === null) {
      return 0;
    }
    return this.tupleNumber(results[0]);
  }

  /**
   * Revoke every session indexed for a user. Reads the members first and
   * ZREMs only what it read — the index key is never DELed wholesale, so a
   * login racing this call lands its own ZADD and survives still indexed.
   * Returns the number of live sessions actually destroyed. Best-effort:
   * tuple errors are logged, never thrown.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const indexKey = userSessionsKey(userId);
    // ioredis types the stop bound as string|Buffer on the plain overload.
    const sids = await this.redis.zrange(indexKey, 0, '-1');
    if (sids.length === 0) return 0;

    const multi = this.redis.multi();
    for (const sid of sids) {
      multi.del(sessionKey(sid));
    }
    for (const sid of sids) {
      multi.zrem(indexKey, sid);
    }
    const results = await multi.exec();
    if (!this.applied(results, 'session revoke-all') || results === null) {
      return 0;
    }

    // Only the first N tuples are the DELs — sum those.
    return results
      .slice(0, sids.length)
      .reduce((sum, tuple) => sum + this.tupleNumber(tuple), 0);
  }

  /** Cookie flags: httpOnly, sameSite, secure (env), path=/. */
  buildCookieOptions(ttlSeconds: number = SESSION_TTL_SECONDS): CookieOptions {
    return {
      httpOnly: true,
      sameSite: sameSite(),
      secure: process.env.SESSION_COOKIE_SECURE === 'true',
      path: '/',
      maxAge: ttlSeconds * 1000,
    };
  }

  setCookie(
    res: Response,
    sid: string,
    ttlSeconds: number = SESSION_TTL_SECONDS,
  ): void {
    res.cookie(SESSION_COOKIE_NAME, sid, this.buildCookieOptions(ttlSeconds));
  }

  clearCookie(res: Response): void {
    const { maxAge: _maxAge, ...options } = this.buildCookieOptions();
    res.clearCookie(SESSION_COOKIE_NAME, options);
  }

  private tupleNumber(tuple: MultiTuple | undefined): number {
    if (tuple === undefined || tuple[0] !== null) return 0;
    return typeof tuple[1] === 'number' ? tuple[1] : 0;
  }

  /**
   * Inspect `exec()` tuples. Returns false when the write did not fully
   * apply; logs on the best-effort path, throws on the strict (login) path.
   */
  private applied(
    results: MultiResult,
    context: string,
    throwOnFailure = false,
  ): boolean {
    const failed =
      results === null
        ? `${context} returned no EXEC result`
        : (results.find(([error]) => error !== null)?.[0]?.message ??
          undefined);
    if (failed === undefined) return true;
    if (throwOnFailure) {
      this.log.error(`redis MULTI failed: ${context}`, { error: failed });
      throw new Error(`Redis MULTI ${context} failed: ${failed}`);
    }
    this.log.error(`redis MULTI failed (best-effort): ${context}`, {
      error: failed,
    });
    return false;
  }
}
