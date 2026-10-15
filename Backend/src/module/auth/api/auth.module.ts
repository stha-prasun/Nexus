import { randomBytes } from 'node:crypto';
import { Module } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { DatabaseModule } from '../../database/database.module';
import { MailModule } from '../../mail/mail.module';
import { RedisModule } from '../../redis/redis.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BCRYPT_ROUNDS, DUMMY_HASH } from './constants/auth.constants';
import { UserFactory } from './factories/user.factory';
import { SessionAuthGuard } from './guards/session-auth.guard';
import { AuthRepository } from './repositories/auth.repository';
import { SessionService } from './session/session.service';

const bcryptRoundsProvider = {
  provide: BCRYPT_ROUNDS,
  useFactory: (): number => {
    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    return Number.isFinite(rounds) && rounds >= 4 && rounds <= 31 ? rounds : 12;
  },
};

/**
 * Eager (not lazy) so the first unknown-email login isn't ~3× slower than a
 * real one. Hex string in, never a Buffer. Same BCRYPT_ROUNDS source as
 * register, so the cost always matches real hashes.
 */
const dummyHashProvider = {
  provide: DUMMY_HASH,
  useFactory: async (rounds: number): Promise<string> =>
    bcrypt.hash(randomBytes(32).toString('hex'), rounds),
  inject: [BCRYPT_ROUNDS],
};

@Module({
  imports: [DatabaseModule, RedisModule, MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    UserFactory,
    SessionService,
    SessionAuthGuard,
    bcryptRoundsProvider,
    dummyHashProvider,
  ],
  // SessionAuthGuard is only applied where @UseGuards is used (organization
  // routes today) — a global auth guard stays deferred per the auth plan.
  exports: [SessionService, SessionAuthGuard],
})
export class AuthModule {}
