import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Client } from 'minio';
import type { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/constants/database.contants';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import { MINIO_CLIENT } from '../constants/health.contants';
import type {
  CheckResult,
  DependencyName,
} from '../interfaces/health.interfaces';

// Connection ownership: postgres pool (DatabaseModule), redis client
// (RedisModule) and minio client (HealthModule factory) are each closed by
// their owner — this repository only probes them.
@Injectable()
export class HealthRepository {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(MINIO_CLIENT) private readonly minio: Client,
  ) {}

  async checkAll(): Promise<Record<DependencyName, CheckResult>> {
    const [postgres, redis, minio] = await Promise.all([
      this.timed(() => this.pool.query('SELECT 1')),
      this.timed(() => this.redis.ping()),
      this.timed(() => this.minio.listBuckets()),
    ]);
    return { postgres, redis, minio };
  }

  private async timed(operation: () => Promise<unknown>): Promise<CheckResult> {
    const startedAt = Date.now();
    try {
      await operation();
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        status: 'down',
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
