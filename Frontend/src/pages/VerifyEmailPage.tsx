import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { cssVars, TaskGraph } from '@/components/auth/TaskGraph';
import { ApiError, verifyEmail } from '@/lib/api';

type Status = 'verifying' | 'verified' | 'invalid' | 'network';

/** A successful verify is remembered per token so a refresh doesn't flip to "expired". */
const STORAGE_PREFIX = 'nexus:verified:';

const TITLES: Record<Status, string> = {
  verifying: 'Confirming your email · Nexus',
  verified: 'Email verified · Nexus',
  invalid: 'Link invalid or expired · Nexus',
  network: 'Cannot reach server · Nexus',
};

const HEADINGS: Record<Status, string> = {
  verifying: 'Confirming your email',
  verified: 'Email verified',
  invalid: 'Link expired or invalid',
  network: "Can't reach the server",
};

const MESSAGES: Record<Status, string> = {
  verifying: 'Hang tight — we’re checking your confirmation link.',
  verified: 'Your email address is confirmed. Your Nexus account is ready.',
  invalid:
    'This confirmation link has already been used, or it’s older than 24 hours. Sign up again to get a fresh one.',
  network: 'We couldn’t contact Nexus. Check your connection and try again.',
};

const SUN_BUTTON =
  'mt-6 block w-full rounded bg-sun px-4 py-2.5 text-center font-display text-base font-bold tracking-tight text-ink transition hover:bg-sun-dark focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-cobalt/40 active:translate-y-px';

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [status, setStatus] = useState<Status>('verifying');
  const startedRef = useRef(false);

  const run = useCallback(async () => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    try {
      const result = await verifyEmail(token);
      if (result.status === 'verified') {
        sessionStorage.setItem(STORAGE_PREFIX + token, '1');
        setStatus('verified');
      } else {
        setStatus('invalid');
      }
    } catch (error) {
      setStatus(
        error instanceof ApiError && error.status === 0 ? 'network' : 'invalid',
      );
    }
  }, [token]);

  useEffect(() => {
    // Guard: StrictMode's double effect would consume the token twice and
    // the second call would spuriously report "invalid".
    if (startedRef.current) return;
    startedRef.current = true;
    if (token && sessionStorage.getItem(STORAGE_PREFIX + token)) {
      setStatus('verified');
      return;
    }
    void run();
  }, [token, run]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = TITLES[status];
    return () => {
      document.title = previousTitle;
    };
  }, [status]);

  const retry = () => {
    setStatus('verifying');
    void run();
  };

  return (
    <main
      className={`canvas relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-4 font-sans text-ink antialiased${
        status === 'verified' ? ' verified' : ''
      }`}
    >
      {/* ===== Task graph (decorative, desktop only) ===== */}
      <TaskGraph active={false} />

      {/* ===== Panel: the "nexus" every task connects to ===== */}
      <div className="panel-wrap relative z-10 w-full max-w-[460px]">
        <span className="ring" aria-hidden="true" />
        <span
          className="ring"
          style={cssVars({ '--d': '4.1s' })}
          aria-hidden="true"
        />
        <section
          id="panel"
          className="relative rounded-[0.375rem] bg-white p-6 shadow-[0_24px_60px_-20px_rgba(10,15,80,.6)] sm:px-8 sm:py-7"
          aria-labelledby="title"
        >
          {/* Logo: three connected nodes */}
          <div className="mb-5 flex items-center gap-2.5">
            <svg
              className="h-7 w-7"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 8.500v3.500M12 12l-5.500 4M12 12l5.500 4"
                stroke="#1F2FE0"
                strokeWidth="1.800"
                strokeLinecap="round"
              />
              <circle
                cx="12"
                cy="6"
                r="3.500"
                fill="#FFD83D"
                stroke="#1F2FE0"
                strokeWidth="1.800"
              />
              <circle cx="5.500" cy="17.500" r="2.500" fill="#1F2FE0" />
              <circle cx="18.500" cy="17.500" r="2.500" fill="#1F2FE0" />
            </svg>
            <span className="font-display text-xl font-bold tracking-tight">
              Nexus
            </span>
          </div>

          {/* Status icon */}
          <div className="mt-2 flex justify-center">
            {status === 'verifying' && (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-mist">
                <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-ink-line border-t-cobalt [animation-duration:.9s]" />
              </span>
            )}
            {status === 'verified' && (
              <svg
                className="h-16 w-16 overflow-visible"
                viewBox="0 0 64 64"
                aria-hidden="true"
              >
                <circle
                  className="v-ripple"
                  cx="32"
                  cy="32"
                  r="28"
                  fill="none"
                  stroke="#1F2FE0"
                  strokeWidth="2"
                />
                <circle
                  className="v-disc"
                  cx="32"
                  cy="32"
                  r="28"
                  fill="#FFD83D"
                />
                <path
                  className="v-check"
                  pathLength="1"
                  d="M20 33l8 8 16-17"
                  fill="none"
                  stroke="#14183A"
                  strokeWidth="4.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {status === 'invalid' && (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-mist">
                <svg
                  className="h-8 w-8"
                  viewBox="0 0 32 32"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M10 10l12 12M22 10L10 22"
                    stroke="#5A6080"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            )}
            {status === 'network' && (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-mist">
                <svg
                  className="h-8 w-8"
                  viewBox="0 0 32 32"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M6.5 13.5a14 14 0 0 1 8-3.6M25.5 13.5a14 14 0 0 0-5.2-3.1M10 18.5a8.5 8.5 0 0 1 3.4-2M22 18.5a8.5 8.5 0 0 0-2-1.6M16 25.5h.01"
                    stroke="#5A6080"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                  />
                  <path
                    d="M6 6l20 20"
                    stroke="#14183A"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            )}
          </div>

          <h1
            id="title"
            className="mt-5 text-center font-display text-[1.75rem] font-bold leading-none tracking-tight"
          >
            {HEADINGS[status]}
          </h1>
          <p
            role="status"
            className="mt-2.5 text-center text-[15px] text-ink-soft"
          >
            {MESSAGES[status]}
          </p>

          {status === 'verified' && (
            <Link to="/" className={SUN_BUTTON}>
              Continue to sign in
            </Link>
          )}
          {status === 'invalid' && (
            <Link to="/signup" className={SUN_BUTTON}>
              Start over
            </Link>
          )}
          {status === 'network' && (
            <button type="button" onClick={retry} className={SUN_BUTTON}>
              Try again
            </button>
          )}

          {status !== 'verifying' && (
            <p className="mt-5 text-center text-sm text-ink-soft">
              {status === 'verified' ? 'Wrong email? ' : 'Already confirmed? '}
              <Link
                to={status === 'verified' ? '/signup' : '/'}
                className="font-semibold text-cobalt underline-offset-2 hover:underline focus-visible:underline"
              >
                {status === 'verified' ? 'Start over' : 'Back to sign in'}
              </Link>
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
