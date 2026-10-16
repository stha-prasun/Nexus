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
  ROLE_FORBIDDEN_MESSAGE,
  ROLE_FORBIDDEN_STATUS,
} from '../constants/role.constants';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Enforces the `@Roles(...)` attribute on a handler/class, using the session
 * snapshot attached by `SessionAuthGuard` — never attributes from the
 * request body. Routes without `@Roles` pass through untouched.
 *
 * The failure body is the generic `role_forbidden` (see
 * common/constants/role.constants.ts); callers may gate any subset of
 * ROLES (e.g. Admin-only organization management). Fails closed when
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
      status: ROLE_FORBIDDEN_STATUS,
      message: ROLE_FORBIDDEN_MESSAGE,
    });
  }
}
