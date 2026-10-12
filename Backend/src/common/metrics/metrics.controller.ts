import { Controller, Get } from '@nestjs/common';
import { MetricsService, type MetricsSnapshot } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /** JSON snapshot: latency percentiles, rates, error rate, deps, memory. */
  @Get()
  getMetrics(): MetricsSnapshot {
    return this.metrics.snapshot();
  }
}
