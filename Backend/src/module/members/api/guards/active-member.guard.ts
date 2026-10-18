import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SessionUser } from '../../../auth/api/session/session.types';
import {
  NOT_ACTIVE_MEMBER_MESSAGE,
  NOT_ACTIVE_MEMBER_STATUS,
} from '../constants/members.constants';
import { MembersRepository } from '../repositories/members.repository';

/**
 * Org-scoped route gate: when the singleton organization exists, the caller
 * must hold an ACTIVE membership in it — otherwise 403 `not_active_member`.
 * Lenient when **no org row exists** (the org-creation path: the seed Admin
 * has no membership yet by definition); services answer org-missing with
 * their own 409/404.
 *
 * Membership is read from Postgres on **every request** (one indexed
 * statement) — never from the session snapshot — so a removal takes effect
 * on the caller's very next call, even before session revocation lands.
 * Fails closed on repository errors (500): mirrors SessionAuthGuard's
 * Redis-outage stance, never silently passes.
 *
 * Hard convention: `RolesGuard` alone is never sufficient for an org-scoped
 * route — every such route also carries this guard.
 */
@Injectable()
export class ActiveMemberGuard implements CanActivate {
  constructor(private readonly repository: MembersRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionUser }>();
    const user = request.user;
    if (user === undefined) {
      // SessionAuthGuard must run first; fail closed rather than pass.
      return false;
    }

    const org = await this.repository.findOrganization();
    if (org === null) return true; // creation path — no org yet

    const membership = await this.repository.findActiveMembershipOrg(
      user.userId,
    );
    if (membership === null) {
      throw new ForbiddenException({
        status: NOT_ACTIVE_MEMBER_STATUS,
        message: NOT_ACTIVE_MEMBER_MESSAGE,
      });
    }
    return true;
  }
}
