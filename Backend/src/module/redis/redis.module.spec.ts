import { Test, type TestingModule } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './constants/redis.constants';
import { RedisModule } from './redis.module';

jest.mock('ioredis', () => {
  return {
    Redis: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      quit: jest.fn().mockResolvedValue('OK'),
    })),
  };
});

describe('RedisModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    jest.clearAllMocks();
    module = await Test.createTestingModule({
      imports: [RedisModule],
    }).compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('provides the REDIS_CLIENT token', () => {
    const client = module.get<Redis>(REDIS_CLIENT);
    expect(client).toBeDefined();
    expect(Redis).toHaveBeenCalledTimes(1);
  });

  it('configures the client from env with safe defaults', () => {
    expect(Redis).toHaveBeenCalledWith(
      expect.objectContaining({
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? '6379'),
        connectTimeout: 2000,
        commandTimeout: 2000,
        maxRetriesPerRequest: 1,
      }),
    );
  });

  it('registers an error listener so a down redis cannot crash the process', () => {
    const instance = (Redis as unknown as jest.Mock).mock.results[0].value;
    expect(instance.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('closes the redis client on shutdown', async () => {
    const client = module.get<Redis>(REDIS_CLIENT);

    await module.close();

    expect(client.quit).toHaveBeenCalledTimes(1);
  });
});
