import type { Role } from '../constants/auth.constants';

/** Snapshot stored in the session JSON so future /auth/me needs 0 Postgres reads. */
export interface SessionUser {
  userId: number;
  role: Role;
  name: string;
  email: string;
}

export interface SessionData extends SessionUser {
  createdAt: string;
}
