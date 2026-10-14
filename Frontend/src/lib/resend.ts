/**
 * Shared state for the "resend confirmation email" flow.
 *
 * - Pending email: survives a hard refresh of /confirm-sent (router state is
 *   lost on reload) and lets /verify-email resend without re-prompting.
 * - Cooldown deadline: epoch ms until which resending is locked out, so the
 *   5-minute wait survives refreshes and is shared across pages.
 */

const PENDING_EMAIL_KEY = 'nexus:pending-email';
const COOLDOWN_KEY = 'nexus:resend-cooldown-until';

/** Cooldown length: user may resend once every 5 minutes (server caps at 3/10min). */
export const RESEND_COOLDOWN_MS = 5 * 60 * 1_000;

export const setPendingEmail = (email: string): void => {
  sessionStorage.setItem(PENDING_EMAIL_KEY, email);
};

export const getPendingEmail = (): string | null =>
  sessionStorage.getItem(PENDING_EMAIL_KEY);

export const clearPendingEmail = (): void => {
  sessionStorage.removeItem(PENDING_EMAIL_KEY);
  sessionStorage.removeItem(COOLDOWN_KEY);
};

export const startCooldown = (): void => {
  sessionStorage.setItem(COOLDOWN_KEY, String(Date.now() + RESEND_COOLDOWN_MS));
};

/**
 * Milliseconds left on the cooldown, 0 if none is stored or it has elapsed.
 * No stored deadline → 0 (allowed now): a fresh signup always calls
 * startCooldown(), but an old expired link shouldn't force a pointless wait.
 */
export const getCooldownRemaining = (): number => {
  const raw = sessionStorage.getItem(COOLDOWN_KEY);
  if (raw === null) return 0;
  const deadline = Number(raw);
  if (!Number.isFinite(deadline)) return 0;
  return Math.max(0, deadline - Date.now());
};

/** `5:00` / `0:42` / `0:00` — for the disabled countdown button. */
export const formatCountdown = (ms: number): string => {
  const totalSeconds = Math.ceil(ms / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};
