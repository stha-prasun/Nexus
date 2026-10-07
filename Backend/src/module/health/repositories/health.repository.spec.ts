import { Test, type TestingModule } from '@nestjs/testing';
import {
  MINIO_CLIENT,
  POSTGRES_POOL,
  REDIS_CLIENT,
} from '../constants/health.contants';
import { HealthRepository } from './health.repository';

describe('HealthRepository', () => {
  let repository: HealthRepository;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthRepository,
        { provide: POSTGRES_POOL, useValue: pool },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: MINIO_CLIENT, useValue: minio },
      ],
    }).compile();

    repository = module.get<HealthRepository>(HealthRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  it('checkAll queries every dependency and reports them up', async () => {
    const checks = await repository.checkAll();

    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
    expect(redis.ping).toHaveBeenCalledTimes(1);
    expect(minio.listBuckets).toHaveBeenCalledTimes(1);

    expect(checks).toEqual({
      postgres: { status: 'up', latencyMs: expect.any(Number) },
      redis: { status: 'up', latencyMs: expect.any(Number) },
      minio: { status: 'up', latencyMs: expect.any(Number) },
    });
  });

  it('marks only the failing dependency down, with its error message', async () => {
    redis.ping.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    );

    const checks = await repository.checkAll();

    expect(checks.redis).toEqual({
      status: 'down',
      latencyMs: expect.any(Number),
      error: expect.stringContaining('ECONNREFUSED'),
    });
    expect(checks.postgres.status).toBe('up');
    expect(checks.minio.status).toBe('up');
  });

  it('never throws, even when every dependency fails', async () => {
    pool.query.mockRejectedValue(new Error('timeout'));
    redis.ping.mockRejectedValue(new Error('Connection is closed.'));
    minio.listBuckets.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const checks = await repository.checkAll();

    expect(checks.postgres.status).toBe('down');
    expect(checks.redis.status).toBe('down');
    expect(checks.minio.status).toBe('down');
  });

  it('closes the postgres pool and redis client on shutdown', async () => {
    await repository.onModuleDestroy();

    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(redis.quit).toHaveBeenCalledTimes(1);
  });
});
