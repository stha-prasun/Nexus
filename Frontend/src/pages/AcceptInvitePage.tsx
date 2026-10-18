import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ResendConfirmation } from '@/components/auth/ResendConfirmation';
import { cssVars, TaskGraph } from '@/components/auth/TaskGraph';
import {
  ApiError,
  acceptInvite,
  getInvitePreview,
  type InvitePreview,
  logout,
  me,
} from '@/lib/api';
import { ROLES, toRoleKey } from '@/lib/dashboard';
import { setInviteReturn } from '@/lib/invite';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setAnonymous, setUser } from '@/store/slices/authSlice';
import { clearMembers } from '@/store/slices/membersSlice';
import { clearOrg } from '@/store/slices/orgSlice';

type Status =
  | 'loading'
  | 'network'
  | 'invalid'
  | 'signin'
  | 'signup'
  | 'unverified'
  | 'mismatch'
  | 'ready'
  | 'joining'
  | 'joined';

const TITLES: Record<Status, string> = {
  loading: 'Checking your invitation · Nexus',
  network: 'Cannot reach server · Nexus',
  invalid: 'Invitation invalid or expired · Nexus',
  signin: 'Sign in to accept · Nexus',
  signup: 'Create your account · Nexus',
  unverified: 'Verify your email · Nexus',
  mismatch: 'Wrong account · Nexus',
  ready: 'Join organization · Nexus',
  joining: 'Joining… · Nexus',
  joined: 'Welcome aboard · Nexus',
};

const SUN_BUTTON =
  'mt-6 block w-full rounded bg-sun px-4 py-2.5 text-center font-display text-base font-bold tracking-tight text-ink transition hover:bg-sun-dark focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-cobalt/40 active:translate-y-px disabled:opacity-60';

const LINE_BUTTON =
  'mt-3 block w-full rounded border border-ink-line bg-white px-4 py-2.5 text-center font-display text-base font-bold tracking-tight text-ink transition hover:bg-mist focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-cobalt/40 active:translate-y-px';

/** Invitation summary — the email/org/role the token stands for. */
function InviteCard({ preview }: { preview: InvitePreview }) {
  return (
    <dl className="mt-5 border border-ink-line">
      <div className="flex items-center justify-between gap-3 border-b border-ink-line px-3.5 py-2.5">
        <dt className="text-xs font-bold uppercase tracking-wider text-ink-soft">
          Organization
        </dt>
        <dd className="truncate text-sm font-semibold">{preview.orgName}</dd>
      </div>
      <div className="flex items-center justify-between gap-3 border-b border-ink-line px-3.5 py-2.5">
        <dt className="text-xs font-bold uppercase tracking-wider text-ink-soft">
          Role
        </dt>
        <dd>
          <span
            className={`inline-block px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${ROLES[toRoleKey(preview.role)].cls}`}
          >
            {ROLES[toRoleKey(preview.role)].label}
          </span>
        </dd>
      </div>
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <dt className="text-xs font-bold uppercase tracking-wider text-ink-soft">
          Invited
        </dt>
        <dd className="truncate text-sm font-semibold">{preview.email}</dd>
      </div>
    </dl>
  );
}

/**
 * The landing page for every invite link (`/accept-invite?token=…`). The
 * public preview tells us what the token stands for; the session decides
 * what we can do with it:
 * - anonymous → sign in / sign up as the invited email, then return here;
 * - wrong account → sign out and use the invited address;
 * - unverified → resend the confirmation mail first;
 * - verified match → accept (invitedRole → users.role server-side).
 */
