import { Module } from '@nestjs/common';
import { Client } from 'minio';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { MINIO_CLIENT } from './constants/health.contants';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HealthRepository } from './repositories/health.repository';

// Defaults mirror Backend/.env (and docker-compose.yml), so `docker compose
// up -d` + `npm start` works even without a .env file present.
const env = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

@Module({
  imports: [DatabaseModule, RedisModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    HealthRepository,
    {
      provide: MINIO_CLIENT,
      useFactory: () =>
        new Client({
          endPoint: env('MINIO_ENDPOINT', 'localhost'),
          port: Number(env('MINIO_API_PORT', '9000')),
          useSSL: false,
          accessKey: env('MINIO_ROOT_USER', 'nexus'),
          secretKey: env('MINIO_ROOT_PASSWORD', 'nexus_minio_password'),
        }),
    },
  ],
  exports: [MINIO_CLIENT],
})
export class HealthModule {}
