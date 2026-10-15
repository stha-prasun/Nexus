import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useRetrySession } from '@/components/auth/SessionGate';
import { useAppSelector } from '@/store/hooks';

function Spinner() {
  return (
    <div
      role="status"
      aria-label="Checking your session"
      className="flex min-h-[100dvh] items-center justify-center font-sans"
    >
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-line border-t-cobalt" />
    </div>
  );
}

/**
 * Route guard for authenticated pages. The status comes from /me (server
 * truth), never from a persisted Redux claim — and an unreachable server
 * never bounces a possibly-logged-in user to the login page.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAppSelector((state) => state.auth.status);
  const bootstrapError = useAppSelector((state) => state.auth.bootstrapError);
  const retry = useRetrySession();

  if (status === 'authenticated') return <>{children}</>;
  // The login page is the index route — there is no separate /login path.
  if (status === 'anonymous') return <Navigate to="/" replace />;

  if (bootstrapError) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-4 font-sans text-ink">
        <p className="text-[15px] font-semibold">
          Can&apos;t reach the server.
        </p>
        <p className="max-w-sm text-center text-sm text-ink-soft">
          We couldn&apos;t confirm your session. This is usually temporary —
          your sign-in is still intact.
        </p>
        <button
          type="button"
          onClick={retry}
          className="rounded bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-cobalt/40"
        >
          Retry
        </button>
      </main>
    );
  }

  return <Spinner />;
}
