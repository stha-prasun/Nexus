import { Injectable } from '@nestjs/common';
import type { Role } from '../../../auth/api/constants/auth.constants';

/**
 * Attributes the matrices need — all read fresh from Postgres in the
 * service (defense in depth behind ActiveMemberGuard). `isLead` is
 * per-project (`project_members.is_lead`), never an org role.
 */
export interface TaskActorContext {
  role: Role;
  isMember: boolean;
  isLead: boolean;
}

/** Assignment target as resolved from the project roster. */
export interface AssignTargetContext {
  userId: string;
  /** Org role of the target (`users.role`). */
  role: Role;
  /** Row in `project_members` **and** their org membership is ACTIVE. */
  isActiveProjectMember: boolean;
}

/**
 * ABAC for tasks — the single source of truth for the plan §1.1 visibility
 * matrix, §1.1 mutation matrix and §1.2 assignment matrix. Roles come from
 * the Redis session snapshot; membership/lead/target attributes come from
 * fresh DB reads in the service.
 *
 * Two deliberate shapes:
 * - Visibility failures answer 404 (missing and forbidden are
 *   indistinguishable — no existence leak); visible-but-forbidden answers
 *   403 `role_forbidden`.
 * - The **assignment** matrix validates the *target* side (who may be
 *   aimed at), so "a PM receives tasks only from Admin" falls out of
 *   Admin-only PM targets rather than a special case on the PM's routes.
 */
@Injectable()
export class TasksPolicy {
  /** Admin/HR see every project's tasks; PM/Dev only their own projects. */
  canSee(actorRole: Role, isMember: boolean): boolean {
    return actorRole === 'Admin' || actorRole === 'HR' || isMember;
  }

  /**
   * Create: everyone except HR. Admin creates on any project; PM/Lead/Dev
   * only inside a visible project (non-members 404 before this). A plain
   * Dev's create is a self-assign — the service forces `assigneeId = self`
   * (§1.1).
   */
  canCreate(actor: TaskActorContext): boolean {
    if (actor.role === 'HR') return false;
    if (actor.role === 'Admin') return true;
    return actor.isMember;
  }

  /**
   * Edit fields / delete / assign — full actors only: Admin any project,
   * PM or project Lead when a member. HR (read-only) and plain Devs never.
   * The assignee of a task gets **status moves only**, never field edits.
   */
  canManage(actor: TaskActorContext): boolean {
    if (actor.role === 'Admin') return true;
    if (!actor.isMember) return false;
    return actor.role === 'PM' || actor.isLead;
  }

  /**
   * Status move: full actors always, plus the task's **own assignee** (a
   * Dev moves their own card — §1.1). Free transition, no workflow
   * validation (plan §1).
   */
  canMoveStatus(
    actor: TaskActorContext,
    taskAssigneeId: string | null,
    actorUserId: string,
  ): boolean {
    // HR is read-only org-wide — even a (theoretically impossible) HR
    // assignee row never gets a status handle; the assignment matrix never
    // produces one, this keeps the pure function total.
    if (actor.role === 'HR') return false;
    if (this.canManage(actor)) return true;
    return taskAssigneeId !== null && taskAssigneeId === actorUserId;
  }

  /**
   * Target half of the assignment matrix (§1.2), checked on
   * create-with-assignee and on `POST /tasks/:id/assign`:
   *
   * | Actor | Allowed targets |
   * |---|---|
   * | Admin | project members with role Dev, PM or Admin (never HR — so Admin self-assign is a valid silent 200) |
   * | PM (member) | project members with role Dev only |
   * | Lead (member) | project members with role Dev only (includes self — a Lead is a Dev) |
   * | Dev (non-lead) | self only (their create, §1.1) |
   *
   * Any other combination (target not an ACTIVE project member, target is
   * HR, actor lacks assign rights, …) → false → 400 `assign_target_invalid`.
   * `assigneeId: null` (unassign) skips this entirely — the service only
   * calls it when a target id is present.
   */
  canAssignTarget(
    actor: TaskActorContext,
    actorUserId: string,
    target: AssignTargetContext,
  ): boolean {
    if (!target.isActiveProjectMember) return false;
    if (actor.role === 'Admin') {
      return (
        target.role === 'Dev' || target.role === 'PM' || target.role === 'Admin'
      );
    }
    if (!actor.isMember) return false;
    // PM member and project Lead: Dev targets only. PM-as-assignee is
    // therefore Admin-only (rows 9–10 of the acceptance checklist).
    if (actor.role === 'PM' || actor.isLead) return target.role === 'Dev';
    // Plain Dev: their own create only — self-target, nobody else.
    return target.userId === actorUserId;
  }
}
