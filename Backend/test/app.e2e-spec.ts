import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { POSTGRES_POOL } from './../src/module/database/constants/database.contants';
import {
  MINIO_CLIENT,
  REDIS_CLIENT,
} from './../src/module/health/constants/health.contants';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  const pool = { query: jest.fn(), end: jest.fn() };
  const redis = { ping: jest.fn(), quit: jest.fn() };
  const minio = { listBuckets: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue(undefined);
    pool.end.mockResolvedValue(undefined);
    redis.ping.mockResolvedValue('PONG');
    redis.quit.mockResolvedValue('OK');
    minio.listBuckets.mockResolvedValue([]);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(POSTGRES_POOL)
      .useValue(pool)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      .overrideProvider(MINIO_CLIENT)
      .useValue(minio)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health returns 200 when all dependencies are up', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      uptime: expect.any(Number),
      checks: {
        postgres: { status: 'up', latencyMs: expect.any(Number) },
        redis: { status: 'up', latencyMs: expect.any(Number) },
        minio: { status: 'up', latencyMs: expect.any(Number) },
      },
    });
  });

  it('GET /health returns 503 with per-check details when a dependency is down', async () => {
    redis.ping.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    );

    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(503);

    expect(response.body.status).toBe('error');
    expect(response.body.checks.redis.status).toBe('down');
    expect(response.body.checks.redis.error).toContain('ECONNREFUSED');
    expect(response.body.checks.postgres.status).toBe('up');
    expect(response.body.checks.minio.status).toBe('up');
  });
});
