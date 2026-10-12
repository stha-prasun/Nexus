import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { HealthModule } from './module/health/health.module';

@Module({
  imports: [CommonModule, HealthModule],
})
export class AppModule {}
