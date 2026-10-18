import { Injectable } from '@nestjs/common';
import type { Role } from '../../../auth/api/constants/auth.constants';

/**
 * Membership management matrix (§1.1 of the members plan) — single source of
 * truth for invite / role-change / removal policy. Actor and target roles are
 * the *state's* role: `invitedRole` for INVITED rows, `users.role` for ACTIVE
 * ones (the service resolves which before calling in).
 *
 * Rules: Admin manages anyone (including peer Admins). HR may invite a peer
 * HR but manage only PM/Dev. PM may invite a peer PM but manage only Dev.
 * Self-management is excluded here for every operation (target === actor →
 * false) — there is no self-demotion and no leave-organization.
 */
@Injectable()
export class MembersPolicy {
  canInviteRole(actorRole: Role, role: Role): boolean {
    switch (actorRole) {
      case 'Admin':
        return true;
      case 'HR':
        return role === 'PM' || role === 'Dev' || role === 'HR';
      case 'PM':
        return role === 'PM' || role === 'Dev';
      default:
        return false;
    }
  }

  canManageRole(actorRole: Role, targetRole: Role): boolean {
    switch (actorRole) {
      case 'Admin':
        return true;
      case 'HR':
        return targetRole === 'PM' || targetRole === 'Dev';
      case 'PM':
        return targetRole === 'Dev';
      default:
        return false;
    }
  }

  canRemove(actorRole: Role, targetRole: Role): boolean {
    return this.canManageRole(actorRole, targetRole);
  }
}
