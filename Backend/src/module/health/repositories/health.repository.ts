import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Client } from 'minio';
import type { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/constants/database.contants';
import { MINIO_CLIENT, REDIS_CLIENT } from '../constants/health.contants';
import type {
  CheckResult,
  DependencyName,
} from '../interfaces/health.interfaces';

@Injectable()
export class HealthRepository implements OnModuleDestroy {
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

  async onModuleDestroy(): Promise<void> {
    // The postgres pool is owned by DatabaseModule, which closes it.
    await this.redis.quit();
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
