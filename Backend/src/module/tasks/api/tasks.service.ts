import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ROLE_FORBIDDEN_MESSAGE,
  ROLE_FORBIDDEN_STATUS,
} from '../../../common/constants/role.constants';
import type { SessionUser } from '../../auth/api/session/session.types';
import { NotificationFactory } from '../../notifications/api/factories/notification.factory';
import { NotificationsService } from '../../notifications/api/notifications.service';
import {
  ASSIGN_TARGET_INVALID_MESSAGE,
  ASSIGN_TARGET_INVALID_STATUS,
  DUE_DATE_PAST_MESSAGE,
  DUE_DATE_PAST_STATUS,
  EMPTY_UPDATE_MESSAGE,
  EMPTY_UPDATE_STATUS,
  TASK_KEY_CONFLICT_MESSAGE,
  TASK_KEY_CONFLICT_STATUS,
  TASK_NOT_FOUND_MESSAGE,
  TASK_NOT_FOUND_STATUS,
  TASK_PROJECT_NOT_FOUND_MESSAGE,
  TASK_PROJECT_NOT_FOUND_STATUS,
} from './constants/tasks.constants';
import type { AssignTaskDto } from './dto/assign-task.dto';
import type { ChangeTaskStatusDto } from './dto/change-task-status.dto';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import type { Task } from './entities/task.entity';
import { TaskFactory } from './factories/task.factory';
import {
  type AssignTargetContext,
  type TaskActorContext,
  TasksPolicy,
} from './policies/tasks.policy';
import type { ProjectScope } from './repositories/tasks.repository';
import { TasksRepository } from './repositories/tasks.repository';

export interface TaskListResult {
  tasks: Task[];
}

