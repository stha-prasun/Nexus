import type { Role } from '../constants/auth.constants';

/** Snapshot stored in the session JSON so future /auth/me needs 0 Postgres reads. */
export interface SessionUser {
  userId: string;
  role: Role;
  name: string;
  email: string;
}

/** Device context captured at login for the session-list UI. */
export interface SessionContext {
  userAgent?: string;
  ip?: string;
}

export interface SessionData extends SessionUser {
  createdAt: string;
  /** Opaque, safe-to-expose handle — the raw sid never leaves the server. */
  publicId: string;
  /** Last time an authenticated request touched this session (ISO). */
  lastActiveAt: string;
  userAgent?: string;
  ip?: string;
}
