/** Roles accepted at registration — single source for DTO validation + docs. */
export const ROLES = ['PM', 'Dev', 'Admin'] as const;

export type Role = (typeof ROLES)[number];

/** Injection token for the bcrypt cost factor (env `BCRYPT_ROUNDS`, default 12). */
export const BCRYPT_ROUNDS = 'BCRYPT_ROUNDS';

/** Key prefixes for verification tokens: token→userId and userId→token. */
export const VERIFICATION_TOKEN_PREFIX = 'auth:verify:';
export const VERIFICATION_USER_PREFIX = 'auth:verify:uid:';

export const verificationTokenKey = (token: string): string =>
  `${VERIFICATION_TOKEN_PREFIX}${token}`;

export const verificationUserKey = (userId: string): string =>
  `${VERIFICATION_USER_PREFIX}${userId}`;

const ttlHours = Number(process.env.VERIFICATION_TOKEN_TTL_HOURS ?? 24);

/** Verification tokens live 24h by default (env `VERIFICATION_TOKEN_TTL_HOURS`). */
export const VERIFICATION_TOKEN_TTL_SECONDS =
  Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours * 3600 : 24 * 3600;

/** 201 — a brand-new account was created and its confirmation link sent. */
export const REGISTER_MESSAGE =
  'Your account was created — check your email for the confirmation link.';

/** 409 — the email belongs to a verified account. */
export const EMAIL_TAKEN_MESSAGE =
  'This email is already registered. Try signing in instead.';

/** 409 — the email belongs to an account that never confirmed. */
export const EMAIL_UNVERIFIED_MESSAGE =
  "This email has an account that hasn't been verified yet — check your inbox for the confirmation link.";

/**
 * Generic 202 on resend — reveals nothing about account state, so it stays
 * enumeration-safe by design (register is the route that answers honestly).
 */
export const RESEND_CONFIRMATION_MESSAGE =
  'If an unverified account exists for this email, a new confirmation link has been sent.';
