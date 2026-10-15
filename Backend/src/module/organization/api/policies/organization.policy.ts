import { Injectable } from '@nestjs/common';
import type { SessionUser } from '../../../auth/api/session/session.types';
import type { Organization } from '../entities/organization.entity';

/**
 * ABAC for organization mutations: `(PM ∧ owner) ∨ Admin`. The Admin
 * branch is break-glass so the singleton can never be orphaned when the
 * creator is deleted or demoted. Both attributes come from the Redis
 * session snapshot and the loaded row — never from the request body.
 */
@Injectable()
export class OrganizationPolicy {
  canManage(actor: SessionUser, organization: Organization): boolean {
    return (
      actor.role === 'Admin' ||
      (actor.role === 'PM' && actor.userId === organization.createdByUserId)
    );
  }
}
