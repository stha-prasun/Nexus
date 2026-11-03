import { Test, type TestingModule } from '@nestjs/testing';
import { POSTGRES_POOL } from '../../database/constants/database.contants';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import { StorageService } from '../../storage/storage.service';
import { HealthRepository } from './health.repository';

describe('HealthRepository', () => {
  let repository: HealthRepository;

  const pool = { query: jest.fn(), end: jest.fn() };
  const redis = { ping: jest.fn(), quit: jest.fn() };
  const storage = { probe: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue(undefined);
    pool.end.mockResolvedValue(undefined);
    redis.ping.mockResolvedValue('PONG');
    redis.quit.mockResolvedValue('OK');
    storage.probe.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthRepository,
        { provide: POSTGRES_POOL, useValue: pool },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: StorageService, useValue: storage },
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
    expect(storage.probe).toHaveBeenCalledTimes(1);

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
    storage.probe.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const checks = await repository.checkAll();

    expect(checks.postgres.status).toBe('down');
    expect(checks.redis.status).toBe('down');
    expect(checks.minio.status).toBe('down');
  });
});
