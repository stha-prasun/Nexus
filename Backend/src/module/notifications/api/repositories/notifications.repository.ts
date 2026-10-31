import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import { notifications } from '../../../database/schema';
import type { NotificationType } from '../constants/notifications.constants';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * API-facing notification shape. `createdAt` is a **fixed-width UTC string**
 * (six fraction digits, always JS-safe): a JS `Date` round-trips only
 * milliseconds, which at a page boundary would skip or duplicate rows — the
 * cursor comparison itself runs inside Postgres at full precision and the
 * string is simply the client-visible form of the same value (plan §3.2).
 */
export interface NotificationView {
  id: string;
  userId: string;
  type: NotificationType;
  taskId: string | null;
  title: string;
  body: string;
  dedupeKey: string | null;
  readAt: Date | null;
  createdAt: string;
}

export interface NotificationPage {
  notifications: NotificationView[];
  /** True when another page exists (limit+1 probe). */
  hasMore: boolean;
  unreadCount: number;
}

export interface NotificationCursor {
  createdAt: string;
  id: string;
}

/** Insert payload — `readAt` is always null at creation. */
export interface NotificationInsert {
  userId: string;
  type: NotificationType;
  taskId: string | null;
  title: string;
  body: string;
  dedupeKey: string | null;
}

/**
 * `createdAt` as a fixed-width UTC string — the single source for both the
 * response body and the pagination cursor, so the pair can never drift.
 */
const createdAtText = sql<string>`to_char(${notifications.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const notificationSelect = {
  id: notifications.id,
  userId: notifications.userId,
  type: notifications.type,
  taskId: notifications.taskId,
  title: notifications.title,
  body: notifications.body,
  dedupeKey: notifications.dedupeKey,
  readAt: notifications.readAt,
  createdAt: createdAtText,
};

type NotificationRow = {
  id: string;
  userId: string;
  type: NotificationType;
  taskId: string | null;
  title: string;
  body: string;
  dedupeKey: string | null;
  readAt: Date | null;
  createdAt: string;
};

/**
 * Drizzle persistence for notifications. Cursor pagination orders by
 * `(createdAt DESC, id DESC)` and filters with a Postgres **row-value
 * comparison** — `(created_at, id) < ($cursor::timestamptz, $id::uuid)` —
 * so the microsecond boundary and the id tie-break are evaluated by the
 * database, never by a lossy JS Date. Inserts go through
 * `ON CONFLICT (taskId, userId, dedupeKey) DO NOTHING` and report whether a
 * row actually landed, which is what lets the reminder sweep publish SSE
 * events for real inserts only (plan §7).
 */
@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * One page of a user's notifications, newest first, plus the derived
   * unread count. `limit + 1` rows are fetched: one extra proves whether
   * another page exists, so `nextCursor` is never offered on the last page.
   */
  async listForUser(
    userId: string,
    limit: number,
    cursor: NotificationCursor | null,
  ): Promise<NotificationPage> {
    const conditions = [eq(notifications.userId, userId)];
    if (cursor !== null) {
      conditions.push(
        sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`,
      );
    }
    const rows = (await this.db
      .select(notificationSelect)
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1)) as NotificationRow[];

    const hasMore = rows.length > limit;
    const page = (hasMore ? rows.slice(0, limit) : rows).map(toView);
    const unreadCount = await this.countUnread(this.db, userId);
    return { notifications: page, hasMore, unreadCount };
  }

  /** Unread badge — always `readAt IS NULL`, never a client tally. */
  async countUnread(db: Database | Tx, userId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      );
    return rows[0]?.count ?? 0;
  }

  /**
   * Mark one row read. Scoped to the owner: a foreign or unknown id yields
   * `not_found` (404, no ownership leak); an already-read row is a no-op
   * (`updated` either way — the service answers 204).
   */
  async markRead(id: string, userId: string): Promise<'updated' | 'not_found'> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    if (rows.length > 0) return 'updated';
    // Distinguish "already read" (204 no-op) from "not yours" (404).
    const exists = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .limit(1);
    return exists.length > 0 ? 'updated' : 'not_found';
  }

  /** Mark every unread row of this user read in one statement. */
  async markAllRead(userId: string): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      )
      .returning({ id: notifications.id });
    return rows.length;
  }

  /**
   * Insert a notification; `ON CONFLICT DO NOTHING` on the
   * (taskId, userId, dedupeKey) unique — reminder inserts are idempotent
   * and assignment rows (dedupeKey NULL) never collide (PG treats NULLs as
   * distinct). Returns null when the row already existed, so the caller
   * only publishes an SSE event for a row that actually landed.
   */
  async insert(
    input: NotificationInsert,
    db: Database | Tx = this.db,
  ): Promise<NotificationView | null> {
    const rows = (await db
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        taskId: input.taskId,
        title: input.title,
        body: input.body,
        dedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing({
        target: [
          notifications.taskId,
          notifications.userId,
          notifications.dedupeKey,
        ],
      })
      .returning(notificationSelect)) as NotificationRow[];
    const row = rows[0];
    return row === undefined ? null : toView(row);
  }
}

const toView = (row: NotificationRow): NotificationView => ({
  id: row.id,
  userId: row.userId,
  type: row.type,
  taskId: row.taskId,
  title: row.title,
  body: row.body,
  dedupeKey: row.dedupeKey,
  readAt: row.readAt,
  createdAt: row.createdAt,
});
