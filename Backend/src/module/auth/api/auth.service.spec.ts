import { ConflictException, HttpException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AppLogger } from '../../../common/logger/logger';
import { MailQueue } from '../../mail/mail.queue';
import {
  inviteMembershipKey,
  inviteTokenKey,
} from '../../members/api/constants/members.constants';
import { MembersRepository } from '../../members/api/repositories/members.repository';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import { AuthService } from './auth.service';
import {
  DUMMY_HASH,
  EMAIL_TAKEN_MESSAGE,
  EMAIL_UNVERIFIED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_LOCKOUT_MAX,
  LOGIN_UNVERIFIED_MESSAGE,
  LOGOUT_ALL_MESSAGE,
  LOGOUT_MESSAGE,
  loginLockoutKey,
  REGISTER_MESSAGE,
  RESEND_CONFIRMATION_MESSAGE,
  TOO_MANY_ATTEMPTS_MESSAGE,
  VERIFICATION_TOKEN_TTL_SECONDS,
} from './constants/auth.constants';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { User } from './entities/user.entity';
import { UserFactory } from './factories/user.factory';
import { AuthRepository } from './repositories/auth.repository';
import {
  SESSION_REMEMBER_TTL_SECONDS,
  SESSION_TTL_SECONDS,
} from './session/session.constants';
import { SessionService } from './session/session.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

const compareMock = bcrypt.compare as jest.Mock;

