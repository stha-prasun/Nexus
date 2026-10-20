import { Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CommonModule } from './common/common.module';
import { AuthModule } from './module/auth/api/auth.module';
import { HealthModule } from './module/health/health.module';
import { MembersModule } from './module/members/api/members.module';
import { OrganizationModule } from './module/organization/api/organization.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    CommonModule,
    HealthModule,
    AuthModule,
    // Global abuse control (per-IP); register/resend tighten further via @Throttle.
    ThrottlerModule.forRoot([{ name: 'default', limit: 100, ttl: 60_000 }]),
    OrganizationModule,
    MembersModule,
    ProjectsModule,
  ],
  providers: [
    // Enforces ThrottlerModule limits + every @Throttle override (register
    // 5/10min, resend-confirmation 3/10min). Without this guard the
    // decorators are inert.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
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
