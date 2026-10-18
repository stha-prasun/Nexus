/**
 * "Where was I before sign-in?" for the invite flow. The accept page stashes
 * its full path here when it needs an authenticated user; LoginPage consumes
 * it after a successful sign-in (and on its already-authenticated redirect)
 * so the invitee lands back on the exact link instead of the dashboard.
 *
 * sessionStorage (per-tab) keeps it from leaking across tabs, and only
 * `/accept-invite…` paths are ever honoured — nothing else can hijack where
 * a login lands.
 */
const KEY = 'nexus:invite-return';

const isInvitePath = (value: string | null): value is string =>
  value?.startsWith('/accept-invite') ?? false;

export function setInviteReturn(path: string): void {
  if (isInvitePath(path)) sessionStorage.setItem(KEY, path);
}

/** Read + clear. Returns the stored invite path or null (never a stale hop). */
export function takeInviteReturn(): string | null {
  const value = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  return isInvitePath(value) ? value : null;
}

/** Peek without consuming — for the already-authenticated redirect. */
export function peekInviteReturn(): string | null {
  const value = sessionStorage.getItem(KEY);
  return isInvitePath(value) ? value : null;
}

/** Token from the pending invite path, if any — for the signup prefill. */
export function peekInviteToken(): string | null {
  const path = peekInviteReturn();
  if (path === null) return null;
  return new URLSearchParams(path.split('?')[1] ?? '').get('token');
}
