import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '../../module/auth/api/constants/auth.constants';
import type { SessionUser } from '../../module/auth/api/session/session.types';
import {
  PM_REQUIRED_MESSAGE,
  PM_REQUIRED_STATUS,
} from '../../module/organization/api/constants/organization.constants';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Enforces the `@Roles(...)` attribute on a handler/class, using the session
 * snapshot attached by `SessionAuthGuard` — never attributes from the
 * request body. Routes without `@Roles` pass through untouched.
 *
 * The role-failure body is `pm_required` because every role-gated route so
 * far is PM-gated (organization create/update/delete); the vocabulary lives
 * with that first consumer (organization.constants.ts). Fails closed when
 * `req.user` is missing, i.e. `SessionAuthGuard` was not applied.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) {
      return true;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<Request & { user?: SessionUser }>();
    if (user === undefined) {
      return false;
    }
    if (required.includes(user.role)) {
      return true;
    }
    throw new ForbiddenException({
      status: PM_REQUIRED_STATUS,
      message: PM_REQUIRED_MESSAGE,
    });
  }
}
