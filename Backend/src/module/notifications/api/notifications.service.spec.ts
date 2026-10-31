import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '../../auth/api/session/session.types';
import { NotificationsService } from './notifications.service';
import type {
  NotificationsRepository,
  NotificationView,
} from './repositories/notifications.repository';
import type { NotificationEmitterService } from './sse/notification-emitter.service';

type ErrorShape = {
  status: number;
  response: { status: string; message?: string };
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  const actor: SessionUser = {
    userId: 'user-1',
    role: 'Dev',
    name: 'Grace',
    email: 'grace@example.com',
  };

  const T0 = '2026-01-01T00:00:00.000000Z';
  const T1 = '2026-01-01T00:00:00.000123Z';

  const repository = {
    listForUser: jest.fn(),
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    insert: jest.fn(),
    countUnread: jest.fn(),
  };
  const emitter = { publish: jest.fn() };

  const notification = (
    overrides: Partial<NotificationView> = {},
  ): NotificationView => ({
    id: 'notif-1',
    userId: actor.userId,
    type: 'task_assigned',
    taskId: 'task-1',
    title: 'Task assigned to you',
    body: 'WR-4 "Wire up auth" — Website relaunch',
    dedupeKey: null,
    readAt: null,
    createdAt: T0,
    ...overrides,
  });

  const expectStatus = async (
    promise: Promise<unknown>,
    status: string,
    httpStatus?: number,
  ): Promise<void> => {
    try {
      await promise;
      throw new Error(`expected an exception with status ${status}`);
    } catch (error) {
      expect(error).toBeInstanceOf(
        httpStatus === 404 ? NotFoundException : BadRequestException,
      );
      expect((error as ErrorShape).response.status).toBe(status);
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(
      repository as unknown as NotificationsRepository,
      emitter as unknown as NotificationEmitterService,
    );
  });

  describe('list (cursor pagination)', () => {
    it('offers nextCursor only when another page exists', async () => {
      repository.listForUser.mockResolvedValue({
        notifications: [
          notification({ id: 'a', createdAt: T1 }),
          notification({ id: 'b', createdAt: T0 }),
        ],
        hasMore: true,
        unreadCount: 2,
      });

      const result = await service.list({}, actor);

      // The cursor is the **last** (oldest) row of the page — the next
      // page's row-value comparison starts strictly below it.
      expect(result.nextCursor).toEqual({ createdAt: T0, id: 'b' });
      expect(result.unreadCount).toBe(2);
      expect(repository.listForUser).toHaveBeenCalledWith(
        actor.userId,
        30,
        null,
      );
    });

    it('returns nextCursor null on the last page', async () => {
      repository.listForUser.mockResolvedValue({
        notifications: [notification()],
        hasMore: false,
        unreadCount: 1,
      });

      const result = await service.list({}, actor);

      expect(result.nextCursor).toBeNull();
      expect(result.notifications).toHaveLength(1);
      // createdAt stays the fixed-width string the repository produced —
      // never a lossy Date round-trip.
      expect(result.notifications[0]?.createdAt).toBe(T0);
    });

    it('forwards the cursor pair to the repository unchanged', async () => {
      repository.listForUser.mockResolvedValue({
        notifications: [],
        hasMore: false,
        unreadCount: 0,
      });

      await service.list({ cursorCreatedAt: T1, cursorId: 'notif-9' }, actor);

      expect(repository.listForUser).toHaveBeenCalledWith(actor.userId, 30, {
        createdAt: T1,
        id: 'notif-9',
      });
    });

    it('rejects a half cursor with 400 invalid_cursor', async () => {
      await expectStatus(
        service.list({ cursorCreatedAt: T1 }, actor),
        'invalid_cursor',
        400,
      );
      await expectStatus(
        service.list({ cursorId: 'notif-9' }, actor),
        'invalid_cursor',
        400,
      );
      expect(repository.listForUser).not.toHaveBeenCalled();
    });

    it('clamps the limit to the default page size', async () => {
      repository.listForUser.mockResolvedValue({
        notifications: [],
        hasMore: false,
        unreadCount: 0,
      });

      await service.list({ limit: 50 }, actor);
      expect(repository.listForUser).toHaveBeenCalledWith(
        actor.userId,
        50,
        null,
      );
    });
  });

  describe('markRead', () => {
    it('resolves when the row was unread', async () => {
      repository.markRead.mockResolvedValue('updated');
      await expect(service.markRead('notif-1', actor)).resolves.toBeUndefined();
      expect(repository.markRead).toHaveBeenCalledWith('notif-1', actor.userId);
    });

    it('is a no-op when already read', async () => {
      repository.markRead.mockResolvedValue('updated');
      await expect(service.markRead('notif-1', actor)).resolves.toBeUndefined();
    });

    it("404s on someone else's row (same as unknown id)", async () => {
      repository.markRead.mockResolvedValue('not_found');
      await expectStatus(
        service.markRead('notif-foreign', actor),
        'notification_not_found',
        404,
      );
    });
  });

  describe('markAllRead', () => {
    it('scopes the update to the caller and resolves', async () => {
      repository.markAllRead.mockResolvedValue(4);
      await expect(service.markAllRead(actor)).resolves.toBeUndefined();
      expect(repository.markAllRead).toHaveBeenCalledWith(actor.userId);
    });
  });

  describe('createForUser (assignment + reminder write path)', () => {
    const insert = {
      userId: actor.userId,
      type: 'task_assigned' as const,
      taskId: 'task-1',
      title: 'Task assigned to you',
      body: 'WR-4 — Website relaunch',
      dedupeKey: null,
    };

    it('publishes only when a row actually landed', async () => {
      repository.insert.mockResolvedValue(notification());
      emitter.publish.mockResolvedValue(undefined);

      const row = await service.createForUser(insert);

      expect(row).not.toBeNull();
      expect(emitter.publish).toHaveBeenCalledWith(
        actor.userId,
        expect.objectContaining({ id: 'notif-1', type: 'task_assigned' }),
      );
    });

    it('skips the publish on an ON CONFLICT miss (swept twice)', async () => {
      repository.insert.mockResolvedValue(null);

      const row = await service.createForUser({
        ...insert,
        type: 'due_reminder',
        dedupeKey: 'due_soon:2026-11-05',
      });

      expect(row).toBeNull();
      expect(emitter.publish).not.toHaveBeenCalled();
    });
  });
});
