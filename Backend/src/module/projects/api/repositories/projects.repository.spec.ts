import { Test, type TestingModule } from '@nestjs/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import { projectMembers, tasks } from '../../../database/schema';
import { ProjectsRepository } from './projects.repository';

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PROJECT = uuid(3);
const USER = uuid(1);

/**
 * Focused specs for `removeMember` — covering the §8.3 unassign hook: the
 * project path must null `tasks.assignee_id` for this project+user inside
 * the same transaction as the membership delete, and must not fire on the
 * early-out paths.
 */
describe('ProjectsRepository.removeMember', () => {
  let repository: ProjectsRepository;

  let selectSteps: unknown[];
  let capturedSet: unknown;
  let capturedWhere: unknown;

  const tx = {
    execute: jest.fn(),
    select: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
  };
  const db = { transaction: jest.fn() };

  /** Locked re-read chain: .from().where().for('update') → awaited. */
  const forChain = (rows: unknown[]) => ({
    from: () => ({ where: () => ({ for: () => Promise.resolve(rows) }) }),
  });
  /** countOtherLeads chain: .from().where() → awaited. */
  const countChain = (rows: unknown[]) => ({
    from: () => ({ where: () => Promise.resolve(rows) }) as never,
  });

  const membershipRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'pm-row-1',
    isLead: false,
    ...overrides,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    selectSteps = [];
    capturedSet = undefined;
    capturedWhere = undefined;

    tx.execute.mockResolvedValue(undefined);
    tx.select.mockImplementation(() => {
      const step = selectSteps.shift();
      if (step === undefined) throw new Error('unexpected tx.select');
      return step;
    });
    tx.delete.mockReturnValue({ where: jest.fn().mockResolvedValue(1) });
    tx.update.mockImplementation((table: unknown) => ({
      set: (value: unknown) => {
        capturedSet = value;
        void table;
        return {
          where: (condition: unknown) => {
            capturedWhere = condition;
            return Promise.resolve(1);
          },
        };
      },
    }));
    db.transaction.mockImplementation(
      async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsRepository,
        { provide: DRIZZLE, useValue: db as unknown as Database },
      ],
    }).compile();

    repository = module.get<ProjectsRepository>(ProjectsRepository);
  });

  it("unassigns the removed member's tasks in the same transaction (project scope)", async () => {
    selectSteps = [forChain([membershipRow()])];

    const result = await repository.removeMember(PROJECT, USER);

    expect(result).toEqual({ outcome: 'removed' });
    expect(tx.delete).toHaveBeenCalledWith(projectMembers);
    // The hook: UPDATE tasks SET assignee_id = NULL, scoped project+user.
    expect(tx.update).toHaveBeenCalledWith(tasks);
    expect(capturedSet).toEqual({ assigneeId: null });
    const { params } = new PgDialect().sqlToQuery(capturedWhere as SQL);
    expect(params).toEqual(expect.arrayContaining([PROJECT, USER]));
  });

  it('does not touch tasks when the membership does not exist', async () => {
    selectSteps = [forChain([])];

    const result = await repository.removeMember(PROJECT, USER);

    expect(result).toEqual({ outcome: 'not_found' });
    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('rolls back (last_lead) before ever reaching the unassign update', async () => {
    // isLead row, and zero *other* leads remain → LastLeadError.
    selectSteps = [
      forChain([membershipRow({ isLead: true })]),
      countChain([{ count: 0 }]),
    ];

    const result = await repository.removeMember(PROJECT, USER);

    expect(result).toEqual({ outcome: 'last_lead' });
    expect(tx.delete).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('a lead with another lead remaining still unassigns', async () => {
    selectSteps = [
      forChain([membershipRow({ isLead: true })]),
      countChain([{ count: 1 }]),
    ];

    const result = await repository.removeMember(PROJECT, USER);

    expect(result).toEqual({ outcome: 'removed' });
    expect(capturedSet).toEqual({ assigneeId: null });
  });
});
