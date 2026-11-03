import { Injectable } from '@nestjs/common';
import type { Role } from '../../../auth/api/constants/auth.constants';

/**
 * Attributes the matrices need — all read fresh from Postgres in the
 * service (defense in depth behind ActiveMemberGuard). `isLead` is
 * per-project (`project_members.is_lead`), never an org role.
 */
export interface DocumentActorContext {
  role: Role;
  isMember: boolean;
  isLead: boolean;
}

/**
 * ABAC for project documents — the single source of truth for the plan §1
 * permission matrix. Mirrors `TasksPolicy.canSee` / `canManage` exactly so
 * the two modules can never disagree about who sees or manages a project:
 *
 * | Actor | View / download | Upload / delete |
 * |---|---|---|
 * | Admin (any project) | yes | yes |
 * | HR (any project) | yes | no |
 * | PM, member | yes | yes |
 * | PM, non-member | 404 | 404 |
 * | Lead Dev, member | yes | yes |
 * | Dev, member | yes | no |
 * | Dev, non-member | 404 | 404 |
 *
 * Two deliberate failure shapes (same split as tasks):
 * - `canSee` false → **404** — missing and forbidden are indistinguishable,
 *   no existence leak.
 * - visible but not allowed (e.g. plain Dev uploading) → **403**
 *   `role_forbidden`.
 */
@Injectable()
export class DocumentsPolicy {
  /** Admin/HR see every project's documents; PM/Dev only their own. */
  canSee(actorRole: Role, isMember: boolean): boolean {
    return actorRole === 'Admin' || actorRole === 'HR' || isMember;
  }

  /**
   * Upload / delete — full actors only: Admin any project, PM or project
   * Lead when a member. HR (read-only) and plain Devs never; non-members
   * never reach this (404 on `canSee` first).
   */
  canManage(actor: DocumentActorContext): boolean {
    if (actor.role === 'Admin') return true;
    if (!actor.isMember) return false;
    return actor.role === 'PM' || actor.isLead;
  }
}
