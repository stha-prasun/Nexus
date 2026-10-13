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

export const verificationUserKey = (userId: number): string =>
  `${VERIFICATION_USER_PREFIX}${userId}`;

const ttlHours = Number(process.env.VERIFICATION_TOKEN_TTL_HOURS ?? 24);

/** Verification tokens live 24h by default (env `VERIFICATION_TOKEN_TTL_HOURS`). */
export const VERIFICATION_TOKEN_TTL_SECONDS =
  Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours * 3600 : 24 * 3600;

/**
 * Identical register/resend responses regardless of account state —
 * prevents account enumeration.
 */
export const REGISTER_MESSAGE =
  'If this email is available, a confirmation link has been sent.';

export const RESEND_CONFIRMATION_MESSAGE =
  'If an unverified account exists for this email, a new confirmation link has been sent.';