/**
 * Orchestration for tasks. Routes carry Session → ActiveMember guards and
 * deliberately **no `@Roles`** (a Dev's self-create and a Lead's assign both
 * have to pass — the matrix is role *and* membership sensitive). Behind the
 * guards this service re-checks visibility (404), the mutation matrix
 * (403 role_forbidden) and the assignment matrix (400 assign_target_invalid)
 * on fresh DB reads — defense in depth, same hard convention as
 * projects/members.
 *
 * Due-date rules use the **server's UTC calendar day** only (plan §1): due
 * dates are date-only strings compared lexically; "today" passes, anything
 * older fails. The PATCH path rejects only *changed* past dates so an
 * overdue task keeps being editable (edge 3).
 *
 * Notification rule (plan §5): the notification row is inserted **inside
 * the same transaction** as the task mutation (create/assign) and the SSE
 * publish happens only after commit — a rollback never produces a live
 * event, and the notification is skipped when assignee equals actor.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly factory: TaskFactory,
    private readonly policy: TasksPolicy,
    private readonly repository: TasksRepository,
    private readonly notifications: NotificationsService,
    private readonly notificationFactory: NotificationFactory,
  ) {}

  /** Board payload — invisible project → 404 (no existence leak). */
  async list(projectId: string, actor: SessionUser): Promise<TaskListResult> {
    await this.requireVisible(projectId, actor);
    return { tasks: await this.repository.listByProject(projectId) };
  }

  /**
   * Create a task. Check order mirrors §3.1: visibility → HR/Dev
   * forcing → past-due → assignment target. A Dev's create is a self
   * assign — `assigneeId` must be (or become) self, anything else (or
   * omitted) → 403 role_forbidden. One transaction allocates the seq under
   * the project advisory lock and inserts the task + optional notification;
   * the SSE publish runs after commit.
   */
  async create(
    projectId: string,
    dto: CreateTaskDto,
    actor: SessionUser,
  ): Promise<Task> {
    const scope = await this.requireVisible(projectId, actor);
    const context = this.actorContext(actor, scope);
    if (!this.policy.canCreate(context)) throw this.roleForbidden();

    const assigneeId: string | null = dto.assigneeId ?? null;
    if (actor.role === 'Dev') {
      // Forced to self: any other target — or an omitted assignee (edge 8,
      // a Dev's create *is* an assignment) — is a 403.
      if (assigneeId !== actor.userId) throw this.roleForbidden();
    }

    this.rejectPastDue(dto.dueDate);

    if (assigneeId !== null) {
      await this.requireValidTarget(scope, context, actor.userId, assigneeId);
    }

    const input = this.factory.create(dto, {
      projectId: scope.id,
      projectName: scope.name,
      assigneeId,
      createdByUserId: actor.userId,
    });

    const notifyAssignee = assigneeId !== null && assigneeId !== actor.userId;

    const result = await this.repository.create(input, (created) =>
      notifyAssignee
        ? this.notificationFactory.createTaskAssigned(
            assigneeId as string,
            created,
            scope.name,
          )
        : null,
    );
    if (result.outcome === 'conflict') {
      throw new ConflictException({
        status: TASK_KEY_CONFLICT_STATUS,
        message: TASK_KEY_CONFLICT_MESSAGE,
      });
    }

    // Publish only after commit — never for a rolled-back insert (§5).
    if (result.notification !== null) {
      await this.notifications.publishExisting(result.notification);
    }
    return result.task;
  }

  /** Single task — missing or invisible → 404 `task_not_found`. */
  async findOne(taskId: string, actor: SessionUser): Promise<Task> {
    const { task } = await this.requireTask(taskId, actor);
    return task;
  }

  /**
   * Field edits — full actors only (the assignee gets status moves only).
   * Nothing to change → 400 `empty_update`. Due-date rejection only when
   * the value *changes* to a past day (no-change exemption — edge 3).
   */
  async update(
    taskId: string,
    dto: UpdateTaskDto,
    actor: SessionUser,
  ): Promise<Task> {
    const { task, scope } = await this.requireTask(taskId, actor);
    const context = this.actorContext(actor, scope);
    if (!this.policy.canManage(context)) throw this.roleForbidden();

    if (
      dto.title === undefined &&
      dto.description === undefined &&
      dto.priority === undefined &&
      dto.dueDate === undefined
    ) {
      throw new BadRequestException({
        status: EMPTY_UPDATE_STATUS,
        message: EMPTY_UPDATE_MESSAGE,
      });
    }

    const changes: {
      title?: string;
      description?: string;
      priority?: Task['priority'];
      dueDate?: string | null;
    } = {};
    if (dto.title !== undefined) changes.title = dto.title;
    if (dto.description !== undefined) changes.description = dto.description;
    if (dto.priority !== undefined) changes.priority = dto.priority;
    if (dto.dueDate !== undefined && dto.dueDate !== task.dueDate) {
      this.rejectPastDue(dto.dueDate);
      changes.dueDate = dto.dueDate;
    }

    const updated = await this.repository.update(taskId, changes);
    if (updated === null) throw this.taskNotFound();
    return updated;
  }

  /**
   * Status move — full actors always; anyone else must be the task's
   * assignee (403 otherwise). Free transition, last-write-wins.
   */
  async changeStatus(
    taskId: string,
    dto: ChangeTaskStatusDto,
    actor: SessionUser,
  ): Promise<Task> {
    const { task, scope } = await this.requireTask(taskId, actor);
    const context = this.actorContext(actor, scope);
    if (
      !this.policy.canMoveStatus(
        context,
        task.assignee?.id ?? null,
        actor.userId,
      )
    ) {
      throw this.roleForbidden();
    }
    const updated = await this.repository.changeStatus(taskId, dto.status);
    if (updated === null) throw this.taskNotFound();
    return updated;
  }

  /**
   * Assign / reassign / unassign. Full actors only; then the §1.2 matrix
   * against the *new* value (`null` skips target checks). Same-value assign
   * → 200 no-op, no lock and no notification (edge 18). On change: the
   * notification lands in the same transaction; only a *different* assignee
   * is notified — self-assign silent, unassign silent, A→B tells B only.
   */
  async assign(
    taskId: string,
    dto: AssignTaskDto,
    actor: SessionUser,
  ): Promise<Task> {
    const { task, scope } = await this.requireTask(taskId, actor);
    const context = this.actorContext(actor, scope);
    if (!this.policy.canManage(context)) throw this.roleForbidden();

    const assigneeId = dto.assigneeId;
    const currentId = task.assignee?.id ?? null;
    if (assigneeId === currentId) return task; // 200 no-op

    if (assigneeId !== null) {
      await this.requireValidTarget(scope, context, actor.userId, assigneeId);
    }

    const notifyAssignee = assigneeId !== null && assigneeId !== actor.userId;
    const result = await this.repository.assign(
      taskId,
      assigneeId,
      notifyAssignee
        ? this.notificationFactory.createTaskAssigned(
            assigneeId as string,
            task,
            scope.name,
          )
        : null,
    );
    if (result.outcome === 'missing') throw this.taskNotFound();

    if (result.notification !== null) {
      await this.notifications.publishExisting(result.notification);
    }
    return result.task;
  }

  /** Delete — full actors only; the task's notifications cascade with it. */
  async remove(taskId: string, actor: SessionUser): Promise<void> {
    const { task, scope } = await this.requireTask(taskId, actor);
    const context = this.actorContext(actor, scope);
    if (!this.policy.canManage(context)) throw this.roleForbidden();
    await this.repository.remove(task.id);
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Load the project scope + actor's membership and run the visibility
   * half of the matrix. Missing project and invisible project are the same
   * 404 (plan §1.1 — no existence leak).
   */
  private async requireVisible(
    projectId: string,
    actor: SessionUser,
  ): Promise<ProjectScope> {
    const scope = await this.repository.findProjectScope(
      projectId,
      actor.userId,
    );
    if (scope === null || !this.policy.canSee(actor.role, scope.isMember)) {
      throw this.projectNotFound();
    }
    return scope;
  }

  /**
   * Task + its project scope. A missing task *and* an invisible project
   * both answer `task_not_found` on task routes (plan §3.1 — the project
   * 404 is only for project-scoped routes, so `/tasks/:id` never leaks
   * which of the two happened).
   */
  private async requireTask(
    taskId: string,
    actor: SessionUser,
  ): Promise<{ task: Task; scope: ProjectScope }> {
    const task = await this.repository.findById(taskId);
    if (task === null) throw this.taskNotFound();
    const scope = await this.repository.findProjectScope(
      task.projectId,
      actor.userId,
    );
    if (scope === null || !this.policy.canSee(actor.role, scope.isMember)) {
      throw this.taskNotFound();
    }
    return { task, scope };
  }

  /**
   * Assignment matrix against a resolved roster row (§1.2). Anything the
   * matrix rejects — stranger, HR, INVITED-only, wrong role, no assign
   * rights — is the same 400 `assign_target_invalid`.
   */
  private async requireValidTarget(
    scope: ProjectScope,
    context: TaskActorContext,
    actorUserId: string,
    targetUserId: string,
  ): Promise<void> {
    const [member] = await this.repository.findRosterMembers(scope.id, [
      targetUserId,
    ]);
    const target: AssignTargetContext =
      member === undefined
        ? { userId: targetUserId, role: 'Dev', isActiveProjectMember: false }
        : {
            userId: member.userId,
            role: member.role as AssignTargetContext['role'],
            isActiveProjectMember: member.isMember && member.isActiveOrgMember,
          };
    if (!this.policy.canAssignTarget(context, actorUserId, target)) {
      throw new BadRequestException({
        status: ASSIGN_TARGET_INVALID_STATUS,
        message: ASSIGN_TARGET_INVALID_MESSAGE,
      });
    }
  }

  /** Session role + freshly-read membership attributes → policy input. */
  private actorContext(
    actor: SessionUser,
    scope: ProjectScope,
  ): TaskActorContext {
    return {
      role: actor.role,
      isMember: scope.isMember,
      isLead: scope.isLead,
    };
  }

  /** Past-due guard — "today" is allowed; null/undefined never rejects. */
  private rejectPastDue(dueDate: string | null | undefined): void {
    if (dueDate === null || dueDate === undefined) return;
    if (dueDate < todayUtc()) {
      throw new BadRequestException({
        status: DUE_DATE_PAST_STATUS,
        message: DUE_DATE_PAST_MESSAGE,
      });
    }
  }

  private roleForbidden(): ForbiddenException {
    return new ForbiddenException({
      status: ROLE_FORBIDDEN_STATUS,
      message: ROLE_FORBIDDEN_MESSAGE,
    });
  }

  private taskNotFound(): NotFoundException {
    return new NotFoundException({
      status: TASK_NOT_FOUND_STATUS,
      message: TASK_NOT_FOUND_MESSAGE,
    });
  }

  private projectNotFound(): NotFoundException {
    return new NotFoundException({
      status: TASK_PROJECT_NOT_FOUND_STATUS,
      message: TASK_PROJECT_NOT_FOUND_MESSAGE,
    });
  }
}

/** Today as `YYYY-MM-DD` in UTC — the only clock the date rules use. */
const todayUtc = (): string => new Date().toISOString().slice(0, 10);
