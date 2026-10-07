import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Client } from 'minio';
import { Pool } from 'pg';
import {
  MINIO_CLIENT,
  POSTGRES_POOL,
  REDIS_CLIENT,
} from './constants/health.contants';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HealthRepository } from './repositories/health.repository';

// Defaults mirror Backend/.env (and docker-compose.yml), so `docker compose
// up -d` + `npm start` works even without a .env file present.
const env = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    HealthRepository,
    {
      provide: POSTGRES_POOL,
      useFactory: () =>
        new Pool({
          host: env('POSTGRES_HOST', 'localhost'),
          port: Number(env('POSTGRES_PORT', '6432')),
          user: env('POSTGRES_USER', 'nexus'),
          password: env('POSTGRES_PASSWORD', 'nexus_dev_password'),
          database: env('POSTGRES_DB', 'nexus'),
          max: Number(env('POSTGRES_POOL_MAX', '10')),
          connectionTimeoutMillis: 2000,
        }),
    },
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const client = new Redis({
          host: env('REDIS_HOST', 'localhost'),
          port: Number(env('REDIS_PORT', '6379')),
          connectTimeout: 2000,
          commandTimeout: 2000,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        // Without a listener, a down redis would crash the process on 'error'.
        client.on('error', () => undefined);
        return client;
      },
    },
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
  exports: [POSTGRES_POOL, REDIS_CLIENT, MINIO_CLIENT],
})
export class HealthModule {}