/** Deterministic uuid-shaped fixture ids (users.id is uuid since 0002). */
const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('AuthService', () => {
  let service: AuthService;

  const repository = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    insert: jest.fn(),
    save: jest.fn(),
  };
  const userFactory = { create: jest.fn() };
  const mailQueue = {
    enqueueVerification: jest.fn(),
    enqueueAccountExists: jest.fn(),
  };
  const pipeline = {
    set: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
    pipeline: jest.fn(() => pipeline),
  };
  const sessions = {
    create: jest.fn(),
    get: jest.fn(),
    destroy: jest.fn(),
    destroyAndUnindex: jest.fn(),
    revokeAllForUser: jest.fn(),
    listForUser: jest.fn(),
  };
  const membersRepository = {
    acceptPendingForEmail: jest.fn(),
  };
  const DUMMY =
    '$2b$04$dummydummydummydummydummydummydummydummydummydummydummy';

  const buildUser = (
    overrides: Partial<ConstructorParameters<typeof User>[0]> = {},
  ) =>
    new User({
      id: uuid(1),
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      role: 'Dev',
      passwordHash: 'hashed',
      emailVerifiedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    });

  const dto: RegisterDto = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'Sup3r!Secret',
  };

  const conflictFrom = async (
    promise: Promise<unknown>,
  ): Promise<ConflictException> => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      return error as ConflictException;
    }
    throw new Error('expected a ConflictException, but the call resolved');
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    pipeline.exec.mockResolvedValue([]);
    mailQueue.enqueueVerification.mockResolvedValue(undefined);
    mailQueue.enqueueAccountExists.mockResolvedValue(undefined);
    redis.get.mockResolvedValue(null);
    compareMock.mockReset();
    membersRepository.acceptPendingForEmail.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repository },
        { provide: UserFactory, useValue: userFactory },
        { provide: MailQueue, useValue: mailQueue },
        { provide: SessionService, useValue: sessions },
        { provide: MembersRepository, useValue: membersRepository },
        { provide: DUMMY_HASH, useValue: DUMMY },
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: AppLogger,
          useValue: { child: () => ({ error: jest.fn(), info: jest.fn() }) },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('creates a new user, writes token keys, then enqueues (new user branch)', async () => {
      const user = buildUser({ id: uuid(42) });
      repository.findByEmail.mockResolvedValue(null);
      userFactory.create.mockResolvedValue(user);
      repository.insert.mockResolvedValue(user);

      const result = await service.register(dto);

      expect(userFactory.create).toHaveBeenCalledWith(dto);
      expect(repository.insert).toHaveBeenCalledWith(user);
      expect(pipeline.set).toHaveBeenCalledTimes(2);
      expect(pipeline.exec).toHaveBeenCalledTimes(1);
      expect(mailQueue.enqueueVerification).toHaveBeenCalledWith(uuid(42));
      expect(result).toEqual({ message: REGISTER_MESSAGE });
    });

    it('conflicts with email_unverified for an existing unverified account (no email, no token writes)', async () => {
      const user = buildUser({ id: uuid(5) });
      repository.findByEmail.mockResolvedValue(user);

      const conflict = await conflictFrom(service.register(dto));

      expect(conflict.getStatus()).toBe(409);
      expect(conflict.getResponse()).toEqual({
        status: 'email_unverified',
        message: EMAIL_UNVERIFIED_MESSAGE,
      });
      expect(userFactory.create).not.toHaveBeenCalled();
      expect(repository.insert).not.toHaveBeenCalled();
      expect(pipeline.set).not.toHaveBeenCalled();
      expect(mailQueue.enqueueVerification).not.toHaveBeenCalled();
      expect(mailQueue.enqueueAccountExists).not.toHaveBeenCalled();
    });

    it('conflicts with email_taken for a verified account and notifies the owner', async () => {
      const user = buildUser({ id: uuid(5), emailVerifiedAt: new Date() });
      repository.findByEmail.mockResolvedValue(user);

      const conflict = await conflictFrom(service.register(dto));

      expect(conflict.getStatus()).toBe(409);
      expect(conflict.getResponse()).toEqual({
        status: 'email_taken',
        message: EMAIL_TAKEN_MESSAGE,
      });
      expect(mailQueue.enqueueAccountExists).toHaveBeenCalledWith(uuid(5));
      expect(mailQueue.enqueueVerification).not.toHaveBeenCalled();
      expect(pipeline.set).not.toHaveBeenCalled();
    });

    it('treats a unique-violation race (23505) as the existing branch', async () => {
      const existing = buildUser({ id: uuid(9) });
      repository.findByEmail
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing);
      userFactory.create.mockResolvedValue(buildUser({ id: undefined }));
      repository.insert.mockRejectedValue(
        Object.assign(new Error('dup'), { code: '23505' }),
      );

      const conflict = await conflictFrom(service.register(dto));

      expect(conflict.getResponse()).toMatchObject({
        status: 'email_unverified',
      });
      expect(mailQueue.enqueueVerification).not.toHaveBeenCalled();
      expect(pipeline.set).not.toHaveBeenCalled();
    });

    it('rethrows non-unique insert errors', async () => {
      repository.findByEmail.mockResolvedValue(null);
      userFactory.create.mockResolvedValue(buildUser());
      repository.insert.mockRejectedValue(new Error('boom'));

      await expect(service.register(dto)).rejects.toThrow('boom');
    });

    it('still returns the 201 message when enqueue fails (logged, not thrown)', async () => {
      const user = buildUser({ id: uuid(3) });
      repository.findByEmail.mockResolvedValue(null);
      userFactory.create.mockResolvedValue(user);
      repository.insert.mockResolvedValue(user);
      mailQueue.enqueueVerification.mockRejectedValue(new Error('redis down'));

      const result = await service.register(dto);

      expect(result).toEqual({ message: REGISTER_MESSAGE });
    });

    it('still throws email_taken when the notice enqueue fails', async () => {
      const user = buildUser({ id: uuid(5), emailVerifiedAt: new Date() });
      repository.findByEmail.mockResolvedValue(user);
      mailQueue.enqueueAccountExists.mockRejectedValue(new Error('redis down'));

      const conflict = await conflictFrom(service.register(dto));

      expect(conflict.getResponse()).toMatchObject({ status: 'email_taken' });
    });
  });

  describe('verifyEmail', () => {
    it('verifies, saves and deletes both keys on a valid token', async () => {
      const user = buildUser({ id: uuid(11) });
      redis.get.mockResolvedValue(uuid(11));
      repository.findById.mockResolvedValue(user);
      repository.save.mockImplementation(async (u: User) => u);

      const result = await service.verifyEmail('sometoken');

      expect(user.isVerified).toBe(true);
      expect(repository.save).toHaveBeenCalledWith(user);
      expect(pipeline.del).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ status: 'verified' });
    });

    it('returns invalid_or_expired on a token miss', async () => {
      redis.get.mockResolvedValue(null);

      const result = await service.verifyEmail('expired');

      expect(result).toEqual({ status: 'invalid_or_expired' });
      expect(repository.findById).not.toHaveBeenCalled();
    });

    it('returns invalid_or_expired when the user no longer exists, and cleans keys', async () => {
      redis.get.mockResolvedValue(uuid(99));
      repository.findById.mockResolvedValue(null);

      const result = await service.verifyEmail('orphan');

      expect(pipeline.del).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ status: 'invalid_or_expired' });
    });

    it('is idempotent for an already-verified user', async () => {
      const verifiedAt = new Date('2026-01-02T00:00:00Z');
      const user = buildUser({ id: uuid(11), emailVerifiedAt: verifiedAt });
      redis.get.mockResolvedValue(uuid(11));
      repository.findById.mockResolvedValue(user);

      const result = await service.verifyEmail('sometoken');

      expect(repository.save).not.toHaveBeenCalled();
      expect(user.emailVerifiedAt).toEqual(verifiedAt);
      expect(result).toEqual({ status: 'verified' });
    });

    it('auto-accepts a pending invite for the verified email and kills its token keys', async () => {
      const user = buildUser({ id: uuid(11) });
      // First read: verification token → uid; later read: invite token.
      redis.get.mockImplementation(async (key: string) =>
        key.startsWith('auth:verify:') ? uuid(11) : 'invite-token-abc',
      );
      repository.findById.mockResolvedValue(user);
      repository.save.mockImplementation(async (u: User) => u);
      membersRepository.acceptPendingForEmail.mockResolvedValue([
        { membershipId: 'mid-1', role: 'HR' },
      ]);

      const result = await service.verifyEmail('sometoken');

      expect(result).toEqual({ status: 'verified' });
      expect(membersRepository.acceptPendingForEmail).toHaveBeenCalledWith(
        'ada@example.com',
        uuid(11),
      );
      // 2 verification keys + invite mid key + invite token key.
      expect(pipeline.del).toHaveBeenCalledWith(inviteMembershipKey('mid-1'));
      expect(pipeline.del).toHaveBeenCalledWith(
        inviteTokenKey('invite-token-abc'),
      );
      expect(pipeline.del).toHaveBeenCalledTimes(4);
    });

    it('a failed auto-accept still verifies (the accept page is the fallback)', async () => {
      const user = buildUser({ id: uuid(11) });
      redis.get.mockResolvedValue(uuid(11));
      repository.findById.mockResolvedValue(user);
      repository.save.mockImplementation(async (u: User) => u);
      membersRepository.acceptPendingForEmail.mockRejectedValue(
        new Error('db down'),
      );

      const result = await service.verifyEmail('sometoken');

      expect(result).toEqual({ status: 'verified' });
      // Only the verification keys — no invite cleanup ran.
      expect(pipeline.del).toHaveBeenCalledTimes(2);
    });

    it('skips invite token cleanup when nothing was accepted', async () => {
      const user = buildUser({ id: uuid(11) });
      redis.get.mockResolvedValue(uuid(11));
      repository.findById.mockResolvedValue(user);
      repository.save.mockImplementation(async (u: User) => u);

      await service.verifyEmail('sometoken');

      expect(membersRepository.acceptPendingForEmail).toHaveBeenCalledWith(
        'ada@example.com',
        uuid(11),
      );
      expect(pipeline.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('resendConfirmation', () => {
    it('regenerates the token for an unverified account', async () => {
      const user = buildUser({ id: uuid(8) });
      repository.findByEmail.mockResolvedValue(user);

      const result = await service.resendConfirmation({ email: dto.email });

      expect(pipeline.set).toHaveBeenCalledTimes(2);
      expect(pipeline.set).toHaveBeenCalledWith(
        expect.stringContaining('auth:verify:'),
        uuid(8),
        'EX',
        VERIFICATION_TOKEN_TTL_SECONDS,
      );
      expect(mailQueue.enqueueVerification).toHaveBeenCalledWith(uuid(8));
      expect(result).toEqual({ message: RESEND_CONFIRMATION_MESSAGE });
    });

    it('is a no-op for verified or missing accounts (same message)', async () => {
      repository.findByEmail.mockResolvedValue(
        buildUser({ emailVerifiedAt: new Date() }),
      );

      const result = await service.resendConfirmation({ email: dto.email });

      expect(mailQueue.enqueueVerification).not.toHaveBeenCalled();
      expect(result).toEqual({ message: RESEND_CONFIRMATION_MESSAGE });

      repository.findByEmail.mockResolvedValue(null);
      const missing = await service.resendConfirmation({ email: 'x@y.z' });
      expect(missing).toEqual({ message: RESEND_CONFIRMATION_MESSAGE });
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = {
      email: 'ada@example.com',
      password: 'Sup3r!Secret',
    };

    const httpErrorFrom = async (
      promise: Promise<unknown>,
      status: number,
    ): Promise<HttpException> => {
      try {
        await promise;
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        expect((error as HttpException).getStatus()).toBe(status);
        return error as HttpException;
      }
      throw new Error(`expected an HTTP ${status}, but the call resolved`);
    };

    it('verifies the password, creates + indexes a session, clears the counter', async () => {
      const user = buildUser({ id: uuid(1), emailVerifiedAt: new Date() });
      repository.findByEmail.mockResolvedValue(user);
      compareMock.mockResolvedValue(true);
      sessions.create.mockResolvedValue('sid-new');

      const result = await service.login(loginDto);

      expect(compareMock).toHaveBeenCalledWith(loginDto.password, 'hashed');
      expect(redis.del).toHaveBeenCalledWith(loginLockoutKey(loginDto.email));
      expect(sessions.create).toHaveBeenCalledWith(
        {
          userId: uuid(1),
          role: 'Dev',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
        },
        SESSION_TTL_SECONDS,
        {},
      );
      expect(result).toEqual({
        user: {
          id: uuid(1),
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          role: 'Dev',
        },
        sid: 'sid-new',
        ttlSeconds: SESSION_TTL_SECONDS,
      });
      expect(sessions.destroyAndUnindex).not.toHaveBeenCalled();
    });

    it('uses the remember TTL when remember is true', async () => {
      const user = buildUser({ id: uuid(1), emailVerifiedAt: new Date() });
      repository.findByEmail.mockResolvedValue(user);
      compareMock.mockResolvedValue(true);
      sessions.create.mockResolvedValue('sid-new');

      const result = await service.login({ ...loginDto, remember: true });

      expect(sessions.create).toHaveBeenCalledWith(
        expect.anything(),
        SESSION_REMEMBER_TTL_SECONDS,
        {},
      );
      expect(result.ttlSeconds).toBe(SESSION_REMEMBER_TTL_SECONDS);
    });

    it('rotates out the pre-login sid using the OLD session uid', async () => {
      const user = buildUser({ id: uuid(1), emailVerifiedAt: new Date() });
      repository.findByEmail.mockResolvedValue(user);
      compareMock.mockResolvedValue(true);
      sessions.create.mockResolvedValue('sid-new');
      sessions.get.mockResolvedValue({
        userId: uuid(99),
        role: 'Dev',
        name: 'Other',
        email: 'other@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      sessions.destroyAndUnindex.mockResolvedValue(1);

      await service.login(loginDto, 'sid-old');

      expect(sessions.get).toHaveBeenCalledWith('sid-old');
      expect(sessions.destroyAndUnindex).toHaveBeenCalledWith(
        'sid-old',
        uuid(99),
      );
    });

    it('rotation is a no-op when the old session is already gone', async () => {
      const user = buildUser({ id: uuid(1), emailVerifiedAt: new Date() });
      repository.findByEmail.mockResolvedValue(user);
      compareMock.mockResolvedValue(true);
      sessions.create.mockResolvedValue('sid-new');
      sessions.get.mockResolvedValue(null);

      await service.login(loginDto, 'sid-old');

      expect(sessions.destroyAndUnindex).not.toHaveBeenCalled();
    });

    it('rotation failures are swallowed — login still succeeds', async () => {
      const user = buildUser({ id: uuid(1), emailVerifiedAt: new Date() });
      repository.findByEmail.mockResolvedValue(user);
      compareMock.mockResolvedValue(true);
      sessions.create.mockResolvedValue('sid-new');
      sessions.get.mockRejectedValue(new Error('redis down'));

      const result = await service.login(loginDto, 'sid-old');

      expect(result.sid).toBe('sid-new');
      expect(sessions.destroyAndUnindex).not.toHaveBeenCalled();
    });

    it('unknown email compares against the DUMMY_HASH and answers the generic 401', async () => {
      repository.findByEmail.mockResolvedValue(null);
      compareMock.mockResolvedValue(false);

      const error = await httpErrorFrom(service.login(loginDto), 401);

      expect(compareMock).toHaveBeenCalledWith(loginDto.password, DUMMY);
      expect(error.getResponse()).toEqual({
        status: 'invalid_credentials',
        message: INVALID_CREDENTIALS_MESSAGE,
      });
      expect(redis.incr).toHaveBeenCalledWith(loginLockoutKey(loginDto.email));
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('wrong password answers the same 401 and increments the counter', async () => {
      const user = buildUser({ id: uuid(1) });
      repository.findByEmail.mockResolvedValue(user);
      compareMock.mockResolvedValue(false);

      const error = await httpErrorFrom(service.login(loginDto), 401);

      expect(error.getResponse()).toEqual({
        status: 'invalid_credentials',
        message: INVALID_CREDENTIALS_MESSAGE,
      });
      expect(redis.incr).toHaveBeenCalledWith(loginLockoutKey(loginDto.email));
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('arms the lockout window on the first failure only', async () => {
      repository.findByEmail.mockResolvedValue(null);
      compareMock.mockResolvedValue(false);
      redis.incr.mockResolvedValueOnce(1);

      await httpErrorFrom(service.login(loginDto), 401);
      expect(redis.expire).toHaveBeenCalledTimes(1);

      redis.incr.mockResolvedValueOnce(2);
      await httpErrorFrom(service.login(loginDto), 401);
      expect(redis.expire).toHaveBeenCalledTimes(1);
    });

    it('correct password on an unverified account is 403, no session, no counter change', async () => {
      const user = buildUser({ id: uuid(1), emailVerifiedAt: null });
      repository.findByEmail.mockResolvedValue(user);
      compareMock.mockResolvedValue(true);

      const error = await httpErrorFrom(service.login(loginDto), 403);

      expect(error.getResponse()).toEqual({
        status: 'email_unverified',
        message: LOGIN_UNVERIFIED_MESSAGE,
      });
      expect(sessions.create).not.toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('locked-out email gets 429 before any bcrypt or SELECT', async () => {
      redis.get.mockResolvedValue(String(LOGIN_LOCKOUT_MAX));

      const error = await httpErrorFrom(service.login(loginDto), 429);

      expect(error.getResponse()).toEqual({
        status: 'too_many_attempts',
        message: TOO_MANY_ATTEMPTS_MESSAGE,
      });
      expect(repository.findByEmail).not.toHaveBeenCalled();
      expect(compareMock).not.toHaveBeenCalled();
    });

    it('a corrupt stored hash logs and answers 401 (not a 500)', async () => {
      const user = buildUser({ id: uuid(1) });
      repository.findByEmail.mockResolvedValue(user);
      compareMock.mockRejectedValue(new Error('Invalid salt version'));

      await httpErrorFrom(service.login(loginDto), 401);
    });

    it('session MULTI failure propagates (login never succeeds un-indexed)', async () => {
      const user = buildUser({ id: uuid(1), emailVerifiedAt: new Date() });
      repository.findByEmail.mockResolvedValue(user);
      compareMock.mockResolvedValue(true);
      sessions.create.mockRejectedValue(new Error('MULTI failed'));

      await expect(service.login(loginDto)).rejects.toThrow('MULTI failed');
    });

    it('a failed lockout counter never masks the 401', async () => {
      repository.findByEmail.mockResolvedValue(null);
      compareMock.mockResolvedValue(false);
      redis.incr.mockRejectedValue(new Error('redis down'));

      await httpErrorFrom(service.login(loginDto), 401);
    });
  });

  describe('logout', () => {
    const session = {
      userId: uuid(1),
      role: 'Dev' as const,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    it('no cookie → revoked 0, no Redis writes', async () => {
      const result = await service.logout(undefined, false);

      expect(result).toEqual({ message: LOGOUT_MESSAGE, revoked: 0 });
      expect(sessions.get).not.toHaveBeenCalled();
      expect(sessions.destroyAndUnindex).not.toHaveBeenCalled();
    });

    it('dead/expired sid → revoked 0', async () => {
      sessions.get.mockResolvedValue(null);

      const result = await service.logout('dead-sid', false);

      expect(result).toEqual({ message: LOGOUT_MESSAGE, revoked: 0 });
      expect(sessions.destroyAndUnindex).not.toHaveBeenCalled();
    });

    it('this device destroys + unindexes only its own session', async () => {
      sessions.get.mockResolvedValue(session);
      sessions.destroyAndUnindex.mockResolvedValue(1);

      const result = await service.logout('sid1', false);

      expect(sessions.destroyAndUnindex).toHaveBeenCalledWith('sid1', uuid(1));
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
      expect(result).toEqual({ message: LOGOUT_MESSAGE, revoked: 1 });
    });

    it('redis write failure still resolves revoked 0 (best-effort)', async () => {
      sessions.get.mockResolvedValue(session);
      sessions.destroyAndUnindex.mockRejectedValue(new Error('redis down'));

      const result = await service.logout('sid1', false);

      expect(result).toEqual({ message: LOGOUT_MESSAGE, revoked: 0 });
    });

    it('corrupt payload destroys the key and reports revoked 0', async () => {
      sessions.get.mockRejectedValue(new SyntaxError('bad json'));
      sessions.destroy.mockResolvedValue(undefined);

      const result = await service.logout('sid1', false);

      expect(sessions.destroy).toHaveBeenCalledWith('sid1');
      expect(result).toEqual({ message: LOGOUT_MESSAGE, revoked: 0 });
    });

    it('allDevices revokes every session for the uid', async () => {
      sessions.get.mockResolvedValue(session);
      sessions.revokeAllForUser.mockResolvedValue(3);

      const result = await service.logout('sid1', true);

      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(uuid(1));
      expect(result).toEqual({ message: LOGOUT_ALL_MESSAGE, revoked: 3 });
    });

    it('allDevices without a valid session revokes nothing', async () => {
      sessions.get.mockResolvedValue(null);

      const result = await service.logout(undefined, true);

      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
      expect(result).toEqual({ message: LOGOUT_ALL_MESSAGE, revoked: 0 });
    });

    it('allDevices redis failure still resolves revoked 0', async () => {
      sessions.get.mockResolvedValue(session);
      sessions.revokeAllForUser.mockRejectedValue(new Error('redis down'));

      const result = await service.logout('sid1', true);

      expect(result).toEqual({ message: LOGOUT_ALL_MESSAGE, revoked: 0 });
    });
  });

  describe('me', () => {
    it('returns the snapshot from the session (0 Postgres reads)', async () => {
      sessions.get.mockResolvedValue({
        userId: uuid(1),
        role: 'Dev' as const,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await service.me('sid1');

      expect(repository.findByEmail).not.toHaveBeenCalled();
      expect(repository.findById).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'authenticated',
        user: {
          id: uuid(1),
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          role: 'Dev',
        },
      });
    });

    it('is unauthenticated without a cookie', async () => {
      expect(await service.me(undefined)).toEqual({
        status: 'unauthenticated',
      });
      expect(sessions.get).not.toHaveBeenCalled();
    });

    it('is unauthenticated on a miss', async () => {
      sessions.get.mockResolvedValue(null);

      expect(await service.me('dead')).toEqual({ status: 'unauthenticated' });
    });

    it('corrupt payload destroys the sid and is unauthenticated', async () => {
      sessions.get.mockRejectedValue(new SyntaxError('bad json'));
      sessions.destroy.mockResolvedValue(undefined);

      expect(await service.me('corrupt')).toEqual({
        status: 'unauthenticated',
      });
      expect(sessions.destroy).toHaveBeenCalledWith('corrupt');
    });

    it('a Redis outage propagates (500, never a false sign-out)', async () => {
      sessions.get.mockRejectedValue(new Error('redis down'));

      await expect(service.me('sid1')).rejects.toThrow('redis down');
    });
  });

  describe('listSessions', () => {
    const currentSnapshot = {
      userId: uuid(1),
      role: 'Dev' as const,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: '2026-01-01T00:00:00.000Z',
      publicId: 'current12hnd',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ip: '10.0.0.1',
    };

    it('returns [] when the current session is gone', async () => {
      sessions.get.mockResolvedValue(null);

      expect(await service.listSessions('dead')).toEqual([]);
      expect(sessions.listForUser).not.toHaveBeenCalled();
    });

    it('maps rows, marks current first and derives online from the window', async () => {
      sessions.get.mockResolvedValue(currentSnapshot);
      sessions.listForUser.mockResolvedValue([
        {
          sid: 'sid-other',
          data: {
            ...currentSnapshot,
            publicId: 'other12hndx',
            userAgent:
              'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
            ip: '10.0.0.2',
            lastActiveAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          },
          expiresAtMs: Date.now() + 3_600_000,
        },
        {
          sid: 'sid-current',
          data: currentSnapshot,
          expiresAtMs: Date.now() + 86_400_000,
        },
      ]);

      const result = await service.listSessions('sid-current');

      expect(result).toHaveLength(2);
      // Current session sorts first regardless of input order.
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'current12hnd',
          current: true,
          online: true,
          ip: '10.0.0.1',
          device: expect.any(String),
          browser: expect.stringContaining('Chrome'),
        }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          id: 'other12hndx',
          current: false,
          // Last active an hour ago → outside the 5-minute window.
          online: false,
          device: expect.stringContaining('iPhone'),
        }),
      );
      expect(new Date(result[0].expiresAt).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('falls back safely for legacy sessions without the new fields', async () => {
      sessions.get.mockResolvedValue({
        userId: uuid(1),
        role: 'Dev' as const,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      sessions.listForUser.mockResolvedValue([
        {
          sid: 'legacy'.padEnd(64, '0'),
          data: {
            userId: uuid(1),
            role: 'Dev' as const,
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          expiresAtMs: Date.now() + 1000,
        },
      ]);

      const result = await service.listSessions('legacy'.padEnd(64, '0'));

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(
        expect.objectContaining({
          device: 'Unknown device',
          browser: 'Unknown browser',
          ip: 'Unknown',
          current: true,
          online: true,
        }),
      );
    });
  });

  describe('revokeSession', () => {
    const snapshot = {
      userId: uuid(1),
      role: 'Dev' as const,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: '2026-01-01T00:00:00.000Z',
      publicId: 'target12hnd',
    };

    it('revokes by publicId among the caller’s own sessions only', async () => {
      sessions.get.mockResolvedValue(snapshot);
      sessions.listForUser.mockResolvedValue([
        { sid: 'sid-target', data: snapshot, expiresAtMs: Date.now() + 1000 },
        {
          sid: 'sid-other',
          data: { ...snapshot, publicId: 'other12hndx' },
          expiresAtMs: Date.now() + 1000,
        },
      ]);
      sessions.destroyAndUnindex.mockResolvedValue(1);

      const { result, revokedCurrent } = await service.revokeSession(
        'sid-current',
        'target12hnd',
      );

      expect(sessions.destroyAndUnindex).toHaveBeenCalledWith(
        'sid-target',
        uuid(1),
      );
      expect(result).toEqual({ message: LOGOUT_MESSAGE, revoked: 1 });
      expect(revokedCurrent).toBe(false);
    });

    it('flags revokedCurrent when the caller kills their own session', async () => {
      sessions.get.mockResolvedValue(snapshot);
      sessions.listForUser.mockResolvedValue([
        { sid: 'sid-self', data: snapshot, expiresAtMs: Date.now() + 1000 },
      ]);
      sessions.destroyAndUnindex.mockResolvedValue(1);

      const { revokedCurrent } = await service.revokeSession(
        'sid-self',
        'target12hnd',
      );

      expect(revokedCurrent).toBe(true);
    });

    it('is idempotent for an unknown handle (revoked: 0, no writes)', async () => {
      sessions.get.mockResolvedValue(snapshot);
      sessions.listForUser.mockResolvedValue([
        { sid: 'sid-a', data: snapshot, expiresAtMs: Date.now() + 1000 },
      ]);

      const { result, revokedCurrent } = await service.revokeSession(
        'sid-current',
        'nope',
      );

      expect(sessions.destroyAndUnindex).not.toHaveBeenCalled();
      expect(result).toEqual({ message: LOGOUT_MESSAGE, revoked: 0 });
      expect(revokedCurrent).toBe(false);
    });

    it('returns revoked: 0 when the current session is already gone', async () => {
      sessions.get.mockResolvedValue(null);

      const { result } = await service.revokeSession('dead', 'target12hnd');

      expect(result.revoked).toBe(0);
      expect(sessions.listForUser).not.toHaveBeenCalled();
    });

    it('resolves revoked: 0 (best-effort) on a Redis failure', async () => {
      sessions.get.mockResolvedValue(snapshot);
      sessions.listForUser.mockRejectedValue(new Error('redis down'));

      const { result } = await service.revokeSession(
        'sid-current',
        'target12hnd',
      );

      expect(result).toEqual({ message: LOGOUT_MESSAGE, revoked: 0 });
    });
  });
});
