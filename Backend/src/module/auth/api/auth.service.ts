import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { Redis } from 'ioredis';
import { AppLogger } from '../../../common/logger/logger';
import { MailQueue } from '../../mail/mail.queue';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import {
  DUMMY_HASH,
  EMAIL_TAKEN_MESSAGE,
  EMAIL_UNVERIFIED_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  LOGIN_LOCKOUT_MAX,
  LOGIN_LOCKOUT_WINDOW_SECONDS,
  LOGIN_UNVERIFIED_MESSAGE,
  LOGOUT_ALL_MESSAGE,
  LOGOUT_MESSAGE,
  loginLockoutKey,
  REGISTER_MESSAGE,
  RESEND_CONFIRMATION_MESSAGE,
  TOO_MANY_ATTEMPTS_MESSAGE,
  VERIFICATION_TOKEN_TTL_SECONDS,
  verificationTokenKey,
  verificationUserKey,
} from './constants/auth.constants';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import type { User } from './entities/user.entity';
import { UserFactory } from './factories/user.factory';
import { AuthRepository } from './repositories/auth.repository';
import {
  SESSION_REMEMBER_TTL_SECONDS,
  SESSION_TTL_SECONDS,
} from './session/session.constants';
import { SessionService } from './session/session.service';
import type { SessionData, SessionUser } from './session/session.types';

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === '23505';

/** Public user shape returned by login/me — never carries passwordHash. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: User['role'];
}

export interface LoginResult {
  user: AuthUser;
  sid: string;
  ttlSeconds: number;
}

export type LogoutResult = { message: string; revoked: number };

export type MeResult =
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'unauthenticated' };

/**
 * Auth orchestration: registration + email-confirmation (honest 409s on
 * register, no enumeration hedge) and login/logout/me on Redis sessions.
 *
 * Session semantics: login fails loudly (500) if the session MULTI did not
 * fully apply — never a live-but-unindexed session. Logout is best-effort
 * (logged, still 200). /me reads the snapshot (1 Redis read, 0 Postgres) and
 * answers 401 for missing/invalid/expired/corrupt sessions; Redis outages
 * propagate as 500 rather than falsely signing the client out.
 */
@Injectable()
export class AuthService {
  private readonly log: ReturnType<AppLogger['child']>;

