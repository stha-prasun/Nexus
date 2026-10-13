import { Test, type TestingModule } from '@nestjs/testing';
import { AppLogger } from '../../../common/logger/logger';
import { MailQueue } from '../../mail/mail.queue';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import { AuthService } from './auth.service';
import {
  REGISTER_MESSAGE,
  RESEND_CONFIRMATION_MESSAGE,
  VERIFICATION_TOKEN_TTL_SECONDS,
} from './constants/auth.constants';
import type { RegisterDto } from './dto/register.dto';
import { User } from './entities/user.entity';
import { UserFactory } from './factories/user.factory';
import { AuthRepository } from './repositories/auth.repository';

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
    pipeline: jest.fn(() => pipeline),
  };

  const buildUser = (
    overrides: Partial<ConstructorParameters<typeof User>[0]> = {},
  ) =>
    new User({
      id: 1,
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
    role: 'Dev',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    pipeline.exec.mockResolvedValue([]);
    mailQueue.enqueueVerification.mockResolvedValue(undefined);
    mailQueue.enqueueAccountExists.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: repository },
        { provide: UserFactory, useValue: userFactory },
        { provide: MailQueue, useValue: mailQueue },
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
      const user = buildUser({ id: 42 });
      repository.findByEmail.mockResolvedValue(null);
      userFactory.create.mockResolvedValue(user);
      repository.insert.mockResolvedValue(user);

      const result = await service.register(dto);

      expect(userFactory.create).toHaveBeenCalledWith(dto);
      expect(repository.insert).toHaveBeenCalledWith(user);
      expect(pipeline.set).toHaveBeenCalledTimes(2);
      expect(pipeline.exec).toHaveBeenCalledTimes(1);
      expect(mailQueue.enqueueVerification).toHaveBeenCalledWith(42);
      expect(result).toEqual({ message: REGISTER_MESSAGE });
    });

    it('regenerates the token for an existing unverified account', async () => {
      const user = buildUser({ id: 5 });
      repository.findByEmail.mockResolvedValue(user);

      const result = await service.register(dto);

      expect(userFactory.create).not.toHaveBeenCalled();
      expect(pipeline.set).toHaveBeenCalledTimes(2);
      expect(mailQueue.enqueueVerification).toHaveBeenCalledWith(5);
      expect(result).toEqual({ message: REGISTER_MESSAGE });
    });

    it('sends an account-exists notice for a verified account, same response', async () => {
      const user = buildUser({ id: 5, emailVerifiedAt: new Date() });
      repository.findByEmail.mockResolvedValue(user);

      const result = await service.register(dto);

      expect(mailQueue.enqueueAccountExists).toHaveBeenCalledWith(5);
      expect(mailQueue.enqueueVerification).not.toHaveBeenCalled();
      expect(result).toEqual({ message: REGISTER_MESSAGE });
    });

    it('treats a unique-violation race (23505) as the existing branch', async () => {
      const existing = buildUser({ id: 9 });
      repository.findByEmail
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existing);
      userFactory.create.mockResolvedValue(buildUser({ id: undefined }));
      repository.insert.mockRejectedValue(
        Object.assign(new Error('dup'), { code: '23505' }),
      );

      const result = await service.register(dto);

      expect(mailQueue.enqueueVerification).toHaveBeenCalledWith(9);
      expect(result).toEqual({ message: REGISTER_MESSAGE });
    });

    it('rethrows non-unique insert errors', async () => {
      repository.findByEmail.mockResolvedValue(null);
      userFactory.create.mockResolvedValue(buildUser());
      repository.insert.mockRejectedValue(new Error('boom'));

      await expect(service.register(dto)).rejects.toThrow('boom');
    });

    it('still returns 201-equivalent when enqueue fails (logged, not thrown)', async () => {
      const user = buildUser({ id: 3 });
      repository.findByEmail.mockResolvedValue(null);
      userFactory.create.mockResolvedValue(user);
      repository.insert.mockResolvedValue(user);
      mailQueue.enqueueVerification.mockRejectedValue(new Error('redis down'));

      const result = await service.register(dto);

      expect(result).toEqual({ message: REGISTER_MESSAGE });
    });
  });

  describe('verifyEmail', () => {
    it('verifies, saves and deletes both keys on a valid token', async () => {
      const user = buildUser({ id: 11 });
      redis.get.mockResolvedValue('11');
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
      redis.get.mockResolvedValue('99');
      repository.findById.mockResolvedValue(null);

      const result = await service.verifyEmail('orphan');

      expect(pipeline.del).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ status: 'invalid_or_expired' });
    });

    it('is idempotent for an already-verified user', async () => {
      const verifiedAt = new Date('2026-01-02T00:00:00Z');
      const user = buildUser({ id: 11, emailVerifiedAt: verifiedAt });
      redis.get.mockResolvedValue('11');
      repository.findById.mockResolvedValue(user);

      const result = await service.verifyEmail('sometoken');

      expect(repository.save).not.toHaveBeenCalled();
      expect(user.emailVerifiedAt).toEqual(verifiedAt);
      expect(result).toEqual({ status: 'verified' });
    });
  });

  describe('resendConfirmation', () => {
    it('regenerates the token for an unverified account', async () => {
      const user = buildUser({ id: 8 });
      repository.findByEmail.mockResolvedValue(user);

      const result = await service.resendConfirmation({ email: dto.email });

      expect(pipeline.set).toHaveBeenCalledTimes(2);
      expect(pipeline.set).toHaveBeenCalledWith(
        expect.stringContaining('auth:verify:'),
        '8',
        'EX',
        VERIFICATION_TOKEN_TTL_SECONDS,
      );
      expect(mailQueue.enqueueVerification).toHaveBeenCalledWith(8);
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
});
