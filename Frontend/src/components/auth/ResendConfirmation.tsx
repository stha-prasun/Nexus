import { useEffect, useState } from 'react';
import { ApiError, resendConfirmation } from '@/lib/api';
import {
  formatCountdown,
  getCooldownRemaining,
  startCooldown,
} from '@/lib/resend';

interface ResendConfirmationProps {
  /** Address the confirmation was sent to. Component hides itself if absent. */
  email?: string | null;
}

type Status = 'idle' | 'sending' | 'sent';

const BUTTON =
  'mt-4 block w-full rounded border border-ink-line bg-white px-4 py-2.5 text-center font-display text-base font-bold tracking-tight text-ink transition hover:bg-mist focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-cobalt/40 active:translate-y-px disabled:cursor-not-allowed disabled:text-ink-soft disabled:opacity-60';

/**
 * "Didn't get it?" block: a resend button that stays disabled while the
 * 5-minute cooldown runs (survives refresh via sessionStorage), then calls
 * POST /auth/resend-confirmation and restarts the cooldown.
 */
export function ResendConfirmation({ email }: ResendConfirmationProps) {
  const [remaining, setRemaining] = useState(() => getCooldownRemaining());
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  // Tick the countdown while it is running.
  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => {
      setRemaining(getCooldownRemaining());
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  if (!email) return null;

  const cooldownOver = remaining <= 0;
  const sending = status === 'sending';

  const handleResend = async () => {
    setStatus('sending');
    setError('');
    try {
      await resendConfirmation(email);
      startCooldown();
      setRemaining(getCooldownRemaining());
      setStatus('sent');
    } catch (err) {
      setStatus('idle');
      if (err instanceof ApiError && err.status === 429) {
        setError(
          'Too many attempts — please wait a few minutes and try again.',
        );
        // Stay locked out for the cooldown so the user isn't hammered by 429s.
        startCooldown();
        setRemaining(getCooldownRemaining());
      } else if (err instanceof ApiError) {
        setError(err.messages[0]);
      } else {
        setError('Something went wrong. Please try again.');
      }
    }
  };

  return (
    <div className="mt-5 border-t border-ink-line pt-4">
      <p className="text-center text-sm text-ink-soft">
        Haven&apos;t received it? Give it a minute, then check your spam folder.
      </p>

      <button
        type="button"
        onClick={handleResend}
        disabled={!cooldownOver || sending}
        className={BUTTON}
      >
        {sending
          ? 'Sending…'
          : cooldownOver
            ? 'Resend confirmation email'
            : `Resend in ${formatCountdown(remaining)}`}
      </button>

      <div
        role={error ? 'alert' : 'status'}
        className={`mt-3 rounded border-l-4 px-3 py-2.5 text-sm${
          error
            ? ' border-red-500 bg-red-50 text-red-800'
            : status === 'sent'
              ? ' border-emerald-500 bg-emerald-50 text-emerald-800'
              : ' hidden'
        }`}
      >
        {error ||
          `If an unverified account exists for ${email}, a new confirmation link is on its way.`}
      </div>
    </div>
  );
}
