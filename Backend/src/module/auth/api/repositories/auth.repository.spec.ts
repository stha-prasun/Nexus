import { Test, type TestingModule } from '@nestjs/testing';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import type { Role } from '../constants/auth.constants';
import { User } from '../entities/user.entity';
import { AuthRepository } from './auth.repository';

type Chain = {
  from: jest.Mock;
  where: jest.Mock;
  limit: jest.Mock;
  values: jest.Mock;
  set: jest.Mock;
  returning: jest.Mock;
};

const uuid1 = '00000000-0000-4000-8000-000000000001';
const uuid42 = '00000000-0000-4000-8000-000000000042';

const row = {
  id: uuid1,
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  role: 'Dev' as Role,
  passwordHash: 'hashed',
  emailVerifiedAt: null as Date | null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('AuthRepository', () => {
  let repository: AuthRepository;
  let chain: Chain;

  const selectResult = jest.fn();
  const insertResult = jest.fn();
  const updateResult = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();

    chain = {
      from: jest.fn(),
      where: jest.fn(),
      limit: jest.fn(),
      values: jest.fn(),
      set: jest.fn(),
      returning: jest.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.limit.mockReturnValue(chain);
    chain.values.mockReturnValue(chain);
    chain.set.mockReturnValue(chain);
    chain.limit.mockImplementation(() => selectResult());
    chain.values.mockImplementation(() => insertResult());
    chain.returning.mockImplementation(() => {
      // update() calls .set().where().returning(); select path uses limit()
      return updateResult();
    });
    // Distinguish select (uses limit) from update (uses returning after set).
    chain.where.mockReturnValue(chain);

    const db = {
      select: jest.fn(() => ({ from: () => chain })),
      insert: jest.fn(() => ({
        values: () => ({ returning: () => insertResult() }),
      })),
      update: jest.fn(() => ({
        set: () => ({ where: () => ({ returning: () => updateResult() }) }),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthRepository,
        { provide: DRIZZLE, useValue: db as unknown as Database },
      ],
    }).compile();

    repository = module.get<AuthRepository>(AuthRepository);
  });

  it('findByEmail constructs a User entity from the row', async () => {
    selectResult.mockResolvedValue([row]);

    const user = await repository.findByEmail('ada@example.com');

    expect(user).toBeInstanceOf(User);
    expect(user?.id).toBe(1);
    expect(user?.name).toBe('Ada Lovelace');
    expect(user?.email).toBe('ada@example.com');
    expect(user?.role).toBe('Dev');
    expect(user?.passwordHash).toBe('hashed');
    expect(user?.isVerified).toBe(false);
  });

  it('findByEmail returns null when no row matches', async () => {
    selectResult.mockResolvedValue([]);

    expect(await repository.findByEmail('missing@example.com')).toBeNull();
  });

  it('findById constructs a User entity from the row', async () => {
    selectResult.mockResolvedValue([row]);

    const user = await repository.findById(uuid1);

    expect(user?.id).toBe(uuid1);
  });

  it('insert maps entity fields to columns and returns a new entity with id', async () => {
    insertResult.mockResolvedValue([{ ...row, id: uuid42 }]);

    const created = await repository.insert(
      new User({
        name: row.name,
        email: row.email,
        role: row.role,
        passwordHash: row.passwordHash,
        emailVerifiedAt: null,
        createdAt: row.createdAt,
      }),
    );

    expect(created).toBeInstanceOf(User);
    expect(created.id).toBe(uuid42);
  });

  it('save updates derived fields (emailVerifiedAt) from the entity', async () => {
    updateResult.mockResolvedValue([
      { ...row, emailVerifiedAt: new Date('2026-02-01T00:00:00Z') },
    ]);
    const user = new User({ ...row });
    user.markEmailVerified(new Date('2026-02-01T00:00:00Z'));

    const saved = await repository.save(user);

    expect(saved.emailVerifiedAt).toEqual(new Date('2026-02-01T00:00:00Z'));
  });

  it('save rejects a user without an id', async () => {
    const user = new User({
      name: row.name,
      email: row.email,
      role: row.role,
      passwordHash: row.passwordHash,
      emailVerifiedAt: null,
      createdAt: row.createdAt,
    });

    await expect(repository.save(user)).rejects.toThrow(
      'Cannot save a user without an id',
    );
  });

  it('save rejects when the update matched no rows', async () => {
    updateResult.mockResolvedValue([]);
    const user = new User({ ...row });

    await expect(repository.save(user)).rejects.toThrow(
      `User ${uuid1} not found`,
    );
  });
});
