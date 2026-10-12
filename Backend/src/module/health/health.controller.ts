import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthReportDto } from './dto/health-report.dto';
import { HealthService } from './health.service';
import type { HealthReport } from './interfaces/health.interfaces';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Probe postgres, redis and minio' })
  @ApiOkResponse({
    type: HealthReportDto,
    description: 'All dependencies are up',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    type: HealthReportDto,
    description: 'One or more dependencies are down',
  })
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
