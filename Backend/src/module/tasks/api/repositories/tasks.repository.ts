import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import {
  organizationMembers,
  projectMembers,
  projects,
  tasks,
  users,
} from '../../../database/schema';
import type {
  NotificationInsert,
  NotificationView,
} from '../../../notifications/api/repositories/notifications.repository';
import { NotificationsRepository } from '../../../notifications/api/repositories/notifications.repository';
import {
  TASK_PRIORITY_RANK,
  type TaskPriority,
  type TaskStatus,
} from '../constants/tasks.constants';
import { Task, type TaskAssigneeSummary } from '../entities/task.entity';
import type { TaskCreateInput } from '../factories/task.factory';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Project scoping context — name drives the task key prefix (§8.2). */
export interface ProjectScope {
  id: string;
  name: string;
  /** Actor is a row in `project_members`. */
  isMember: boolean;
  /** Actor's `project_members.is_lead` flag on this project. */
  isLead: boolean;
}

/** Roster row for assignment-target validation (§1.2). */
export interface RosterMember {
  userId: string;
  role: string;
  isMember: boolean;
  isActiveOrgMember: boolean;
}

export type CreateTaskResult =
  | { outcome: 'created'; task: Task; notification: NotificationView | null }
  | { outcome: 'conflict' };

export type AssignTaskResult =
  | { outcome: 'assigned'; task: Task; notification: NotificationView | null }
  | { outcome: 'missing' };

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === '23505';

const creators = alias(users, 'task_creators');

const taskSelect = {
  id: tasks.id,
  projectId: tasks.projectId,
  seq: tasks.seq,
  key: tasks.key,
  title: tasks.title,
  description: tasks.description,
  status: tasks.status,
  priority: tasks.priority,
  dueDate: tasks.dueDate,
  createdByUserId: tasks.createdByUserId,
  createdAt: tasks.createdAt,
  updatedAt: tasks.updatedAt,
  assigneeId: tasks.assigneeId,
  assigneeName: users.name,
  assigneeEmail: users.email,
  createdByName: creators.name,
};

type TaskJoinRow = {
  id: string;
  projectId: string;
  seq: number;
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  createdByName: string;
};

/**
 * Board ordering: **(priorityRank, createdAt)** — urgent work first inside
 * each column, oldest task first among equals. The CASE keeps the order
 * explicit rather than leaning on PG's enum declaration order.
 */
const priorityRank = sql<number>`CASE ${tasks.priority}
  WHEN 'urgent' THEN ${TASK_PRIORITY_RANK.urgent}
  WHEN 'high' THEN ${TASK_PRIORITY_RANK.high}
  WHEN 'medium' THEN ${TASK_PRIORITY_RANK.medium}
  ELSE ${TASK_PRIORITY_RANK.low}
END`;

/**
 * Drizzle persistence for tasks. Three responsibilities beyond CRUD:
 *
 * 1. **Counter-based create** (§8.2): under `pg_advisory_xact_lock` on the
 *    same `nexus:project:` key the projects module uses, increment
 *    `projects.taskCounter` (`RETURNING`) and insert with that seq — keys
 *    are monotonic and never reissued, unlike `MAX(seq)+1`. The
 *    `unique(projectId, seq)` backstop maps 23505 → 'conflict' (409).
 * 2. **Notification in the same transaction** as the task mutation (§5) —
 *    the SSE publish happens in the service *after* commit, so a rollback
 *    never produces a live event.
 * 3. **Hydrated views**: assignee summary via a LEFT JOIN on users (board
 *    avatars, no second fetch); roster rows join org membership so the
 *    assignment matrix sees ACTIVE status.
 */
