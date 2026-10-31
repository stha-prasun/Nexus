import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SessionUser } from '../../auth/api/session/session.types';
import {
  INVALID_CURSOR_MESSAGE,
  INVALID_CURSOR_STATUS,
  NOTIFICATION_DEFAULT_LIMIT,
  NOTIFICATION_MAX_LIMIT,
  NOTIFICATION_NOT_FOUND_MESSAGE,
  NOTIFICATION_NOT_FOUND_STATUS,
} from './constants/notifications.constants';
import type {
  ListNotificationsQueryDto,
  NotificationResponseDto,
} from './dto/notifications-responses.dto';
import {
  type NotificationInsert,
  NotificationsRepository,
  type NotificationView,
} from './repositories/notifications.repository';
import { NotificationEmitterService } from './sse/notification-emitter.service';

/** Wire DTO handed to the emitter (no userId — the stream is per-user). */
export type PublishedNotification = NotificationResponseDto;

export interface NotificationListResult {
  notifications: PublishedNotification[];
  unreadCount: number;
  nextCursor: { createdAt: string; id: string } | null;
}

/**
 * Read paths for the notification center plus the single write path other
 * modules use (`createForUser`). Every read is scoped to the caller — the
 * recipient's own rows, always. Writes are insert-then-publish: the row
 * lands first (transaction on the caller's side), the SSE publish happens
 * only after a row actually inserted (plan §5).
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly emitter: NotificationEmitterService,
  ) {}

  /** One cursor page, newest first, with the derived unread count. */
  async list(
    query: ListNotificationsQueryDto,
    actor: SessionUser,
  ): Promise<NotificationListResult> {
    const cursor = this.parseCursor(query);
    // The DTO already bounds limit at NOTIFICATION_MAX_LIMIT; this applies
    // the default when absent (clamp against the max, not the default).
    const limit = Math.min(
      query.limit ?? NOTIFICATION_DEFAULT_LIMIT,
      NOTIFICATION_MAX_LIMIT,
    );
    const page = await this.repository.listForUser(actor.userId, limit, cursor);
    const last = page.notifications[page.notifications.length - 1] ?? undefined;
    return {
      notifications: page.notifications.map(toWire),
      unreadCount: page.unreadCount,
      nextCursor:
        page.hasMore && last !== undefined
          ? { createdAt: last.createdAt, id: last.id }
          : null,
    };
  }

  /**
   * Mark one notification read. Not-yours and unknown ids are the same 404
   * (no ownership leak); an already-read row is a 204 no-op.
   */
  async markRead(id: string, actor: SessionUser): Promise<void> {
    const result = await this.repository.markRead(id, actor.userId);
    if (result === 'not_found') {
      throw new NotFoundException({
        status: NOTIFICATION_NOT_FOUND_STATUS,
        message: NOTIFICATION_NOT_FOUND_MESSAGE,
      });
    }
  }

  /** Mark every unread row of the caller read — always 204. */
  async markAllRead(actor: SessionUser): Promise<void> {
    await this.repository.markAllRead(actor.userId);
  }

  /**
   * Create one notification and push it live. Returns null when the row
   * already existed (`ON CONFLICT DO NOTHING` — e.g. a reminder swept twice),
   * so the scheduler can skip the publish for pure duplicates. Assignment
   * callers are unaffected: their `dedupeKey` is NULL and never conflicts.
   *
   * Callers with assign rights invoke this only when `assignee ≠ actor` —
   * self-assignment is silent for every role (plan §5).
   */
  async createForUser(
    input: NotificationInsert,
  ): Promise<NotificationView | null> {
    const row = await this.repository.insert(input);
    if (row === null) return null;
    await this.emitter.publish(input.userId, toWire(row));
    return row;
  }

  /**
   * Publish an **already-persisted** row — the tasks flow inserts the
   * notification inside its own mutation transaction (so a rollback never
   * leaves a dangling live event), then calls this after commit with the
   * row the repository returned. Callers must only pass rows that actually
   * landed (non-null) — pure-duplicate reminder inserts never reach here.
   */
  async publishExisting(row: NotificationView): Promise<void> {
    await this.emitter.publish(row.userId, toWire(row));
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Half a cursor (timestamp without id or vice versa) is a client bug —
   * answering "first page" instead would silently restart the list.
   */
  private parseCursor(
    query: ListNotificationsQueryDto,
  ): { createdAt: string; id: string } | null {
    const hasTimestamp = query.cursorCreatedAt !== undefined;
    const hasId = query.cursorId !== undefined;
    if (hasTimestamp !== hasId) {
      throw new BadRequestException({
        status: INVALID_CURSOR_STATUS,
        message: INVALID_CURSOR_MESSAGE,
      });
    }
    if (!hasTimestamp) return null;
    return {
      createdAt: query.cursorCreatedAt as string,
      id: query.cursorId as string,
    };
  }
}

const toWire = (row: NotificationView): PublishedNotification => ({
  id: row.id,
  type: row.type,
  taskId: row.taskId,
  title: row.title,
  body: row.body,
  readAt: row.readAt,
  createdAt: row.createdAt,
});
