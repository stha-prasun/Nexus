import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import type { HealthReport } from './interfaces/health.interfaces';

describe('HealthController', () => {
  let controller: HealthController;

  const healthService = { check: jest.fn() };
  const res = { status: jest.fn() };

  const healthyReport: HealthReport = {
    status: 'ok',
    timestamp: '2026-10-07T00:00:00.000Z',
    uptime: 12.34,
    checks: {
      postgres: { status: 'up', latencyMs: 3 },
      redis: { status: 'up', latencyMs: 1 },
      minio: { status: 'up', latencyMs: 5 },
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: healthService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('returns the report as-is when healthy (implicit 200)', async () => {
    healthService.check.mockResolvedValue(healthyReport);

    const result = await controller.check(res as unknown as Response);

    expect(result).toBe(healthyReport);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('sets 503 while still returning the report when unhealthy', async () => {
    const degradedReport: HealthReport = {
      ...healthyReport,
      status: 'error',
      checks: {
        postgres: { status: 'up', latencyMs: 3 },
        redis: { status: 'down', latencyMs: 1, error: 'Connection is closed.' },
        minio: { status: 'up', latencyMs: 5 },
      },
    };
    healthService.check.mockResolvedValue(degradedReport);

    const result = await controller.check(res as unknown as Response);

    expect(result).toBe(degradedReport);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
