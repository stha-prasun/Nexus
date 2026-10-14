import { useEffect, useState } from 'react';
import { AppShell } from '@/components/dashboard/AppShell';
import { RoleBadge } from '@/components/dashboard/OrgView';
import { useToast } from '@/components/dashboard/Toast';
import type { DashboardState, Member, RoleKey } from '@/lib/dashboard';
import {
  CURRENT_USER,
  createDemoState,
  LOGOUT_ALL_STUB_TOAST,
  LOGOUT_STUB_TOAST,
  pad2,
  ROLES,
  SESSION_LOGOUT_STUB_TOAST,
  SESSIONS,
} from '@/lib/dashboard';

const signInTime = new Date();
const sessionTime = (date: Date): string =>
  date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-ink-line px-5 py-3.5 last:border-b-0 sm:grid sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center">
      <dt className="text-sm font-semibold text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium sm:mt-0">{value}</dd>
    </div>
  );
}

export function ProfilePage() {
  const [state] = useState<DashboardState>(createDemoState);
  const { show, element: toastElement } = useToast();

  const { org, members, viewAs } = state;
  const user: Member = members[0] ?? { ...CURRENT_USER };
  const role: RoleKey = viewAs;

  useEffect(() => {
    document.title = `${user.name} · Nexus`;
  }, [user.name]);

  const crumb = org ? (
    <>
      <span>{org.name}</span>
      <span className="mx-1.5 text-ink-line">/</span>
      <span className="font-semibold text-ink">Profile</span>
    </>
  ) : (
    <span className="font-semibold text-ink">Profile</span>
  );

  return (
    <AppShell
      org={org}
      user={{
        name: user.name,
        email: user.email,
        roleLabel: org ? ROLES[role].label : 'No role yet',
      }}
      crumb={crumb}
      onLogout={() => show(LOGOUT_STUB_TOAST)}
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
            {user.name
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
              {user.name}
            </h2>
            <p className="truncate text-white/75">{user.email}</p>
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
              <Detail label="Signed in" value={sessionTime(signInTime)} />
              <Detail
                label="Expires"
                value={
                  <span className="text-ink-soft">
                    in ~24h (
                    {sessionTime(
                      new Date(signInTime.getTime() + 24 * 60 * 60 * 1000),
                    )}
                    )
                  </span>
                }
              />
              <Detail label="Device" value="This device" />
            </dl>
            <div className="border-t border-ink-line bg-paper px-5 py-3 text-[13px] text-ink-soft">
              Session ID
              <span className="mx-1.5 text-ink-line">·</span>
              <span className="font-mono">sess_8f3a2b9c41d0</span>
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
                You&apos;re signed in on {pad2(SESSIONS.length)} devices. End a
                single device from the Active sessions list, or every session
                below.
              </p>
              <button
                type="button"
                onClick={() => show(LOGOUT_ALL_STUB_TOAST)}
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
              {pad2(SESSIONS.length)} devices
            </span>
          </div>
          <ul>
            {SESSIONS.map((session) => (
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
                  <p className="truncate text-sm">{session.location}</p>
                  <p className="truncate text-[13px] text-ink-soft">
                    Signed in {session.signedInAt}
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
                    {session.lastActive}
                  </span>
                </div>
                <div className="ml-auto sm:ml-0 sm:text-right">
                  <button
                    type="button"
                    onClick={() => show(SESSION_LOGOUT_STUB_TOAST)}
                    className="text-sm text-red-700 underline-offset-2 hover:underline"
                  >
                    Log out
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {toastElement}
    </AppShell>
  );
}
