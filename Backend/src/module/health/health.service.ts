import { Injectable } from '@nestjs/common';
import type { HealthReport } from './interfaces/health.interfaces';
import { HealthRepository } from './repositories/health.repository';

@Injectable()
export class HealthService {
  constructor(private readonly healthRepository: HealthRepository) {}

  async check(): Promise<HealthReport> {
    const checks = await this.healthRepository.checkAll();
    const healthy = Object.values(checks).every(
      (check) => check.status === 'up',
    );

    return {
      status: healthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    };
  }
}
