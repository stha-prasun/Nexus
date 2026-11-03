import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from '../storage/storage.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HealthRepository } from './repositories/health.repository';

@Module({
  imports: [DatabaseModule, RedisModule, StorageModule],
  controllers: [HealthController],
  providers: [HealthService, HealthRepository],
})
export class HealthModule {}
