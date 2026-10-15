/** Roles accepted at registration — single source for DTO validation + docs. */
export const ROLES = ['PM', 'Dev', 'Admin'] as const;

export type Role = (typeof ROLES)[number];

/** Injection token for the bcrypt cost factor (env `BCRYPT_ROUNDS`, default 12). */
export const BCRYPT_ROUNDS = 'BCRYPT_ROUNDS';

/**
 * Injection token for the eager dummy bcrypt hash used to equalize timing
 * when the email is unknown. Built at module init (same BCRYPT_ROUNDS as
 * real hashes) so the first unknown-email request isn't measurably slower.
 */
export const DUMMY_HASH = 'DUMMY_HASH';

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

/** 401 — unknown email and wrong password share this byte-identical body. */
export const INVALID_CREDENTIALS_MESSAGE = 'Email or password is incorrect.';

/** 403 — correct password on an account that never confirmed. */
export const LOGIN_UNVERIFIED_MESSAGE = EMAIL_UNVERIFIED_MESSAGE;

/** 429 — per-email lockout hit (the per-IP throttle reuses its own body). */
export const TOO_MANY_ATTEMPTS_MESSAGE =
  'Too many sign-in attempts. Please wait a few minutes and try again.';

/** 200 — logout (this device or all devices). */
export const LOGOUT_MESSAGE = 'You have been signed out.';
export const LOGOUT_ALL_MESSAGE = 'You have been signed out on all devices.';

/** 401 — no/invalid/expired session on /auth/me. */
export const UNAUTHENTICATED_MESSAGE = 'You are not signed in.';

/**
 * Per-email login failure counter (Redis): env `LOGIN_LOCKOUT_MAX` failures
 * within `LOGIN_LOCKOUT_WINDOW_SECONDS` → 429. Keys hold the normalized
 * email (same PII already in the users table).
 */
const lockoutMax = Number(process.env.LOGIN_LOCKOUT_MAX ?? 10);
const lockoutWindow = Number(process.env.LOGIN_LOCKOUT_WINDOW_SECONDS ?? 900);

export const LOGIN_LOCKOUT_MAX =
  Number.isFinite(lockoutMax) && lockoutMax > 0 ? lockoutMax : 10;

export const LOGIN_LOCKOUT_WINDOW_SECONDS =
  Number.isFinite(lockoutWindow) && lockoutWindow > 0 ? lockoutWindow : 900;

export const LOGIN_LOCKOUT_PREFIX = 'auth:login:fail:';

export const loginLockoutKey = (email: string): string =>
  `${LOGIN_LOCKOUT_PREFIX}${email}`;