  constructor(
    private readonly userFactory: UserFactory,
    private readonly repository: AuthRepository,
    private readonly mailQueue: MailQueue,
    private readonly sessions: SessionService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(DUMMY_HASH) private readonly dummyHash: string,
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

  /**
   * Login (order is load-bearing — see plan §4.1): lockout → SELECT →
   * bcrypt (against the eager DUMMY_HASH when the email is unknown, so
   * timing can't distinguish) → verified check → clear counter → create +
   * index session (MULTI, inspected) → best-effort rotate out the old sid.
   * `currentSid` is the pre-login cookie, if any (fixation defense).
   */
  async login(dto: LoginDto, currentSid?: string): Promise<LoginResult> {
    const key = loginLockoutKey(dto.email);
    const failures = await this.redis.get(key);
    if (failures !== null && Number(failures) >= LOGIN_LOCKOUT_MAX) {
      throw new HttpException(
        {
          status: 'too_many_attempts',
          message: TOO_MANY_ATTEMPTS_MESSAGE,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.repository.findByEmail(dto.email);
    const match = await this.comparePasswords(
      dto.password,
      user?.passwordHash ?? this.dummyHash,
    );

    // Unknown email and wrong password are byte-identical 401s; both count
    // toward the lockout so the failure path can't be told apart either.
    if (user === null || !match) {
      await this.recordFailedAttempt(key);
      throw new UnauthorizedException({
        status: 'invalid_credentials',
        message: INVALID_CREDENTIALS_MESSAGE,
      });
    }

    // Password checked first — unverified only leaks to someone who has it.
    if (!user.isVerified) {
      throw new ForbiddenException({
        status: 'email_unverified',
        message: LOGIN_UNVERIFIED_MESSAGE,
      });
    }

    await this.redis.del(key);

    const ttlSeconds =
      dto.remember === true
        ? SESSION_REMEMBER_TTL_SECONDS
        : SESSION_TTL_SECONDS;
    const snapshot: SessionUser = {
      userId: user.id as string,
      role: user.role,
      name: user.name,
      email: user.email,
    };
    const sid = await this.sessions.create(snapshot, ttlSeconds);

    // Fixation defense: the pre-login sid is never reused. Best-effort —
    // a failed destroy lives to TTL but stays indexed for revoke-all.
    if (currentSid !== undefined && currentSid.length > 0) {
      await this.retireSession(currentSid);
    }

    return { user: this.toAuthUser(snapshot), sid, ttlSeconds };
  }

  /**
   * Logout — always 200 and idempotent. `allDevices: true` revokes every
   * session for the user (needs a valid session: no uid without one, so an
   * anonymous caller revokes nothing). Failures are logged, never thrown.
   */
  async logout(
    sid: string | undefined,
    allDevices: boolean,
  ): Promise<LogoutResult> {
    const message = allDevices ? LOGOUT_ALL_MESSAGE : LOGOUT_MESSAGE;

    if (sid === undefined || sid.length === 0) {
      return { message, revoked: 0 };
    }

    const session = await this.readSession(sid);
    if (session === null) {
      return { message, revoked: 0 };
    }

    try {
      const revoked = allDevices
        ? await this.sessions.revokeAllForUser(session.userId)
        : await this.sessions.destroyAndUnindex(sid, session.userId);
      return { message, revoked };
    } catch (error) {
      this.log.error('logout redis write failed', {
        allDevices,
        error: error instanceof Error ? error.message : String(error),
      });
      return { message, revoked: 0 };
    }
  }

  /**
   * Session snapshot for /auth/me. Redis outages propagate (500 — a
   * transient outage must not sign the client out); a corrupt payload is a
   * miss: the sid is destroyed and the caller clears the cookie.
   */
  async me(sid: string | undefined): Promise<MeResult> {
    if (sid === undefined || sid.length === 0) {
      return { status: 'unauthenticated' };
    }
    const session = await this.readSession(sid);
    if (session === null) {
      return { status: 'unauthenticated' };
    }
    return { status: 'authenticated', user: this.toAuthUser(session) };
  }

  /** A corrupt payload is not an authentication verdict — just a dead key. */
  private async readSession(sid: string): Promise<SessionData | null> {
    try {
      return await this.sessions.get(sid);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      this.log.error('corrupt session payload', { sid });
      try {
        await this.sessions.destroy(sid);
      } catch (destroyError) {
        this.log.error('corrupt session destroy failed', {
          error:
            destroyError instanceof Error
              ? destroyError.message
              : String(destroyError),
        });
      }
      return null;
    }
  }

  /**
   * Compare against the eager DUMMY_HASH for unknown emails so a miss costs
   * a real bcrypt. A corrupt stored hash logs and answers "no match" — a
   * 401, not a 500 that hints at database state.
   */
  private async comparePasswords(
    password: string,
    hash: string,
  ): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      this.log.error('password compare failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /** 10 failures / 15 min per email → 429. Counter dies with its window. */
  private async recordFailedAttempt(key: string): Promise<void> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, LOGIN_LOCKOUT_WINDOW_SECONDS);
      }
    } catch (error) {
      // The 401 still stands — a failed counter is never worth a 500.
      this.log.error('login failure counter write failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Best-effort destroy of a superseded sid (login rotation). Keyed by the
   * OLD session's uid — the pre-login cookie can belong to a different user.
   */
  private async retireSession(oldSid: string): Promise<void> {
    try {
      const old = await this.sessions.get(oldSid);
      if (old === null) return;
      await this.sessions.destroyAndUnindex(oldSid, old.userId);
    } catch (error) {
      this.log.error('session rotation cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private toAuthUser(snapshot: SessionUser): AuthUser {
    return {
      id: snapshot.userId,
      name: snapshot.name,
      email: snapshot.email,
      role: snapshot.role,
    };
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
