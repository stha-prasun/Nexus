import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MailModule } from '../../mail/mail.module';
import { RedisModule } from '../../redis/redis.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { BCRYPT_ROUNDS } from './constants/auth.constants';
import { UserFactory } from './factories/user.factory';
import { AuthRepository } from './repositories/auth.repository';
import { SessionService } from './session/session.service';

const bcryptRoundsProvider = {
  provide: BCRYPT_ROUNDS,
  useFactory: (): number => {
    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    return Number.isFinite(rounds) && rounds >= 4 && rounds <= 31 ? rounds : 12;
  },
};

@Module({
  imports: [DatabaseModule, RedisModule, MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    UserFactory,
    SessionService,
    bcryptRoundsProvider,
  ],
})
export class AuthModule {}
