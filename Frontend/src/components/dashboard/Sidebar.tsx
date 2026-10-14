import { cn } from 'cn';
import { NavLink } from 'react-router';
import type { Org } from '@/lib/dashboard';
import { initials } from '@/lib/dashboard';
import { NexusLogo, OrgIcon, ProjectsIcon, TasksIcon } from './Icons';
import { ProfileFooter } from './ProfileFooter';

interface SidebarProps {
  org: Org | null;
  user: { name: string; email: string; roleLabel: string };
  open: boolean;
  onLogout: () => void;
}

export function Sidebar({ org, user, open, onLogout }: SidebarProps) {
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

      <div className="border-b border-ink-line p-3">
        <div className="flex w-full items-center gap-2.5 border border-ink px-2.5 py-2 text-left">
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
              <span className="flex h-8 w-8 items-center justify-center border border-dashed border-ink-soft text-xs text-ink-soft">
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
        <span
          className="flex items-center gap-3 px-3 py-2.5 text-ink-soft"
          title="Coming soon"
        >
          <ProjectsIcon />
          Projects
          <span className="ml-auto border border-ink-line px-1.5 text-[10px] font-bold uppercase tracking-wider">
            Soon
          </span>
        </span>
        <span
          className="flex items-center gap-3 px-3 py-2.5 text-ink-soft"
          title="Coming soon"
        >
          <TasksIcon />
          My tasks
          <span className="ml-auto border border-ink-line px-1.5 text-[10px] font-bold uppercase tracking-wider">
            Soon
          </span>
        </span>
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
