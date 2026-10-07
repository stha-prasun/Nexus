import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health.service';
import type { HealthReport } from './interfaces/health.interfaces';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthReport> {
    const report = await this.healthService.check();
    if (report.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
