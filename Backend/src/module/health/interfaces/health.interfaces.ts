export type CheckStatus = 'up' | 'down';

export type DependencyName = 'postgres' | 'redis' | 'minio';

export interface CheckResult {
  status: CheckStatus;
  latencyMs: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  checks: Record<DependencyName, CheckResult>;
}
