import { Test, type TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { AppLogger } from '../../../../common/logger/logger';
import { REDIS_CLIENT } from '../../../redis/constants/redis.constants';
import {
  SESSION_COOKIE_NAME,
  SESSION_REMEMBER_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  sessionKey,
  userSessionsKey,
} from './session.constants';
import { SessionService } from './session.service';

describe('SessionService', () => {
  let service: SessionService;

  const multi = {
    set: jest.fn().mockReturnThis(),
    zremrangebyscore: jest.fn().mockReturnThis(),
    zadd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    zrem: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };
  const redis = {
    set: jest.fn(),
    get: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
    zrange: jest.fn(),
    multi: jest.fn(() => multi),
  };
  const log = { error: jest.fn(), info: jest.fn() };

  const user = {
    userId: '00000000-0000-4000-8000-000000000007',
    role: 'Dev' as const,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  };

  const applied = (...results: unknown[]): [null, unknown][] =>
    results.map((result) => [null, result] as [null, unknown]);

  beforeEach(async () => {
    jest.clearAllMocks();
    multi.exec.mockResolvedValue(applied('OK', 0, 1, 1));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: REDIS_CLIENT, useValue: redis as unknown as Redis },
        { provide: AppLogger, useValue: { child: () => log } },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  describe('create', () => {
    it('stores a snapshot under a random sid with the session TTL and indexes it in one MULTI', async () => {
      const sid = await service.create(user);

      expect(sid).toEqual(expect.any(String));
      expect(sid).toHaveLength(64);

      const [key, payload, ex, ttl] = multi.set.mock.calls[0] as [
        string,
        string,
        string,
        number,
      ];
      expect(key).toBe(sessionKey(sid));
      expect(JSON.parse(payload)).toEqual({
        ...user,
        createdAt: expect.any(String),
      });
      expect(ex).toBe('EX');
      expect(ttl).toBe(SESSION_TTL_SECONDS);

      // SET + ZREMRANGEBYSCORE + ZADD + EXPIRE, one MULTI, one EXEC.
      const indexKey = userSessionsKey(user.userId);
      expect(multi.zremrangebyscore).toHaveBeenCalledWith(
        indexKey,
        '-inf',
        expect.any(Number),
      );
      const [zaddKey, score, member] = multi.zadd.mock.calls[0] as [
        string,
        number,
        string,
      ];
      expect(zaddKey).toBe(indexKey);
      expect(member).toBe(sid);
      expect(score).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(multi.expire).toHaveBeenCalledWith(indexKey, SESSION_TTL_SECONDS);
      expect(redis.multi).toHaveBeenCalledTimes(1);
      expect(multi.exec).toHaveBeenCalledTimes(1);
    });

    it('honours an explicit ttl param (remember-me path)', async () => {
      const sid = await service.create(user, SESSION_REMEMBER_TTL_SECONDS);

      const [, , , ttl] = multi.set.mock.calls[0] as [
        string,
        string,
        string,
        number,
      ];
      expect(ttl).toBe(SESSION_REMEMBER_TTL_SECONDS);
      expect(multi.expire).toHaveBeenCalledWith(
        userSessionsKey(user.userId),
        SESSION_REMEMBER_TTL_SECONDS,
      );
      expect(sid).toHaveLength(64);
    });

    it('generates a fresh sid each time', async () => {
      const first = await service.create(user);
      const second = await service.create(user);

      expect(first).not.toBe(second);
    });

    it('rejects when EXEC returns an error tuple (never a live-but-unindexed session)', async () => {
      multi.exec.mockResolvedValue([
        [null, 'OK'],
        [new Error('WRONGTYPE'), null],
      ]);

      await expect(service.create(user)).rejects.toThrow(
        /session create failed/,
      );
    });

    it('rejects when EXEC returns null', async () => {
      multi.exec.mockResolvedValue(null);

      await expect(service.create(user)).rejects.toThrow(
        /session create failed/,
      );
    });
  });

  describe('get', () => {
    it('parses the stored snapshot', async () => {
      const data = { ...user, createdAt: '2026-01-01T00:00:00.000Z' };
      redis.get.mockResolvedValue(JSON.stringify(data));

      const session = await service.get('abc');

      expect(redis.get).toHaveBeenCalledWith(sessionKey('abc'));
      expect(session).toEqual(data);
    });

    it('returns null on a miss', async () => {
      redis.get.mockResolvedValue(null);

      expect(await service.get('missing')).toBeNull();
    });

    it('throws on a corrupt payload (callers treat it as a miss)', async () => {
      redis.get.mockResolvedValue('{not json');

      await expect(service.get('corrupt')).rejects.toThrow();
    });
  });

  describe('touch', () => {
    it('refreshes the TTL and reports whether the session existed', async () => {
      redis.expire.mockResolvedValue(1);
      expect(await service.touch('abc')).toBe(true);
      expect(redis.expire).toHaveBeenCalledWith(
        sessionKey('abc'),
        SESSION_TTL_SECONDS,
      );

      redis.expire.mockResolvedValue(0);
      expect(await service.touch('gone')).toBe(false);
    });
  });

  describe('destroy', () => {
    it('deletes the session key', async () => {
      redis.del.mockResolvedValue(1);

      await service.destroy('abc');

      expect(redis.del).toHaveBeenCalledWith(sessionKey('abc'));
    });
  });

  describe('destroyAndUnindex', () => {
    it('DELs the session and ZREMs only its own member in one MULTI', async () => {
      multi.exec.mockResolvedValue(applied(1, 1));

      const revoked = await service.destroyAndUnindex('sid1', user.userId);

      expect(multi.del).toHaveBeenCalledWith(sessionKey('sid1'));
      expect(multi.zrem).toHaveBeenCalledWith(
        userSessionsKey(user.userId),
        'sid1',
      );
      expect(revoked).toBe(1);
    });

    it('reports 0 when the session was already gone', async () => {
      multi.exec.mockResolvedValue(applied(0, 0));

      expect(await service.destroyAndUnindex('dead', user.userId)).toBe(0);
    });

    it('resolves 0 (best-effort) on an EXEC error tuple', async () => {
      multi.exec.mockResolvedValue([
        [new Error('connection lost'), 1],
        [null, 1],
      ]);

      expect(await service.destroyAndUnindex('sid1', user.userId)).toBe(0);
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe('revokeAllForUser', () => {
    it('destroys every read member and ZREMs only what it read (index key never DELed)', async () => {
      redis.zrange.mockResolvedValue(['sidA', 'sidB']);
      multi.exec.mockResolvedValue(applied(1, 0, 1, 1));

      const revoked = await service.revokeAllForUser(user.userId);

      expect(redis.zrange).toHaveBeenCalledWith(
        userSessionsKey(user.userId),
        0,
        '-1',
      );
      expect(multi.del).toHaveBeenCalledTimes(2);
      expect(multi.del).toHaveBeenCalledWith(sessionKey('sidA'));
      expect(multi.del).toHaveBeenCalledWith(sessionKey('sidB'));
      expect(multi.zrem).toHaveBeenCalledTimes(2);
      expect(multi.del).not.toHaveBeenCalledWith(userSessionsKey(user.userId));
      // Sum of the DEL tuples only (1 + 0), not the ZREMs.
      expect(revoked).toBe(1);
    });

    it('returns 0 without touching Redis when the index is empty', async () => {
      redis.zrange.mockResolvedValue([]);

      expect(await service.revokeAllForUser(user.userId)).toBe(0);
      expect(redis.multi).not.toHaveBeenCalled();
    });

    it('resolves 0 (best-effort) on an EXEC error tuple', async () => {
      redis.zrange.mockResolvedValue(['sidA']);
      multi.exec.mockResolvedValue([[new Error('boom'), 1]]);

      expect(await service.revokeAllForUser(user.userId)).toBe(0);
      expect(log.error).toHaveBeenCalled();
    });

    it('keeps a racing member alive: only read members are ZREMmed', async () => {
      redis.zrange.mockResolvedValue(['sidA']);
      multi.exec.mockResolvedValue(applied(1, 1));

      await service.revokeAllForUser(user.userId);

      expect(multi.zrem).toHaveBeenCalledTimes(1);
      expect(multi.zrem).toHaveBeenCalledWith(
        userSessionsKey(user.userId),
        'sidA',
      );
    });
  });

  describe('cookie helpers', () => {
    it('builds httpOnly, sameSite=lax, path=/ options with the default TTL', () => {
      const options = service.buildCookieOptions();

      expect(options).toEqual(
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: SESSION_TTL_SECONDS * 1000,
        }),
      );
      expect(options.secure).toBe(process.env.SESSION_COOKIE_SECURE === 'true');
    });

    it('buildCookieOptions honours an explicit ttl param', () => {
      expect(service.buildCookieOptions(123).maxAge).toBe(123 * 1000);
    });

    it('setCookie writes the sid under the configured cookie name', () => {
      const cookie = jest.fn();
      service.setCookie({ cookie } as never, 'sid123');

      expect(cookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        'sid123',
        expect.objectContaining({
          httpOnly: true,
          path: '/',
          maxAge: SESSION_TTL_SECONDS * 1000,
        }),
      );
    });

    it('setCookie honours an explicit ttl param (remember-me maxAge)', () => {
      const cookie = jest.fn();
      service.setCookie({ cookie } as never, 'sid123', 60);

      expect(cookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        'sid123',
        expect.objectContaining({ maxAge: 60 * 1000 }),
      );
    });

    it('clearCookie clears the same cookie without maxAge', () => {
      const clearCookie = jest.fn();
      service.clearCookie({ clearCookie } as never);

      expect(clearCookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        expect.objectContaining({ path: '/' }),
      );
      const options = clearCookie.mock.calls[0][1];
      expect(options.maxAge).toBeUndefined();
    });
  });
});
