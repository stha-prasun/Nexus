import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../../module/auth/api/constants/auth.constants';
import type { SessionUser } from '../../module/auth/api/session/session.types';
import {
  ROLE_FORBIDDEN_MESSAGE,
  ROLE_FORBIDDEN_STATUS,
} from '../constants/role.constants';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  const user = (role: Role): SessionUser => ({
    userId: 'user-1',
    role,
    name: 'Ada',
    email: 'ada@example.com',
  });

  const context = (
    roles: Role[] | undefined,
    sessionUser?: SessionUser,
  ): ExecutionContext => {
    const handler = (): undefined => undefined;
    if (roles !== undefined) {
      // What @Roles(...) does under the hood; avoids decorator-invocation
      // overload friction in a plain unit test.
      Reflect.defineMetadata(ROLES_KEY, roles, handler);
    }
    return {
      getHandler: () => handler as never,
      getClass: () => class Empty {},
      switchToHttp: () => ({
        getRequest: () =>
          sessionUser === undefined ? {} : { user: sessionUser },
      }),
    } as unknown as ExecutionContext;
  };

  it('passes through when the handler carries no @Roles attribute', () => {
    expect(guard.canActivate(context(undefined, user('Dev')))).toBe(true);
  });

  it('passes when the session role is among the required roles', () => {
    expect(guard.canActivate(context(['Admin'], user('Admin')))).toBe(true);
  });

  it('throws role_forbidden when the session role is not allowed', () => {
    expect(() => guard.canActivate(context(['Admin'], user('PM')))).toThrow(
      ForbiddenException,
    );
    try {
      guard.canActivate(context(['Admin'], user('Dev')));
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual({
        status: ROLE_FORBIDDEN_STATUS,
        message: ROLE_FORBIDDEN_MESSAGE,
      });
    }
  });

  it('fails closed when req.user is missing (SessionAuthGuard not applied)', () => {
    expect(guard.canActivate(context(['Admin']))).toBe(false);
  });
});
