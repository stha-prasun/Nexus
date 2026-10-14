import { randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppLogger } from '../../../common/logger/logger';
import { MailQueue } from '../../mail/mail.queue';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import {
  EMAIL_TAKEN_MESSAGE,
  EMAIL_UNVERIFIED_MESSAGE,
  REGISTER_MESSAGE,
  RESEND_CONFIRMATION_MESSAGE,
  VERIFICATION_TOKEN_TTL_SECONDS,
  verificationTokenKey,
  verificationUserKey,
} from './constants/auth.constants';
import type { RegisterDto } from './dto/register.dto';
import type { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import type { User } from './entities/user.entity';
import { UserFactory } from './factories/user.factory';
import { AuthRepository } from './repositories/auth.repository';

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === '23505';

/**
 * Registration + email-confirmation orchestration. New accounts get a
 * verification link; existing accounts get an honest 409 (taken vs
 * unverified) — no enumeration hedge, no password/token changes.
 * No session is created in this pass — login is a later feature.
 */
@Injectable()
export class AuthService {
  private readonly log: ReturnType<AppLogger['child']>;

  constructor(
    private readonly userFactory: UserFactory,
    private readonly repository: AuthRepository,
    private readonly mailQueue: MailQueue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    logger: AppLogger,
  ) {
    this.log = logger.child('auth');
  }

  async register(dto: RegisterDto): Promise<{ message: string }> {
    let user = await this.repository.findByEmail(dto.email);
    let created = false;

    if (user === null) {
      try {
        user = await this.repository.insert(await this.userFactory.create(dto));
        created = true;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        // Unique-index race: someone registered between SELECT and INSERT.
        user = await this.repository.findByEmail(dto.email);
        if (user === null) throw error;
      }
    }

    if (!created) {
      if (user.isVerified) {
        // Tell the owner someone tried to register with their address.
        await this.safeEnqueue(() =>
          this.mailQueue.enqueueAccountExists(user.id as string),
        );
        throw new ConflictException({
          status: 'email_taken',
          message: EMAIL_TAKEN_MESSAGE,
        });
      }
      // Unverified: never touch the password, token or mailbox — just say so.
      throw new ConflictException({
        status: 'email_unverified',
        message: EMAIL_UNVERIFIED_MESSAGE,
      });
    }

    await this.issueVerificationToken(user);
    return { message: REGISTER_MESSAGE };
  }

  async verifyEmail(
    token: string,
  ): Promise<{ status: 'verified' | 'invalid_or_expired' }> {
    const userId = await this.redis.get(verificationTokenKey(token));
    if (userId === null) {
      return { status: 'invalid_or_expired' };
    }

    const user = await this.repository.findById(userId);
    if (user === null) {
      await this.consumeToken(token, userId);
      return { status: 'invalid_or_expired' };
    }

    if (!user.isVerified) {
      user.markEmailVerified();
      await this.repository.save(user);
    }
    await this.consumeToken(token, user.id as string);
    return { status: 'verified' };
  }

  async resendConfirmation(
    dto: ResendConfirmationDto,
  ): Promise<{ message: string }> {
    const user = await this.repository.findByEmail(dto.email);
    if (user !== null && !user.isVerified) {
      await this.issueVerificationToken(user);
    }
    return { message: RESEND_CONFIRMATION_MESSAGE };
  }

  /** Token keys are written BEFORE enqueue — enqueue-first would race the worker. */
  private async issueVerificationToken(user: User): Promise<void> {
    const userId = user.id as string;
    const token = randomBytes(32).toString('hex');

    const pipeline = this.redis.pipeline();
    pipeline.set(
      verificationTokenKey(token),
      userId,
      'EX',
      VERIFICATION_TOKEN_TTL_SECONDS,
    );
    pipeline.set(
      verificationUserKey(userId),
      token,
      'EX',
      VERIFICATION_TOKEN_TTL_SECONDS,
    );
    await pipeline.exec();

    // Old token (if any) is now unreachable — one active token per user.
    await this.safeEnqueue(() => this.mailQueue.enqueueVerification(userId));
  }

  private async consumeToken(token: string, userId: string): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.del(verificationTokenKey(token));
    pipeline.del(verificationUserKey(userId));
    await pipeline.exec();
  }

  /** Enqueue/Redis failures are logged loudly but never leak into the response. */
  private async safeEnqueue(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.log.error('email enqueue failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
