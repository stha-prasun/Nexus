import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { AuthModule } from './module/auth/api/auth.module';
import { HealthModule } from './module/health/health.module';

@Module({
  imports: [CommonModule, HealthModule, AuthModule],
})
export class AppModule {}
