import { type CSSProperties, useState } from 'react';
import { pad2 } from '@/lib/dashboard';
import { MailIcon } from './Icons';

interface NoOrgViewProps {
  /** The signed-in user's email — shared with the Admin so they can be added. */
  email: string;
  /** Refetches the organization; resolves to the (possibly still null) result. */
  onCheckAgain: () => Promise<unknown>;
  onSignOut: () => void;
  /** Dashboard-owned toast (copy feedback, check-again result). */
  onToast: (message: string) => void;
}

/** Staggered entrance index for the design's `.rise` animation. */
const rise = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;

function Step({
  n,
  title,
  text,
  active,
  index,
}: {
  n: number;
  title: string;
  text: string;
  active: boolean;
  index: number;
}) {
  return (
    <li
      className="rise flex gap-4 border-b border-white/30 py-4"
      style={rise(index)}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center text-sm font-bold ${
          active ? 'bg-sun text-ink' : 'border border-white/60'
        }`}
      >
        {pad2(n)}
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-sm text-white/75">{text}</p>
      </div>
    </li>
  );
}

/**
 * Non-Admin empty state: the account exists but isn't in an organization
 * yet. Explains that an Admin creates the org and adds them, and offers a
 * copyable email + a "Check again" refetch. No create form and no extra
 * API call on mount.
 */
export function NoOrgView({
  email,
  onCheckAgain,
  onSignOut,
  onToast,
}: NoOrgViewProps) {
  const [checking, setChecking] = useState(false);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(email);
      onToast('Email copied');
    } catch {
      onToast(email);
    }
  };

  const handleCheckAgain = async (): Promise<void> => {
    if (checking) return;
    setChecking(true);
    try {
      await onCheckAgain();
    } finally {
      setChecking(false);
    }
  };

  return (
    <section
      className="dots relative overflow-hidden bg-cobalt px-5 py-10 text-white sm:px-10 sm:py-14"
      aria-labelledby="no-org-title"
    >
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-14">
        {/* Left: what is going on and what happens next */}
        <div>
          <p
            className="rise text-xs font-bold uppercase tracking-wider text-sun"
            style={rise(0)}
          >
            Waiting for access
          </p>
          <h1
            id="no-org-title"
            className="rise mt-3 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl"
            style={rise(1)}
          >
            You&apos;re not in an organization yet
          </h1>
          <p className="rise mt-4 max-w-md text-white/80" style={rise(2)}>
            Your account is ready, but it isn&apos;t linked to an organization.
            An Admin creates the organization and adds you to it. After that, it
            shows up here.
          </p>
          <ol className="mt-8 max-w-md border-t border-white/30">
            <Step
              n={1}
              title="Admin creates the organization"
              text="Organizations are set up by an Admin. There's nothing for you to do yet."
              active
              index={3}
            />
            <Step
              n={2}
              title="They add you with your email"
              text="Send them the email address shown on this page."
              active={false}
              index={4}
            />
            <Step
              n={3}
              title="You get access"
              text="The organization appears here, along with your role and your projects."
              active={false}
              index={5}
            />
          </ol>
        </div>

        {/* Right: share your email, check again, sign out */}
        <div
          className="rise border-2 border-ink bg-white p-7 text-ink shadow-[8px_8px_0_#FFD83D] sm:p-8"
          style={rise(3)}
        >
          <span className="flex h-12 w-12 items-center justify-center bg-paper text-ink-soft">
            <MailIcon />
          </span>
          <h2 className="mt-5 font-display text-2xl font-bold tracking-tight">
            Ask an Admin to add you
          </h2>
          <p className="mt-1.5 text-sm text-ink-soft">
            You can&apos;t create an organization yourself. Only an Admin can.
          </p>

          <p className="mt-6 text-sm font-semibold">
            Share this email with them
          </p>
          <div className="mt-1.5 flex border border-ink/40">
            <span className="min-w-0 flex-1 truncate bg-paper px-3.5 py-2.5 text-[15px]">
              {email}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="border-l border-ink/40 px-4 text-sm font-semibold hover:bg-ink hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt"
            >
              Copy
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleCheckAgain()}
            disabled={checking}
            className="mt-4 w-full bg-cobalt px-4 py-3 font-display text-base font-bold tracking-tight text-white hover:bg-cobalt-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cobalt focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {checking ? 'Checking…' : 'Check again'}
          </button>

          <p className="mt-5 border-t border-ink-line pt-4 text-sm text-ink-soft">
            Already got an invite? Open the link in your email and you&apos;ll
            be added automatically.
          </p>
          <p className="mt-2 text-sm text-ink-soft">
            Signed in as <strong className="text-ink">{email}</strong>.{' '}
            <button
              type="button"
              onClick={onSignOut}
              className="font-semibold text-cobalt underline-offset-2 hover:underline"
            >
              Not you? Sign out
            </button>
          </p>
        </div>
      </div>
    </section>
  );
}
