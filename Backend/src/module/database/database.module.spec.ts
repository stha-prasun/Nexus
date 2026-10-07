import { Test, type TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { DRIZZLE, POSTGRES_POOL } from './constants/database.contants';
import { DatabaseModule } from './database.module';
import type { Database } from './interfaces/database.interfaces';

describe('DatabaseModule', () => {
  let module: TestingModule;

  const pool = {
    query: jest.fn(),
    end: jest.fn(),
  };

  const compile = async (): Promise<TestingModule> =>
    Test.createTestingModule({
      imports: [DatabaseModule],
    })
      .overrideProvider(POSTGRES_POOL)
      .useValue(pool)
      .compile();

  beforeEach(async () => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue(undefined);
    pool.end.mockResolvedValue(undefined);
    module = await compile();
  });

  afterEach(async () => {
    await module.close();
  });

  it('exposes the postgres pool token', () => {
    expect(module.get(POSTGRES_POOL)).toBe(pool);
  });

  it('exposes a drizzle instance bound to the injected pool', () => {
    const db = module.get<Database & { $client: Pool }>(DRIZZLE);

    expect(db).toBeDefined();
    expect(db.$client).toBe(pool);
  });

  it('closes the pool on shutdown', async () => {
    const closing = await compile();
    await closing.close();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
