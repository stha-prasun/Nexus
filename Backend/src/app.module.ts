import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { CommonModule } from './common/common.module';
import { AuthModule } from './module/auth/api/auth.module';
import { HealthModule } from './module/health/health.module';

@Module({
  imports: [
    CommonModule,
    HealthModule,
    AuthModule,
    // Global abuse control (per-IP); register/resend tighten further via @Throttle.
    ThrottlerModule.forRoot([{ name: 'default', limit: 100, ttl: 60_000 }]),
  ],
  providers: [
    // whitelist strips unknown fields; transform runs class-transformer so
    // DTO @Transform normalizers and validation metadata apply. Implicit
    // conversion stays OFF — non-string JSON types must fail @IsString.
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class AppModule {}
