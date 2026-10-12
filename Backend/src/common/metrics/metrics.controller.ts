import { Controller, Get } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  DependencyStatsDto,
  MetricsSnapshotDto,
  RouteStatsDto,
} from './dto/metrics-snapshot.dto';
import { MetricsService, type MetricsSnapshot } from './metrics.service';

@ApiTags('Metrics')
@ApiExtraModels(RouteStatsDto, DependencyStatsDto)
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /** JSON snapshot: latency percentiles, rates, error rate, deps, memory. */
  @Get()
  @ApiOperation({
    summary: 'Live in-process metrics snapshot',
    description:
      'Request rate and error rate, latency percentiles per route and ' +
      'per dependency (p50/p95/p99), plus memory, CPU and event-loop lag.',
  })
  @ApiOkResponse({ type: MetricsSnapshotDto })
  getMetrics(): MetricsSnapshot {
    return this.metrics.snapshot();
  }
}
