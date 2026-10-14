import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import { ResendConfirmation } from '@/components/auth/ResendConfirmation';
import { getPendingEmail } from '@/lib/resend';

interface ConfirmSentState {
  email?: string;
}

export function ConfirmSentPage() {
  const location = useLocation();
  const state = location.state as ConfirmSentState | null;
  // Router state is lost on refresh — fall back to the value saved at signup.
  const email = state?.email ?? getPendingEmail() ?? undefined;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Check your email · Nexus';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="canvas relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-4 font-sans text-ink antialiased">
      <div className="panel-wrap relative z-10 w-full max-w-[460px]">
        <section
          id="panel"
          className="relative rounded-[0.375rem] bg-white p-6 shadow-[0_24px_60px_-20px_rgba(10,15,80,.6)] sm:px-8 sm:py-7"
          aria-labelledby="title"
        >
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

          <h1
            id="title"
            className="font-display text-[1.75rem] font-bold leading-none tracking-tight"
          >
            Check your email
          </h1>
          <p className="mt-3 text-[15px] text-ink-soft">
            {'A confirmation link is on its way to '}
            <span className="font-semibold text-ink">
              {email ?? 'your inbox'}
            </span>
            {'. It expires in 24 hours.'}
          </p>
          <p className="mt-2 text-[15px] text-ink-soft">
            Open the link on any device to activate your account. Give it a
            minute, and check your spam folder if it hasn&apos;t arrived.
          </p>

          <ResendConfirmation email={email} />

          <p className="mt-6 text-center text-sm text-ink-soft">
            <Link
              to="/"
              className="font-semibold text-cobalt underline-offset-2 hover:underline focus-visible:underline"
            >
              Back to sign in
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