@Injectable()
export class TasksRepository {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly notifications: NotificationsRepository,
  ) {}

  /** Project name + actor's membership flags — visibility + key material. */
  async findProjectScope(
    projectId: string,
    actorUserId: string,
  ): Promise<ProjectScope | null> {
    const rows = await this.db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const project = rows[0];
    if (project === undefined) return null;
    const memberships = await this.db
      .select({
        isLead: projectMembers.isLead,
      })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, actorUserId),
        ),
      )
      .limit(1);
    const membership = memberships[0];
    return {
      id: project.id,
      name: project.name,
      isMember: membership !== undefined,
      isLead: membership?.isLead ?? false,
    };
  }

  /**
   * Roster lookup for assignment validation: for the given user ids, their
   * project-membership presence, org role and ACTIVE org status. Ids that
   * are not project members are simply absent from the result (→ 400).
   */
  async findRosterMembers(
    projectId: string,
    userIds: string[],
  ): Promise<RosterMember[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select({
        userId: users.id,
        role: users.role,
        organizationStatus: organizationMembers.status,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .leftJoin(organizationMembers, eq(organizationMembers.userId, users.id))
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          inArray(users.id, userIds),
        ),
      );
    return rows.map((row) => ({
      userId: row.userId,
      role: row.role,
      isMember: true,
      isActiveOrgMember: row.organizationStatus === 'ACTIVE',
    }));
  }

  /** Every task of a project, board-ordered, with assignee summaries. */
  async listByProject(projectId: string): Promise<Task[]> {
    const rows = (await this.db
      .select(taskSelect)
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .leftJoin(creators, eq(tasks.createdByUserId, creators.id))
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(priorityRank), asc(tasks.createdAt))) as TaskJoinRow[];
    return rows.map(toTask);
  }

  /** One hydrated task, or null (missing and invisible stay 404). */
  async findById(taskId: string): Promise<Task | null> {
    const rows = (await this.db
      .select(taskSelect)
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .leftJoin(creators, eq(tasks.createdByUserId, creators.id))
      .where(eq(tasks.id, taskId))
      .limit(1)) as TaskJoinRow[];
    const row = rows[0];
    return row === undefined ? null : toTask(row);
  }

  /**
   * Create the task under the project's advisory lock: increment the
   * monotonic counter (`RETURNING` is the seq) → insert the row →
   * optionally insert the `task_assigned` notification, all in one
   * transaction. The notification is a **factory** invoked with the created
   * task: its body carries `task.key`, which does not exist until the seq
   * is allocated above, so a pre-built insert could never be correct.
   * A lost `unique(projectId, seq)` race maps to 'conflict'
   * (409 `task_key_conflict` — the client retries).
   */
  async create(
    input: TaskCreateInput,
    notificationFor: (task: Task) => NotificationInsert | null,
  ): Promise<CreateTaskResult> {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`nexus:project:${input.projectId}`})::bigint)`,
        );
        const counters = await tx
          .update(projects)
          .set({ taskCounter: sql`${projects.taskCounter} + 1` })
          .where(eq(projects.id, input.projectId))
          .returning({ taskCounter: projects.taskCounter });
        const counter = counters[0]?.taskCounter;
        if (counter === undefined) {
          // Project deleted mid-flight (cascade would roll this back anyway).
          throw new Error(`project ${input.projectId} vanished during create`);
        }

        const inserted = await tx
          .insert(tasks)
          .values({
            id: input.id,
            projectId: input.projectId,
            seq: counter,
            // Key derives from the seq actually allocated under the lock —
            // one code path, no stale-seq mismatch possible.
            key: `${input.keyPrefix}-${counter}`,
            title: input.title,
            description: input.description,
            status: input.status,
            priority: input.priority,
            assigneeId: input.assigneeId,
            dueDate: input.dueDate,
            createdByUserId: input.createdByUserId,
            createdAt: input.createdAt,
          })
          .returning({ id: tasks.id });
        const taskId = inserted[0]?.id;
        if (taskId === undefined) throw new Error('task insert returned no id');

        const task = await this.loadTask(tx, taskId);
        if (task === null)
          throw new Error(`task ${taskId} vanished after insert`);

        const notificationRow = notificationFor(task);
        const saved =
          notificationRow === null
            ? null
            : await this.notifications.insert(notificationRow, tx);

        return { outcome: 'created' as const, task, notification: saved };
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { outcome: 'conflict' };
      throw error;
    }
  }

  /** Field edits (`PATCH`) — `updatedAt` comes from `$onUpdate`. */
  async update(
    taskId: string,
    changes: {
      title?: string;
      description?: string;
      priority?: TaskPriority;
      dueDate?: string | null;
    },
  ): Promise<Task | null> {
    await this.db.update(tasks).set(changes).where(eq(tasks.id, taskId));
    return this.findById(taskId);
  }

  /** Status move — last-write-wins, no locking (plan §1). */
  async changeStatus(taskId: string, status: TaskStatus): Promise<Task | null> {
    await this.db.update(tasks).set({ status }).where(eq(tasks.id, taskId));
    return this.findById(taskId);
  }

  /**
   * Reassign in one transaction with the optional notification row (§5).
   * `assigneeId` may be `null` (unassign — no notification by construction).
   * Same-value assigns never reach here (the service short-circuits).
   */
  async assign(
    taskId: string,
    assigneeId: string | null,
    notification: NotificationInsert | null,
  ): Promise<AssignTaskResult> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(tasks)
        .set({ assigneeId })
        .where(eq(tasks.id, taskId))
        .returning({ id: tasks.id });
      if (updated[0] === undefined) return { outcome: 'missing' as const };

      const notificationRow =
        notification === null
          ? null
          : await this.notifications.insert(notification, tx);

      const task = await this.loadTask(tx, taskId);
      if (task === null) return { outcome: 'missing' as const };
      return {
        outcome: 'assigned' as const,
        task,
        notification: notificationRow,
      };
    });
  }

  /** Hard delete — the task's notifications cascade with it. */
  async remove(taskId: string): Promise<void> {
    await this.db.delete(tasks).where(eq(tasks.id, taskId));
  }

  // ---------------------------------------------------------------- helpers

  private async loadTask(
    tx: Database | Tx,
    taskId: string,
  ): Promise<Task | null> {
    const rows = (await tx
      .select(taskSelect)
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .leftJoin(creators, eq(tasks.createdByUserId, creators.id))
      .where(eq(tasks.id, taskId))
      .limit(1)) as TaskJoinRow[];
    const row = rows[0];
    return row === undefined ? null : toTask(row);
  }
}

const toTask = (row: TaskJoinRow): Task => {
  const assignee: TaskAssigneeSummary | null =
    row.assigneeId !== null &&
    row.assigneeName !== null &&
    row.assigneeEmail !== null
      ? {
          id: row.assigneeId,
          name: row.assigneeName,
          email: row.assigneeEmail,
        }
      : null;
  return new Task({
    id: row.id,
    projectId: row.projectId,
    seq: row.seq,
    key: row.key,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assignee,
    dueDate: row.dueDate,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
};