export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const authStatus = useAppSelector((state) => state.auth.status);
  const authUser = useAppSelector((state) => state.auth.user);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [failed, setFailed] = useState<'network' | 'invalid' | null>(null);
  const [joinError, setJoinError] = useState('');
  /** Accept flow progress — overrides the computed state while running. */
  const [phase, setPhase] = useState<'idle' | 'joining' | 'joined'>('idle');
  const startedRef = useRef(false);

  useEffect(() => {
    // StrictMode double-effect guard: one preview GET per mount.
    if (startedRef.current) return;
    startedRef.current = true;
    if (!token) {
      setFailed('invalid');
      return;
    }
    void (async () => {
      try {
        setPreview(await getInvitePreview(token));
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) {
          setFailed('network');
        } else {
          setFailed('invalid');
        }
      }
    })();
  }, [token]);

  // Remember where to come back to while we bounce through auth.
  useEffect(() => {
    if (!preview || authStatus !== 'anonymous') return;
    setInviteReturn(`/accept-invite?token=${encodeURIComponent(token)}`);
  }, [preview, authStatus, token]);

  // Compute the actionable state fresh each render — auth can settle after
  // the preview arrives (session restore races the GET).
  let status: Status = 'loading';
  if (phase === 'joining') status = 'joining';
  else if (phase === 'joined') status = 'joined';
  else if (failed) status = failed;
  else if (preview) {
    if (authStatus === 'unknown' || authStatus === 'loading')
      status = 'loading';
    else if (authStatus === 'anonymous')
      status = preview.accountState === 'none' ? 'signup' : 'signin';
    else if (
      !authUser ||
      authUser.email.toLowerCase() !== preview.email.toLowerCase()
    )
      status = 'mismatch';
    else if (preview.accountState === 'unverified') status = 'unverified';
    else status = 'ready';
  }

  useEffect(() => {
    const previousTitle = document.title;
    document.title = TITLES[status];
    return () => {
      document.title = previousTitle;
    };
  }, [status]);

  const handleAccept = async (): Promise<void> => {
    setJoinError('');
    setPhase('joining');
    try {
      await acceptInvite(token);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'already_member') {
        // Accepted in another tab — same destination.
        await finishJoin();
        return;
      }
      setPhase('idle');
      setJoinError(
        error instanceof ApiError
          ? error.messages.join(' ')
          : 'Something went wrong. Please try again.',
      );
      return;
    }
    await finishJoin();
  };

  const finishJoin = async (): Promise<void> => {
    // The session cookie now carries the new role server-side — re-read it
    // so the dashboard's role gating is fresh without a hard reload.
    const result = await me();
    if (result.kind === 'ok') dispatch(setUser(result.user));
    // The cached org/members pre-date this membership — refetch from scratch.
    dispatch(clearOrg());
    dispatch(clearMembers());
    setPhase('joined');
  };

  const handleSignOutForInvite = async (): Promise<void> => {
    try {
      await logout();
    } catch {
      // Best-effort — the cookie still dies at TTL.
    }
    setInviteReturn(`/accept-invite?token=${encodeURIComponent(token)}`);
    dispatch(clearMembers());
    dispatch(clearOrg());
    dispatch(setAnonymous());
    navigate('/', { replace: true });
  };

  return (
    <main className="canvas relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-4 font-sans text-ink antialiased">
      <TaskGraph active={false} />

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

          {status === 'loading' && (
            <>
              <h1
                id="title"
                className="font-display text-[1.75rem] font-bold leading-none tracking-tight"
              >
                Checking your invitation
              </h1>
              <div className="mt-6 flex justify-center py-6">
                <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-line border-t-cobalt" />
              </div>
            </>
          )}

          {status === 'invalid' && (
            <>
              <h1
                id="title"
                className="font-display text-[1.75rem] font-bold leading-none tracking-tight"
              >
                This invitation doesn&apos;t work
              </h1>
              <p className="mt-2.5 text-[15px] text-ink-soft">
                The link is invalid, already used, or older than 7 days. Ask an
                Admin or HR teammate to resend it from the People list.
              </p>
              <Link to="/" className={SUN_BUTTON}>
                Back to sign in
              </Link>
            </>
          )}

          {status === 'network' && (
            <>
              <h1
                id="title"
                className="font-display text-[1.75rem] font-bold leading-none tracking-tight"
              >
                Can&apos;t reach the server
              </h1>
              <p className="mt-2.5 text-[15px] text-ink-soft">
                We couldn&apos;t check this invitation. Check your connection
                and try again.
              </p>
              <button
                type="button"
                className={SUN_BUTTON}
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            </>
          )}

          {(status === 'signin' || status === 'signup') && preview && (
            <>
              <h1
                id="title"
                className="font-display text-[1.75rem] font-bold leading-none tracking-tight"
              >
                {status === 'signup'
                  ? 'Create your account to join'
                  : 'Sign in to accept'}
              </h1>
              <p className="mt-2.5 text-[15px] text-ink-soft">
                {status === 'signup'
                  ? `An invitation to ${preview.orgName} is waiting for ${preview.email}. Create an account with that address — or sign in if you already have one — and you'll come right back here.`
                  : `You're almost in. Sign in as ${preview.email} to accept your invitation to ${preview.orgName}.`}
              </p>
              <InviteCard preview={preview} />
              {status === 'signup' ? (
                <Link to="/signup" className={SUN_BUTTON}>
                  Create account
                </Link>
              ) : (
                <Link to="/" className={SUN_BUTTON}>
                  Sign in
                </Link>
              )}
              <p className="mt-5 text-center text-sm text-ink-soft">
                Invited with a different email?{' '}
                <Link
                  to="/"
                  className="font-semibold text-cobalt underline-offset-2 hover:underline focus-visible:underline"
                >
                  {status === 'signup'
                    ? 'Sign in instead'
                    : 'Create an account'}
                </Link>
              </p>
            </>
          )}

          {status === 'unverified' && preview && (
            <>
              <h1
                id="title"
                className="font-display text-[1.75rem] font-bold leading-none tracking-tight"
              >
                Confirm your email first
              </h1>
              <p className="mt-2.5 text-[15px] text-ink-soft">
                {preview.email} hasn&apos;t confirmed its email address yet.
                Check your inbox for the confirmation mail — then come back here
                to accept the invitation.
              </p>
              <InviteCard preview={preview} />
              <ResendConfirmation email={preview.email} />
            </>
          )}

          {status === 'mismatch' && preview && (
            <>
              <h1
                id="title"
                className="font-display text-[1.75rem] font-bold leading-none tracking-tight"
              >
                Wrong account
              </h1>
              <p className="mt-2.5 text-[15px] text-ink-soft">
                This invitation was sent to{' '}
                <strong className="text-ink">{preview.email}</strong>, but
                you&apos;re signed in as{' '}
                <strong className="text-ink">{authUser?.email}</strong>. Sign
                out and sign in with the invited address.
              </p>
              <InviteCard preview={preview} />
              <button
                type="button"
                onClick={() => void handleSignOutForInvite()}
                className={SUN_BUTTON}
              >
                Sign out and switch account
              </button>
            </>
          )}

          {status === 'ready' && preview && (
            <>
              <h1
                id="title"
                className="font-display text-[1.75rem] font-bold leading-none tracking-tight"
              >
                Join {preview.orgName}
              </h1>
              <p className="mt-2.5 text-[15px] text-ink-soft">
                Accepting adds you as{' '}
                <strong className="text-ink">
                  {ROLES[toRoleKey(preview.role)].label}
                </strong>
                . You can start working with the team right away.
              </p>
              <InviteCard preview={preview} />
              {joinError ? (
                <p
                  role="alert"
                  className="mt-4 rounded border-l-4 border-red-500 bg-red-50 px-3 py-2.5 text-sm text-red-800"
                >
                  {joinError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => void handleAccept()}
                className={SUN_BUTTON}
              >
                Accept invitation
              </button>
              <Link to="/dashboard" className={LINE_BUTTON}>
                Maybe later
              </Link>
            </>
          )}

          {(status === 'joining' || status === 'joined') && (
            <>
              <h1
                id="title"
                className="font-display text-[1.75rem] font-bold leading-none tracking-tight"
              >
                {status === 'joining' ? 'Joining…' : 'You&apos;re in!'}
              </h1>
              <p
                role="status"
                className="mt-2.5 text-center text-[15px] text-ink-soft"
              >
                {status === 'joining'
                  ? 'Hang tight — adding you to the organization.'
                  : 'Welcome aboard. Your organization is ready.'}
              </p>
              <div className="mt-6 flex justify-center py-4">
                <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-line border-t-cobalt" />
              </div>
              {status === 'joined' ? (
                <button
                  type="button"
                  onClick={() => navigate('/dashboard', { replace: true })}
                  className={SUN_BUTTON}
                >
                  Go to dashboard
                </button>
              ) : null}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
