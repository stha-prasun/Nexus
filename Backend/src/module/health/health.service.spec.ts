import { Test, type TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service';
import type { CheckResult } from './interfaces/health.interfaces';
import { HealthRepository } from './repositories/health.repository';

describe('HealthService', () => {
  let service: HealthService;

  const healthRepository = { checkAll: jest.fn() };

  const allUp: Record<string, CheckResult> = {
    postgres: { status: 'up', latencyMs: 3 },
    redis: { status: 'up', latencyMs: 1 },
    minio: { status: 'up', latencyMs: 5 },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    healthRepository.checkAll.mockResolvedValue(allUp);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: HealthRepository, useValue: healthRepository },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('builds an ok report around the repository results', async () => {
    const report = await service.check();

    expect(healthRepository.checkAll).toHaveBeenCalledTimes(1);
    expect(report.status).toBe('ok');
    expect(report.timestamp).toEqual(expect.any(String));
    expect(report.uptime).toEqual(expect.any(Number));
    expect(report.checks).toBe(allUp);
  });

  it('reports error when any dependency is down', async () => {
    healthRepository.checkAll.mockResolvedValue({
      ...allUp,
      redis: { status: 'down', latencyMs: 1, error: 'Connection is closed.' },
    });

    const report = await service.check();

    expect(report.status).toBe('error');
    expect(report.checks.redis.status).toBe('down');
    expect(report.checks.postgres.status).toBe('up');
  });
});
