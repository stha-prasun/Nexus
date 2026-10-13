import { Test, type TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../redis/constants/redis.constants';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  sessionKey,
} from './session.constants';
import { SessionService } from './session.service';

describe('SessionService', () => {
  let service: SessionService;

  const redis = {
    set: jest.fn(),
    get: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
  };

  const user = {
    userId: 7,
    role: 'Dev' as const,
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: REDIS_CLIENT, useValue: redis as unknown as Redis },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
  });

  describe('create', () => {
    it('stores a snapshot under a random sid with the session TTL', async () => {
      redis.set.mockResolvedValue('OK');

      const sid = await service.create(user);

      expect(sid).toEqual(expect.any(String));
      expect(sid).toHaveLength(64);
      const [key, payload, ex, ttl] = redis.set.mock.calls[0] as [
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
    });

    it('generates a fresh sid each time', async () => {
      redis.set.mockResolvedValue('OK');

      const first = await service.create(user);
      const second = await service.create(user);

      expect(first).not.toBe(second);
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

  describe('cookie helpers', () => {
    it('builds httpOnly, sameSite=lax, path=/ options', () => {
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

    it('setCookie writes the sid under the configured cookie name', () => {
      const cookie = jest.fn();
      service.setCookie({ cookie } as never, 'sid123');

      expect(cookie).toHaveBeenCalledWith(
        SESSION_COOKIE_NAME,
        'sid123',
        expect.objectContaining({ httpOnly: true, path: '/' }),
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
