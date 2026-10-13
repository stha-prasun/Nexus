const cookieName = process.env.SESSION_COOKIE_NAME ?? 'nexus_sid';
const ttl = Number(process.env.SESSION_TTL_SECONDS ?? 604_800);

export const SESSION_COOKIE_NAME = cookieName;

/** Session TTL (default 7 days). */
export const SESSION_TTL_SECONDS =
  Number.isFinite(ttl) && ttl > 0 ? ttl : 604_800;

export const SESSION_KEY_PREFIX = 'session:';

export const sessionKey = (sid: string): string =>
  `${SESSION_KEY_PREFIX}${sid}`;
