const cookieName = process.env.SESSION_COOKIE_NAME ?? 'nexus_sid';
const defaultTtl = Number(process.env.SESSION_TTL_SECONDS ?? 86_400);
const rememberTtl = Number(process.env.SESSION_REMEMBER_TTL_SECONDS ?? 604_800);

export const SESSION_COOKIE_NAME = cookieName;

/** Default session TTL (24h; env `SESSION_TTL_SECONDS`). */
export const SESSION_TTL_SECONDS =
  Number.isFinite(defaultTtl) && defaultTtl > 0 ? defaultTtl : 86_400;

/** "Remember me" TTL (7 days; env `SESSION_REMEMBER_TTL_SECONDS`). */
export const SESSION_REMEMBER_TTL_SECONDS =
  Number.isFinite(rememberTtl) && rememberTtl > 0 ? rememberTtl : 604_800;

export const SESSION_KEY_PREFIX = 'session:';

/** Sorted set of a user's live sids, scored by expiry epoch. */
export const USER_SESSIONS_KEY_PREFIX = 'user:sessions:';

export const sessionKey = (sid: string): string =>
  `${SESSION_KEY_PREFIX}${sid}`;

export const userSessionsKey = (userId: string): string =>
  `${USER_SESSIONS_KEY_PREFIX}${userId}`;
