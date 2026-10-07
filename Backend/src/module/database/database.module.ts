import {
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DRIZZLE, POSTGRES_POOL } from './constants/database.contants';
import type { Database } from './interfaces/database.interfaces';
import * as schema from './schema';

// Defaults mirror Backend/.env (and docker-compose.yml), so `docker compose
// up -d` + `npm start` works even without a .env file present.
const env = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

const postgresPoolProvider = {
  provide: POSTGRES_POOL,
  useFactory: (): Pool =>
    new Pool({
      host: env('POSTGRES_HOST', 'localhost'),
      port: Number(env('POSTGRES_PORT', '6432')),
      user: env('POSTGRES_USER', 'nexus'),
      password: env('POSTGRES_PASSWORD', 'nexus_dev_password'),
      database: env('POSTGRES_DB', 'nexus'),
      max: Number(env('POSTGRES_POOL_MAX', '10')),
      connectionTimeoutMillis: 2000,
    }),
};

const drizzleProvider = {
  provide: DRIZZLE,
  inject: [POSTGRES_POOL],
  useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
};

// The pool comes from a factory, so Nest never calls lifecycle hooks on it;
// this provider closes it when the application shuts down.
@Injectable()
class PostgresPoolShutdown implements OnModuleDestroy {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  onModuleDestroy(): Promise<void> {
    return this.pool.end();
  }
}

@Module({
  providers: [postgresPoolProvider, drizzleProvider, PostgresPoolShutdown],
  exports: [POSTGRES_POOL, DRIZZLE],
})
export class DatabaseModule {}
