import { ApiProperty, getSchemaPath } from '@nestjs/swagger';

/** Count/min/max/avg plus nearest-rank percentiles over a latency reservoir. */
export class LatencySummaryDto {
  @ApiProperty({ example: 42 })
  count!: number;

  @ApiProperty({ example: 1 })
  min!: number;

  @ApiProperty({ example: 120 })
  max!: number;

  @ApiProperty({ example: 12.4 })
  avg!: number;

  @ApiProperty({ description: '50th percentile', example: 9 })
  p50!: number;

  @ApiProperty({ description: '95th percentile', example: 42 })
  p95!: number;

  @ApiProperty({ description: '99th percentile', example: 82 })
  p99!: number;
}

/** Request counters and sliding-window rate for the metrics window. */
export class RequestsDto {
  @ApiProperty()
  total!: number;

  @ApiProperty({ description: 'Responses with status >= 500' })
  errors!: number;

  @ApiProperty({ description: 'Responses with status 400-499' })
  clientErrors!: number;

  @ApiProperty({ description: 'errors / total, in percent' })
  errorRatePct!: number;

  @ApiProperty({ description: 'Requests per second inside the rate window' })
  ratePerSec!: number;

  @ApiProperty({ description: 'Rate window size in seconds' })
  rateWindowSec!: number;
}

/** Latency and outcome counters for a single route. */
export class RouteStatsDto {
  @ApiProperty()
  count!: number;

  @ApiProperty()
  errors!: number;

  @ApiProperty()
  clientErrors!: number;

  @ApiProperty({ type: LatencySummaryDto })
  latencyMs!: LatencySummaryDto;
}

/** Latency and outcome counters for one dependency system. */
export class DependencyStatsDto {
  @ApiProperty()
  count!: number;

  @ApiProperty()
  errors!: number;

  @ApiProperty({ type: LatencySummaryDto })
  latencyMs!: LatencySummaryDto;
}

/** HTTP section: totals, overall latency and per-route breakdown. */
export class HttpSectionDto {
  @ApiProperty({ type: RequestsDto })
  requests!: RequestsDto;

  @ApiProperty({ type: LatencySummaryDto })
  latencyMs!: LatencySummaryDto;

  @ApiProperty({
    description: 'Per-route stats keyed by "METHOD /route"',
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(RouteStatsDto) },
  })
  routes!: Record<string, RouteStatsDto>;
}

/** Process memory gauges in bytes (heapUsagePct in percent). */
export class MemoryDto {
  @ApiProperty()
  rssBytes!: number;

  @ApiProperty()
  heapUsedBytes!: number;

  @ApiProperty()
  heapTotalBytes!: number;

  @ApiProperty()
  externalBytes!: number;

  @ApiProperty({ description: 'heapUsed / heapTotal, in percent' })
  heapUsagePct!: number;
}

/** Event-loop delay percentiles, in milliseconds. */
export class EventLoopLagDto {
  @ApiProperty()
  p50!: number;

  @ApiProperty()
  p95!: number;

  @ApiProperty()
  p99!: number;

  @ApiProperty()
  max!: number;
}

/** Process section: memory, CPU and event-loop lag. */
export class ProcessMetricsDto {
  @ApiProperty({ type: MemoryDto })
  memory!: MemoryDto;

  @ApiProperty({ description: 'CPU used since the previous snapshot, %' })
  cpuPercent!: number;

  @ApiProperty({ type: EventLoopLagDto })
  eventLoopLagMs!: EventLoopLagDto;
}

/** `GET /metrics` response — a live in-process snapshot. */
export class MetricsSnapshotDto {
  @ApiProperty({ description: 'Snapshot time (ISO 8601)' })
  timestamp!: string;

  @ApiProperty({ description: 'Process uptime in seconds' })
  uptimeSec!: number;

  @ApiProperty({ type: HttpSectionDto })
  http!: HttpSectionDto;

  @ApiProperty({
    description: 'Dependency stats keyed by system (postgres, redis, minio)',
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(DependencyStatsDto) },
  })
  dependencies!: Record<string, DependencyStatsDto>;

  @ApiProperty({ type: ProcessMetricsDto })
  process!: ProcessMetricsDto;
}
