import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { POSTGRES_POOL } from './../src/module/database/constants/database.contants';
import { MINIO_CLIENT } from './../src/module/health/constants/health.contants';
import {
  MAIL_QUEUE,
  MAIL_WORKER,
} from './../src/module/mail/constants/mail.constants';
import { REDIS_CLIENT } from './../src/module/redis/constants/redis.constants';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  const pool = { query: jest.fn(), end: jest.fn() };
  const redis = { ping: jest.fn(), quit: jest.fn() };
  const minio = { listBuckets: jest.fn() };
  const mailQueue = { add: jest.fn(), close: jest.fn() };
  const mailWorker = { close: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Instrumentation replaces pool.query with a plain wrapper at bootstrap,
    // so each test needs a fresh jest.fn for both mocking and re-wrapping.
    pool.query = jest.fn().mockResolvedValue(undefined);
    pool.end = jest.fn().mockResolvedValue(undefined);
    redis.ping = jest.fn().mockResolvedValue('PONG');
    redis.quit = jest.fn().mockResolvedValue('OK');
    minio.listBuckets = jest.fn().mockResolvedValue([]);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(POSTGRES_POOL)
      .useValue(pool)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      .overrideProvider(MINIO_CLIENT)
      .useValue(minio)
      .overrideProvider(MAIL_QUEUE)
      .useValue(mailQueue)
      .overrideProvider(MAIL_WORKER)
      .useValue(mailWorker)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns 200 when all dependencies are up', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
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

  it('GET /api/v1/health returns 503 with per-check details when a dependency is down', async () => {
    redis.ping.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    );

    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);

    expect(response.body.status).toBe('error');
    expect(response.body.checks.redis.status).toBe('down');
    expect(response.body.checks.redis.error).toContain('ECONNREFUSED');
    expect(response.body.checks.postgres.status).toBe('up');
    expect(response.body.checks.minio.status).toBe('up');
  });
});
