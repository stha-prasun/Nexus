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

/**
 * Minimum gap between lastActiveAt rewrites for one session. The guard
 * updates activity at most once per interval so a chatty client cannot turn
 * every authenticated request into a Redis write.
 */
export const LAST_ACTIVE_WRITE_INTERVAL_MS = 60_000;

/** A session counts as online in the device list within this window. */
export const SESSION_ONLINE_WINDOW_MS = 5 * 60_000;
