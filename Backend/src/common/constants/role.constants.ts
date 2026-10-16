/**
 * 403 body thrown by `RolesGuard` when the session role is not among the
 * handler's `@Roles(...)` set. Generic on purpose — the vocabulary is no
 * longer tied to any single gated route.
 */
export const ROLE_FORBIDDEN_STATUS = 'role_forbidden';
export const ROLE_FORBIDDEN_MESSAGE =
  'Your role is not allowed to perform this action.';
