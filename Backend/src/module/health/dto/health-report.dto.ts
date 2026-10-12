import { ApiProperty } from '@nestjs/swagger';

/** One dependency probe result (`GET /health`). */
export class CheckResultDto {
  @ApiProperty({ enum: ['up', 'down'], description: 'Availability' })
  status!: 'up' | 'down';

  @ApiProperty({ example: 4.2, description: 'Probe latency in milliseconds' })
  latencyMs!: number;

  @ApiProperty({
    required: false,
    description: 'Failure reason when the dependency is down',
  })
  error?: string;
}

/** All dependency probes, keyed by service name. */
export class HealthChecksDto {
  @ApiProperty({ type: CheckResultDto })
  postgres!: CheckResultDto;

  @ApiProperty({ type: CheckResultDto })
  redis!: CheckResultDto;

  @ApiProperty({ type: CheckResultDto })
  minio!: CheckResultDto;
}

/** `GET /health` response — 200 when everything is up, 503 otherwise. */
export class HealthReportDto {
  @ApiProperty({ enum: ['ok', 'error'] })
  status!: 'ok' | 'error';

  @ApiProperty({ example: '2026-10-12T08:20:51.920Z' })
  timestamp!: string;

  @ApiProperty({ example: 123.45, description: 'Process uptime in seconds' })
  uptime!: number;

  @ApiProperty({ type: HealthChecksDto })
  checks!: HealthChecksDto;
}
