import { Test, type TestingModule } from '@nestjs/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import { organizationMembers, tasks, users } from '../../../database/schema';
import { MembersRepository } from './members.repository';

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const USER = uuid(1);
const ORG = uuid(2);
const MEMBERSHIP = uuid(4);

/**
 * Focused specs for `removeMember` — covering the §8.3 org-path unassign
 * hook: removing someone from the organization must null their
 * `tasks.assignee_id` across **all** projects inside the same transaction,
 * and must respect the null-user_id guard on email-only invites.
 */
describe('MembersRepository.removeMember', () => {
  let repository: MembersRepository;

  let selectSteps: unknown[];
  const updateCalls: Array<{ table: unknown; set: unknown; where: unknown }> =
    [];

  const tx = {
    execute: jest.fn(),
    select: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };
  const db = { transaction: jest.fn() };

  /** Locked re-read: .from().where().for('update') → awaited. */
  const forChain = (rows: unknown[]) => ({
    from: () => ({ where: () => ({ for: () => Promise.resolve(rows) }) }),
  });
  /** leadProjects probe: .from().where().orderBy() → awaited. */
  const orderByChain = (rows: unknown[]) => ({
    from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }),
  });
  /** countActiveAdmins: .from().innerJoin().where() → awaited. */
  const adminCountChain = (rows: unknown[]) => ({
    from: () => ({
      innerJoin: () => ({ where: () => Promise.resolve(rows) }),
    }),
  });

  const lockedRow = (overrides: Record<string, unknown> = {}) => ({
    id: MEMBERSHIP,
    organizationId: ORG,
    userId: USER,
    status: 'ACTIVE',
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    selectSteps = [];
    updateCalls.length = 0;

    tx.execute.mockResolvedValue(undefined);
    tx.select.mockImplementation(() => {
      const step = selectSteps.shift();
      if (step === undefined) throw new Error('unexpected tx.select');
      return step;
    });
    tx.delete.mockReturnValue({ where: jest.fn().mockResolvedValue(1) });
    tx.update.mockImplementation((table: unknown) => ({
      set: (value: unknown) => ({
        where: (condition: unknown) => {
          updateCalls.push({ table, set: value, where: condition });
          return Promise.resolve(1);
        },
      }),
    }));
    db.transaction.mockImplementation(
      async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembersRepository,
        { provide: DRIZZLE, useValue: db as unknown as Database },
      ],
    }).compile();

    repository = module.get<MembersRepository>(MembersRepository);
  });

  it("unassigns the member's tasks across every project in the org removal tx", async () => {
    selectSteps = [
      forChain([lockedRow()]),
      orderByChain([]), // no lead projects → SoleLead probe skipped
      adminCountChain([{ count: 1 }]),
    ];

    const result = await repository.removeMember(MEMBERSHIP);

    expect(result).toEqual({
      outcome: 'removed',
      wasActive: true,
      userId: USER,
    });
    expect(tx.delete).toHaveBeenCalledWith(organizationMembers);

    // Hook call: UPDATE tasks SET assignee_id = NULL WHERE assignee_id = user
    // — no project scope (singleton org covers all their projects, §8.3.2).
    const hook = updateCalls.find((c) => c.table === tasks);
    expect(hook).toBeDefined();
    expect(hook?.set).toEqual({ assigneeId: null });
    const { params } = new PgDialect().sqlToQuery(hook?.where as SQL);
    expect(params).toEqual([USER]);

    // The role reset still follows the hook in the same transaction.
    expect(updateCalls.map((c) => c.table)).toEqual([tasks, users]);
  });

  it('does not touch tasks when the membership row is gone', async () => {
    selectSteps = [forChain([])];

    const result = await repository.removeMember(MEMBERSHIP);

    expect(result).toEqual({ outcome: 'not_found' });
    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('INVITED row with a known user still unassigns (but skips the role reset)', async () => {
    selectSteps = [forChain([lockedRow({ status: 'INVITED' })])];

    const result = await repository.removeMember(MEMBERSHIP);

    expect(result).toEqual({
      outcome: 'removed',
      wasActive: false,
      userId: USER,
    });
    // Unassign fires; the ACTIVE-only users.role reset does not.
    expect(updateCalls.map((c) => c.table)).toEqual([tasks]);
    expect(updateCalls[0]?.set).toEqual({ assigneeId: null });
  });

  it('email-only invite (null user_id) skips the unassign — nothing to clear', async () => {
    selectSteps = [forChain([lockedRow({ status: 'INVITED', userId: null })])];

    const result = await repository.removeMember(MEMBERSHIP);

    expect(result).toEqual({
      outcome: 'removed',
      wasActive: false,
      userId: null,
    });
    expect(updateCalls).toHaveLength(0);
  });
});
