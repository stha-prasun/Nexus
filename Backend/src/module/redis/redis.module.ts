import {
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './constants/redis.constants';

// Defaults mirror Backend/.env (and docker-compose.yml), so `docker compose
// up -d` + `npm start` works even without a .env file present.
const env = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

const redisProvider = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis => {
    const client = new Redis({
      host: env('REDIS_HOST', 'localhost'),
      port: Number(env('REDIS_PORT', '6379')),
      connectTimeout: 2000,
      commandTimeout: 2000,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    // Without a listener, a down redis would crash the process on 'error'.
    client.on('error', () => undefined);
    return client;
  },
};

// The client comes from a factory, so Nest never calls lifecycle hooks on it;
// this provider closes it when the application shuts down.
@Injectable()
class RedisShutdown implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onModuleDestroy(): Promise<unknown> {
    return this.redis.quit();
  }
}

@Module({
  providers: [redisProvider, RedisShutdown],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
