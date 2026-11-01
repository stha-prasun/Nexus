import { cn } from 'cn';
import { type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { NavLink } from 'react-router';
import type { Org } from '@/lib/dashboard';
import { initials } from '@/lib/dashboard';
import {
  countOpen,
  fetchMyTasks,
  getOpenCount,
  publishOpenCount,
  subscribeOpenCount,
} from '@/lib/myTasks';
import { useAppSelector } from '@/store/hooks';
import { LockIcon, NexusLogo, OrgIcon, ProjectsIcon, TasksIcon } from './Icons';
import { ProfileFooter } from './ProfileFooter';

interface SidebarProps {
  org: Org | null;
  user: { name: string; email: string; roleLabel: string };
  open: boolean;
  onLogout: () => void;
}

/**
 * No organization yet — My tasks is padlocked with the same copy the
 * design's sidebar uses ("Create an organization first").
 */
function LockedNav({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span
      className="flex items-center gap-3 px-3 py-2.5 text-ink-soft/60"
      title="Create an organization first"
    >
      {icon}
      {label}
      <LockIcon className="ml-auto h-3.5 w-3.5" />
    </span>
  );
}

export function Sidebar({ org, user, open, onLogout }: SidebarProps) {
  const authUser = useAppSelector((state) => state.auth.user);
  const projects = useAppSelector((state) => state.projects.projects);
  const projectsStatus = useAppSelector((state) => state.projects.status);
  // Live count while the My-tasks page is open; fetched once otherwise.
  const published = useSyncExternalStore(subscribeOpenCount, getOpenCount);
  // Only counts published for the signed-in user — a re-login as someone
  // else must never show the previous user's badge.
  const liveOpen =
    published && published.userId === authUser?.id ? published.count : null;

  // Real badge everywhere: when nothing has published a count for this user
  // yet, fan out once (same call the My-tasks page makes). A failed fetch
  // just leaves the badge hidden — no fake numbers.
  useEffect(() => {
    if (!org || !authUser || authUser.role === 'HR') return;
    if (liveOpen !== null || projectsStatus !== 'ready') return;
    let cancelled = false;
    void fetchMyTasks(projects, authUser.id)
      .then((rows) => {
        if (!cancelled) publishOpenCount(countOpen(rows), authUser.id);
      })
      .catch(() => {
        // Unknown stays unknown — the badge reappears on the next attempt.
      });
    return () => {
      cancelled = true;
    };
  }, [org, authUser, projects, projectsStatus, liveOpen]);

  const openTasks = org && authUser?.role !== 'HR' ? liveOpen : null;

  return (
    <aside
      id="sidebar"
      className={cn(
        'fixed inset-y-0 left-0 z-30 w-[262px] shrink-0 flex-col border-r border-ink bg-white text-[15px] lg:sticky lg:top-0 lg:flex lg:h-screen',
        open ? 'flex' : 'hidden',
      )}
    >
      <NavLink
        to="/dashboard"
        className="flex h-14 items-center gap-2.5 border-b border-ink-line px-4"
        aria-label="Nexus"
      >
        <NexusLogo className="h-6 w-6" />
        <span className="font-display text-xl font-bold tracking-tight">
          Nexus
        </span>
      </NavLink>

      <div className="p-3">
        <div
          className={cn(
            'flex w-full items-center gap-2.5 px-2.5 py-2 text-sm',
            org ? 'border border-ink' : 'border border-dashed border-ink-soft',
          )}
        >
          {org ? (
            <>
              <span className="flex h-8 w-8 items-center justify-center bg-sun text-xs font-bold text-ink">
                {initials(org.name)}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">
                {org.name}
              </span>
            </>
          ) : (
            <>
              <span className="flex h-7 w-7 items-center justify-center border border-dashed border-ink-soft text-xs text-ink-soft">
                ?
              </span>
              <span className="flex-1 text-ink-soft">No organization</span>
            </>
          )}
        </div>
      </div>

      <p className="px-4 pb-1.5 pt-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">
        Workspace
      </p>
      <nav className="space-y-px px-3" aria-label="Main">
        <NavLink
          to="/dashboard"
          end
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5',
              isActive
                ? 'bg-cobalt font-semibold text-white'
                : 'text-ink-soft hover:bg-paper',
            )
          }
        >
          <OrgIcon />
          Organization
        </NavLink>
        {org ? (
          <NavLink
            to="/dashboard/projects"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5',
                isActive
                  ? 'bg-cobalt font-semibold text-white'
                  : 'text-ink-soft hover:bg-paper',
              )
            }
          >
            <ProjectsIcon />
            Projects
          </NavLink>
        ) : (
          <span
            className="flex items-center gap-3 px-3 py-2.5 text-ink-soft/60"
            title="Create an organization first"
          >
            <ProjectsIcon />
            Projects
            <LockIcon className="ml-auto h-3.5 w-3.5" />
          </span>
        )}
        {org ? (
          <NavLink
            to="/dashboard/tasks"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5',
                isActive
                  ? 'bg-cobalt font-semibold text-white'
                  : 'text-ink-soft hover:bg-paper',
              )
            }
          >
            {({ isActive }) => (
              <>
                <TasksIcon />
                My tasks
                {openTasks !== null && openTasks > 0 ? (
                  <span
                    className={cn(
                      'ml-auto px-1.5 text-xs font-bold',
                      isActive
                        ? 'bg-white text-cobalt'
                        : 'bg-paper text-ink-soft',
                    )}
                  >
                    {openTasks}
                  </span>
                ) : null}
              </>
            )}
          </NavLink>
        ) : (
          <LockedNav icon={<TasksIcon />} label="My tasks" />
        )}
      </nav>

      <div className="mt-auto">
        <ProfileFooter
          name={user.name}
          email={user.email}
          roleLabel={user.roleLabel}
          onLogout={onLogout}
        />
      </div>
    </aside>
  );
}
