import { Test, type TestingModule } from '@nestjs/testing';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import type { ReminderCandidate } from './reminder.repository';
import { ReminderRepository } from './reminder.repository';

const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const row = (
  overrides: Partial<ReminderCandidate> = {},
): ReminderCandidate => ({
  taskId: uuid(9),
  assigneeId: uuid(1),
  key: 'WR-4',
  title: 'Wire up auth flow',
  dueDate: '2026-06-15',
  ...overrides,
});

describe('ReminderRepository', () => {
  let repository: ReminderRepository;

  let rows: ReminderCandidate[];
  let capturedCondition: unknown;

  const db = {
    select: jest.fn(() => ({
      from: () => ({
        where: (condition: unknown) => {
          capturedCondition = condition;
          return Promise.resolve(rows);
        },
      }),
    })),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    rows = [];
    capturedCondition = undefined;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReminderRepository,
        { provide: DRIZZLE, useValue: db as unknown as Database },
      ],
    }).compile();

    repository = module.get<ReminderRepository>(ReminderRepository);
  });

  it('maps rows to candidates (drizzle column keys → API shape)', async () => {
    rows = [row(), row({ taskId: uuid(10), dueDate: '2026-06-16' })];

    const candidates = await repository.findDueCandidates(
      '2026-06-15',
      '2026-06-16',
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      taskId: uuid(9),
      assigneeId: uuid(1),
      key: 'WR-4',
      title: 'Wire up auth flow',
      dueDate: '2026-06-15',
    });
  });

  it('bounds the sweep by the two windowable dates only', async () => {
    await repository.findDueCandidates('2026-06-15', '2026-06-16');

    const { sql, params } = new PgDialect().sqlToQuery(
      capturedCondition as SQL,
    );
    expect(sql).toMatch(/"due_date" in \(/);
    expect(params).toEqual(
      expect.arrayContaining(['2026-06-15', '2026-06-16']),
    );
    // Exactly two date params — the scan never widens to older due dates.
    expect(
      params.filter((p) => typeof p === 'string' && /^\d{4}-/.test(p)),
    ).toHaveLength(2);
  });

  it('excludes finished statuses and requires an assigned, dated task', async () => {
    await repository.findDueCandidates('2026-06-15', '2026-06-16');

    const { sql, params } = new PgDialect().sqlToQuery(
      capturedCondition as SQL,
    );
    // done/resolved skip — plan §7 (the partial (status, dueDate) index path).
    expect(sql).toMatch(/"status" not in \(/);
    expect(params).toEqual(expect.arrayContaining(['done', 'resolved']));
    expect(sql).toMatch(/"assignee_id" is not null/);
    expect(sql).toMatch(/"due_date" is not null/);
  });

  it('requires the assignee to still be an ACTIVE project member (backstop)', async () => {
    await repository.findDueCandidates('2026-06-15', '2026-06-16');

    const { sql } = new PgDialect().sqlToQuery(capturedCondition as SQL);
    expect(sql).toContain('EXISTS (SELECT 1 FROM project_members');
    expect(sql).toContain('organization_members');
    expect(sql).toContain("om.status = 'ACTIVE'");
    // Correlated to the outer tasks row.
    expect(sql).toContain('"tasks"."project_id"');
    expect(sql).toContain('"tasks"."assignee_id"');
  });
});
