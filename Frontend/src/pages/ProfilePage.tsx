import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AppShell } from '@/components/dashboard/AppShell';
import { RoleBadge } from '@/components/dashboard/OrgView';
import { useToast } from '@/components/dashboard/Toast';
import {
  listSessions,
  logout,
  revokeSession,
  type SessionSummary,
} from '@/lib/api';
import type { DashboardState, Member, RoleKey } from '@/lib/dashboard';
import {
  CURRENT_USER,
  createDemoState,
  pad2,
  ROLES,
  toRoleKey,
} from '@/lib/dashboard';
import { useAppDispatch, useAppSelector, useOrganization } from '@/store/hooks';
import { setAnonymous } from '@/store/slices/authSlice';
import { clearOrg } from '@/store/slices/orgSlice';

const sessionTime = (date: Date): string =>
  date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** "Today, 9:04 AM" / "Yesterday, 6:30 PM" / "Oct 11, 8:12 PM". */
const signedInLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (date.getTime() >= startOfToday) return `Today, ${time}`;
  if (date.getTime() >= startOfYesterday) return `Yesterday, ${time}`;
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${day}, ${time}`;
};

/** "Active now" / "2 hours ago" / "6 days ago" / date for older. */
const lastActiveLabel = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return 'Active now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return signedInLabel(iso);
};

/** "in ~24h (Wed, Nov 4, 9:04 AM)" — matches the original copy shape. */
const expiresLabel = (iso: string): { relative: string; at: string } => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { relative: 'unknown', at: '' };
  const diffMs = date.getTime() - Date.now();
  const hours = Math.max(1, Math.round(diffMs / (60 * 60 * 1000)));
  return {
    relative: diffMs > 0 ? `in ~${hours}h` : 'expired',
    at: sessionTime(date),
  };
};

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-ink-line px-5 py-3.5 last:border-b-0 sm:grid sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
      <dt className="text-sm font-semibold text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium sm:mt-0">{value}</dd>
    </div>
  );
}

type SessionsStatus = 'loading' | 'ready' | 'error';

export function ProfilePage() {
  const [state] = useState<DashboardState>(createDemoState);
  const { show, element: toastElement } = useToast();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const authUser = useAppSelector((session) => session.auth.user);
  const { org } = useOrganization();

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [sessionsStatus, setSessionsStatus] =
    useState<SessionsStatus>('loading');

  const { members, viewAs } = state;
  const user: Member = members[0] ?? { ...CURRENT_USER };
  const role: RoleKey = authUser ? toRoleKey(authUser.role) : viewAs;

  const displayName = authUser?.name ?? user.name;
  const displayEmail = authUser?.email ?? user.email;

  const currentSession = sessions?.find((session) => session.current) ?? null;

  const fetchSessions = useCallback(() => {
    setSessionsStatus('loading');
    void listSessions()
      .then((response) => {
        setSessions(response.sessions);
        setSessionsStatus('ready');
      })
      .catch(() => {
        // Network/5xx — keep any previously loaded list, flag for retry.
        setSessionsStatus('error');
      });
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  /** This device only — same action as the sidebar Log out. */
  const handleLogout = (): void => {
    void (async () => {
      try {
        await logout();
      } catch {
        // Best-effort server-side invalidation; the cookie still dies at TTL.
      }
      dispatch(clearOrg());
      dispatch(setAnonymous());
      navigate('/', { replace: true });
    })();
  };

  /** Every session for this user; revoked === 0 just means "already out". */
  const handleLogoutEverywhere = (): void => {
    void (async () => {
      try {
        await logout({ allDevices: true });
      } catch {
        // Best-effort; a failed revoke dies at TTL and stays indexed.
      }
      dispatch(clearOrg());
      dispatch(setAnonymous());
      navigate('/', { replace: true });
    })();
  };

  /**
   * One other device: optimistic removal, restore + toast on failure.
   * The current device routes through the full logout flow instead.
   */
  const handleRevokeSession = (session: SessionSummary): void => {
    if (session.current) {
      handleLogout();
      return;
    }
    const previous = sessions;
    setSessions((list) =>
      (list ?? []).filter((entry) => entry.id !== session.id),
    );
    void revokeSession(session.id)
      .then(() => {
        // Refresh so counts/expiry stay honest after the revoke.
        fetchSessions();
      })
      .catch((error: unknown) => {
        setSessions(previous);
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : "Couldn't log out that device. Please try again.";
        show(message);
      });
  };

  useEffect(() => {
    document.title = `${displayName} · Nexus`;
  }, [displayName]);

  const crumb = org ? (
    <>
      <span>{org.name}</span>
      <span className="mx-1.5 text-ink-line">/</span>
      <span className="font-semibold text-ink">Profile</span>
    </>
  ) : (
    <span className="font-semibold text-ink">Profile</span>
  );

  const deviceCount = sessions?.length ?? 0;
  const expires = currentSession
    ? expiresLabel(currentSession.expiresAt)
    : null;

  return (
    <AppShell
      org={org}
      user={{
        name: displayName,
        email: displayEmail,
        roleLabel: ROLES[role].label,
      }}
      crumb={crumb}
      onLogout={handleLogout}
    >
      <div className="view-in">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Profile
        </h1>
        <p className="mt-1 text-ink-soft">
          Your identity, this session and every device you&apos;re signed in on.
        </p>

        <section
          className="dots mt-6 flex flex-wrap items-center gap-5 border-2 border-ink bg-cobalt p-6 text-white"
          aria-labelledby="p-identity"
        >
          <span className="flex h-16 w-16 shrink-0 items-center justify-center bg-sun font-display text-xl font-bold text-ink">
            {displayName
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0] ?? '')
              .join('')
              .toUpperCase()}
          </span>
          <div className="min-w-0">
            <h2
              id="p-identity"
              className="font-display text-2xl font-bold tracking-tight"
            >
              {displayName}
            </h2>
            <p className="truncate text-white/75">{displayEmail}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <RoleBadge role={role} />
              <span className="text-sm text-white/75">
                {org
                  ? `${org.name} · ${ROLES[role].label}`
                  : 'No organization yet'}
              </span>
            </div>
          </div>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
          <section
            className="border border-ink bg-white"
            aria-labelledby="p-session"
          >
            <div className="border-b border-ink bg-paper px-5 py-3">
              <h2
                id="p-session"
                className="text-[11px] font-bold uppercase tracking-wider text-ink-soft"
              >
                Session details
              </h2>
            </div>
            <dl>
              <Detail
                label="Status"
                value={
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <span
                      className="h-2.5 w-2.5 bg-emerald-500"
                      aria-hidden="true"
                    />
                    Active
                  </span>
                }
              />
              <Detail
                label="Signed in"
                value={
                  currentSession ? (
                    sessionTime(new Date(currentSession.signedInAt))
                  ) : (
                    <span className="text-ink-soft">
                      {sessionsStatus === 'loading' ? 'Loading…' : '—'}
                    </span>
                  )
                }
              />
              <Detail
                label="Expires"
                value={
                  expires ? (
                    <span className="text-ink-soft">
                      {expires.relative} ({expires.at})
                    </span>
                  ) : (
                    <span className="text-ink-soft">
                      {sessionsStatus === 'loading' ? 'Loading…' : '—'}
                    </span>
                  )
                }
              />
              <Detail
                label="Device"
                value={
                  currentSession ? (
                    <span>
                      {currentSession.device}
                      <span className="text-ink-soft">
                        {' '}
                        · {currentSession.browser}
                      </span>
                    </span>
                  ) : (
                    <span className="text-ink-soft">
                      {sessionsStatus === 'loading'
                        ? 'Loading…'
                        : 'This device'}
                    </span>
                  )
                }
              />
            </dl>
            <div className="border-t border-ink-line bg-paper px-5 py-3 text-[13px] text-ink-soft">
              Session ID
              <span className="mx-1.5 text-ink-line">·</span>
              <span className="font-mono">
                {currentSession
                  ? `sess_${currentSession.id}`
                  : sessionsStatus === 'loading'
                    ? '…'
                    : '—'}
              </span>
            </div>
          </section>

          <section
            className="h-fit border border-ink bg-white"
            aria-labelledby="p-actions"
          >
            <div className="border-b border-ink bg-paper px-5 py-3">
              <h2
                id="p-actions"
                className="text-[11px] font-bold uppercase tracking-wider text-ink-soft"
              >
                All devices
              </h2>
            </div>
            <div className="p-5">
              <p className="text-sm text-ink-soft">
                You&apos;re signed in on {pad2(deviceCount)} device
                {deviceCount === 1 ? '' : 's'}. End a single device from the
                Active sessions list, or every session below.
              </p>
              <button
                type="button"
                onClick={handleLogoutEverywhere}
                className="mt-4 w-full border border-red-600 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-600 hover:text-white"
              >
                Log out everywhere
              </button>
              <p className="mt-2 text-[13px] text-ink-soft">
                This signs you out of Nexus on all devices.
              </p>
            </div>
          </section>
        </div>

        <section
          className="mt-6 border border-ink bg-white"
          aria-labelledby="p-active"
        >
          <div className="flex items-center justify-between border-b border-ink bg-paper px-5 py-3">
            <h2
              id="p-active"
              className="text-[11px] font-bold uppercase tracking-wider text-ink-soft"
            >
              Active sessions
            </h2>
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">
              {sessionsStatus === 'ready'
                ? `${pad2(deviceCount)} device${deviceCount === 1 ? '' : 's'}`
                : '…'}
            </span>
          </div>
          {sessionsStatus === 'loading' && sessions === null ? (
            <ul aria-busy="true">
              {[0, 1].map((row) => (
                <li
                  key={row}
                  className="flex items-center gap-5 border-b border-ink-line px-5 py-4 last:border-b-0"
                >
                  <span className="h-2.5 w-2.5 shrink-0 bg-ink-soft/20" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-40 bg-ink-soft/10" />
                    <div className="h-3 w-56 bg-ink-soft/10" />
                  </div>
                </li>
              ))}
            </ul>
          ) : sessionsStatus === 'error' && sessions === null ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-ink-soft">
                Couldn&apos;t load your sessions. Check your connection and try
                again.
              </p>
              <button
                type="button"
                onClick={fetchSessions}
                className="mt-3 border border-ink px-4 py-2 text-sm font-semibold hover:bg-ink hover:text-white"
              >
                Retry
              </button>
            </div>
          ) : (
            <ul>
              {(sessions ?? []).map((session) => (
                <li
                  key={session.id}
                  className={`flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-ink-line px-5 py-4 last:border-b-0 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1.1fr)_auto] ${
                    session.current ? 'bg-cobalt/5' : ''
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 shrink-0 ${
                        session.online ? 'bg-emerald-500' : 'bg-ink-soft/40'
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        {session.device}
                        {session.current ? (
                          <span className="bg-cobalt px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                            This device
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-sm text-ink-soft">
                        {session.browser}
                      </p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm">{session.ip}</p>
                    <p className="truncate text-[13px] text-ink-soft">
                      Signed in {signedInLabel(session.signedInAt)}
                    </p>
                  </div>
                  <div className="text-sm sm:text-right">
                    <span className="block text-xs font-bold uppercase tracking-wider text-ink-soft sm:hidden">
                      Last active
                    </span>
                    <span
                      className={
                        session.online
                          ? 'font-semibold text-emerald-700'
                          : 'text-ink-soft'
                      }
                    >
                      {session.current
                        ? 'Active now'
                        : lastActiveLabel(session.lastActiveAt)}
                    </span>
                  </div>
                  <div className="ml-auto sm:ml-0 sm:text-right">
                    <button
                      type="button"
                      onClick={() => handleRevokeSession(session)}
                      className="text-sm text-red-700 underline-offset-2 hover:underline"
                    >
                      Log out
                    </button>
                  </div>
                </li>
              ))}
              {(sessions ?? []).length === 0 ? (
                <li className="px-5 py-8 text-center text-sm text-ink-soft">
                  No active sessions found.
                </li>
              ) : null}
            </ul>
          )}
        </section>
      </div>
      {toastElement}
    </AppShell>
  );
}
