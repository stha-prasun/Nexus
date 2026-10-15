import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../module/auth/api/constants/auth.constants';

export const ROLES_KEY = 'roles';

/**
 * Role attribute for a route, enforced by `RolesGuard` after
 * `SessionAuthGuard` has attached the session snapshot to `req.user`.
 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
