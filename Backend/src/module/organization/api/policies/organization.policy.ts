import { Injectable } from '@nestjs/common';
import type { SessionUser } from '../../../auth/api/session/session.types';

/**
 * ABAC for organization mutations: Admin only. PM previously managed the
 * organization when it owned it (`createdByUserId`); that branch is gone —
 * the row still records its creator, but it grants no rights. The role
 * attribute comes from the Redis session snapshot, never the request body.
 * Simplified from `(actor, organization)` while only one attribute decides
 * the outcome (YAGNI — reintroduce the row parameter if a future rule
 * needs it).
 */
@Injectable()
export class OrganizationPolicy {
  canManage(actor: SessionUser): boolean {
    return actor.role === 'Admin';
  }
}
