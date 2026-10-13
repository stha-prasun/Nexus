import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../redis/constants/redis.constants';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  sessionKey,
} from './session.constants';
import type { SessionData, SessionUser } from './session.types';

const sameSite = (): CookieOptions['sameSite'] => {
  const value = process.env.SESSION_COOKIE_SAME_SITE ?? 'lax';
  return value === 'strict' || value === 'none' ? value : 'lax';
};

/**
 * Redis-backed sessions with a small user snapshot (future /auth/me = 1 Redis
 * read, 0 Postgres). Scaffold for the login feature — built and tested now,
 * not yet used by any route.
 */
@Injectable()
export class SessionService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async create(user: SessionUser): Promise<string> {
    const sid = randomBytes(32).toString('hex');
    const data: SessionData = { ...user, createdAt: new Date().toISOString() };
    await this.redis.set(
      sessionKey(sid),
      JSON.stringify(data),
      'EX',
      SESSION_TTL_SECONDS,
    );
    return sid;
  }

  async get(sid: string): Promise<SessionData | null> {
    const raw = await this.redis.get(sessionKey(sid));
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

  /** Cookie flags: httpOnly, sameSite, secure (env), path=/. */
  buildCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: sameSite(),
      secure: process.env.SESSION_COOKIE_SECURE === 'true',
      path: '/',
      maxAge: SESSION_TTL_SECONDS * 1000,
    };
  }

  setCookie(res: Response, sid: string): void {
    res.cookie(SESSION_COOKIE_NAME, sid, this.buildCookieOptions());
  }

  clearCookie(res: Response): void {
    const { maxAge: _maxAge, ...options } = this.buildCookieOptions();
    res.clearCookie(SESSION_COOKIE_NAME, options);
  }
}
