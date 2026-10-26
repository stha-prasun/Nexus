import { Injectable } from '@nestjs/common';
import type { Role } from '../../../auth/api/constants/auth.constants';

/**
 * ABAC for projects — the single source of truth for the §1.1 matrix.
 * Roles come from the Redis session snapshot, never the request body;
 * `isMember` / target-role attributes come from fresh DB reads in the
 * service (defense in depth behind RolesGuard + ActiveMemberGuard).
 *
 * Visibility and management are separate predicates: HR/Dev can *see*
 * (HR: everything; Dev: their projects) without any mutation right — the
 * service maps can-see-but-not-manage to 403 and cannot-see to 404.
 */
@Injectable()
export class ProjectsPolicy {
  /** Admin/HR see every project; PM/Dev only projects they belong to. */
  canSee(actorRole: Role, isMember: boolean): boolean {
    return actorRole === 'Admin' || actorRole === 'HR' || isMember;
  }

  /** Create: Admin + PM only (RolesGuard enforces; this is the re-check). */
  canCreate(actorRole: Role): boolean {
    return actorRole === 'Admin' || actorRole === 'PM';
  }

  /**
   * Update / delete / add-member / lead toggle: Admin manages any project;
   * PM manages only projects they are a member of. HR/Dev never manage.
   */
  canManage(actorRole: Role, isMember: boolean): boolean {
    if (actorRole === 'Admin') return true;
    return actorRole === 'PM' && isMember;
  }

  /**
   * Removal target half of the matrix: Admin may remove anyone (self and
   * sole-lead invariants apply separately); PM may remove Dev targets only.
   */
  canRemoveTarget(actorRole: Role, targetOrgRole: Role): boolean {
    if (actorRole === 'Admin') return true;
    return actorRole === 'PM' && targetOrgRole === 'Dev';
  }
}
