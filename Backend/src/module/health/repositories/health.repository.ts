import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/constants/database.contants';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import { StorageService } from '../../storage/storage.service';
import type {
  CheckResult,
  DependencyName,
} from '../interfaces/health.interfaces';

// Connection ownership: postgres pool (DatabaseModule) and redis client
// (RedisModule) are each closed by their owner — this repository only
// probes them, plus object storage via StorageService.probe().
@Injectable()
export class HealthRepository {
  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly storage: StorageService,
  ) {}

  async checkAll(): Promise<Record<DependencyName, CheckResult>> {
    const [postgres, redis, minio] = await Promise.all([
      this.timed(() => this.pool.query('SELECT 1')),
      this.timed(() => this.redis.ping()),
      // Report key stays `minio` (API shape unchanged) — probe() covers all
      // three storage drivers (remote → ListBuckets, local → dir writable).
      this.timed(() => this.storage.probe()),
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
