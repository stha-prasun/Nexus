import { Test, type TestingModule } from '@nestjs/testing';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import type { NotificationView } from './notifications.repository';
import { NotificationsRepository } from './notifications.repository';

/**
 * Chain mock covering the repository's two shapes: select → from → where →
 * orderBy → limit (list), and update → set → where → returning (markRead).
 */
type Chain = {
  from: jest.Mock;
  where: jest.Mock;
  orderBy: jest.Mock;
  limit: jest.Mock;
  set: jest.Mock;
  returning: jest.Mock;
  then?: (resolve: (value: unknown) => void) => void;
};

const T0 = '2026-01-01T00:00:00.000000Z';
const T1 = '2026-01-01T00:00:00.000123Z';
const uuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const row = (id: string, createdAt: string): NotificationView => ({
  id,
  userId: uuid(1),
  type: 'task_assigned',
  taskId: uuid(9),
  title: 'Task assigned to you',
  body: 'WR-4 — Website relaunch',
  dedupeKey: null,
  readAt: null,
  createdAt,
});

describe('NotificationsRepository', () => {
  let repository: NotificationsRepository;
  let chain: Chain;

  const selectResult = jest.fn();
  const updateResult = jest.fn();

  /** Chain used by listForUser / countUnread / markRead's exists probe. */
  const selectChain = (): unknown => ({
    from: () => chain,
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    chain = {
      from: jest.fn(),
      where: jest.fn(),
      orderBy: jest.fn(),
      limit: jest.fn(),
      set: jest.fn(),
      returning: jest.fn(),
    };
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    chain.orderBy.mockReturnValue(chain);
    chain.set.mockReturnValue(chain);
    chain.limit.mockImplementation(() => selectResult());
    chain.returning.mockImplementation(() => updateResult());
    // countUnread awaits the chain itself (no orderBy/limit in that path),
    // so the mock is an intentional thenable — the only escape hatch for
    // this Biome rule is the documented ignore.
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock
    chain.then = (resolve) => {
      void selectResult().then(resolve);
    };

    const db = {
      select: jest.fn(() => selectChain()),
      update: jest.fn(() => ({
        set: () => ({
          where: () => ({
            returning: () => updateResult(),
          }),
        }),
      })),
      insert: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsRepository,
        { provide: DRIZZLE, useValue: db as unknown as Database },
      ],
    }).compile();

    repository = module.get<NotificationsRepository>(NotificationsRepository);
  });

  describe('listForUser (cursor pagination boundary)', () => {
    it('serves nextCursor only when the limit+1 probe found another row', async () => {
      // limit 2 requested → 3 rows fetched: page = first 2, hasMore = true.
      selectResult.mockResolvedValueOnce([
        row(uuid(10), T1),
        row(uuid(11), T0),
        row(uuid(12), T0),
      ]);
      // Second statement in the call is countUnread.
      selectResult.mockResolvedValueOnce([{ count: 1 }]);

      const page = await repository.listForUser(uuid(1), 2, null);

      expect(page.hasMore).toBe(true);
      expect(page.notifications.map((item) => item.id)).toEqual([
        uuid(10),
        uuid(11),
      ]);
      expect(page.unreadCount).toBe(1);
      // createdAt stays the fixed-width string Postgres produced.
      expect(page.notifications[0]?.createdAt).toBe(T1);
    });

    it('reports hasMore false when the extra probe row is absent', async () => {
      selectResult.mockResolvedValueOnce([
        row(uuid(10), T1),
        row(uuid(11), T0),
      ]);
      selectResult.mockResolvedValueOnce([{ count: 0 }]);

      const page = await repository.listForUser(uuid(1), 2, null);

      expect(page.hasMore).toBe(false);
      expect(page.notifications).toHaveLength(2);
      expect(page.unreadCount).toBe(0);
    });

    it('keeps a full-pair cursor intact for the SQL comparison', async () => {
      selectResult.mockResolvedValueOnce([]);
      selectResult.mockResolvedValueOnce([{ count: 0 }]);

      const cursor = { createdAt: T1, id: uuid(11) };
      const page = await repository.listForUser(uuid(1), 30, cursor);

      // The where chain received both the owner condition and the
      // row-value comparison (drizzle sql fragment), never a re-serialized
      // Date. (Two `where` calls total: the page query + the unread count.)
      expect(chain.where).toHaveBeenCalledTimes(2);
      expect(page.notifications).toEqual([]);
      expect(page.hasMore).toBe(false);
    });
  });

  describe('markRead', () => {
    it('is a no-op success when the row is already read (update misses, probe hits)', async () => {
      updateResult.mockResolvedValueOnce([]);
      selectResult.mockResolvedValueOnce([{ id: uuid(10) }]);

      await expect(repository.markRead(uuid(10), uuid(1))).resolves.toBe(
        'updated',
      );
    });

    it('404s when the row belongs to someone else', async () => {
      updateResult.mockResolvedValueOnce([]);
      selectResult.mockResolvedValueOnce([]);

      await expect(repository.markRead(uuid(99), uuid(1))).resolves.toBe(
        'not_found',
      );
    });

    it('reports updated when the unread row flipped', async () => {
      updateResult.mockResolvedValueOnce([{ id: uuid(10) }]);

      await expect(repository.markRead(uuid(10), uuid(1))).resolves.toBe(
        'updated',
      );
      // The probe query must not run once the update landed.
      expect(selectResult).not.toHaveBeenCalled();
    });
  });

  describe('markAllRead', () => {
    it('returns how many unread rows flipped', async () => {
      updateResult.mockResolvedValueOnce([{ id: uuid(10) }, { id: uuid(11) }]);

      await expect(repository.markAllRead(uuid(1))).resolves.toBe(2);
    });
  });

  describe('insert (ON CONFLICT idempotency)', () => {
    it('returns null when the unique (taskId, userId, dedupeKey) already exists', async () => {
      const insertChain = {
        values: jest.fn(() => insertChain),
        onConflictDoNothing: jest.fn(() => insertChain),
        returning: jest.fn(() => Promise.resolve([])),
      };
      const db = {
        insert: jest.fn(() => insertChain),
        select: jest.fn(),
        update: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotificationsRepository,
          { provide: DRIZZLE, useValue: db as unknown as Database },
        ],
      }).compile();
      const repo = module.get<NotificationsRepository>(NotificationsRepository);

      const result = await repo.insert({
        userId: uuid(1),
        type: 'due_reminder',
        taskId: uuid(9),
        title: 'Task due today',
        body: 'WR-4 due today',
        dedupeKey: 'due_today:2026-11-05',
      });

      expect(result).toBeNull();
      expect(insertChain.onConflictDoNothing).toHaveBeenCalledWith({
        target: expect.any(Array),
      });
    });

    it('returns the row when it actually landed', async () => {
      const insertChain = {
        values: jest.fn(() => insertChain),
        onConflictDoNothing: jest.fn(() => insertChain),
        returning: jest.fn(() =>
          Promise.resolve([
            {
              id: uuid(10),
              userId: uuid(1),
              type: 'task_assigned',
              taskId: uuid(9),
              title: 'Task assigned to you',
              body: 'WR-4 — Website relaunch',
              dedupeKey: null,
              readAt: null,
              createdAt: T0,
            },
          ]),
        ),
      };
      const db = {
        insert: jest.fn(() => insertChain),
        select: jest.fn(),
        update: jest.fn(),
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          NotificationsRepository,
          { provide: DRIZZLE, useValue: db as unknown as Database },
        ],
      }).compile();
      const repo = module.get<NotificationsRepository>(NotificationsRepository);

      const result = await repo.insert({
        userId: uuid(1),
        type: 'task_assigned',
        taskId: uuid(9),
        title: 'Task assigned to you',
        body: 'WR-4 — Website relaunch',
        dedupeKey: null,
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(uuid(10));
      expect(result?.createdAt).toBe(T0);
    });
  });
});
