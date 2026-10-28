import type { Project } from '@/lib/api';
import { initials, tint, toRoleKey } from '@/lib/dashboard';
import { RoleBadge } from './OrgView';

const addedOn = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

function Avatar({ name }: { name: string }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center text-xs font-bold text-ink"
      style={{ background: tint(name) }}
    >
      {initials(name)}
    </span>
  );
}

const COLUMNS = 'sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_110px_120px_110px]';

interface ProjectMemberTableProps {
  project: Project;
  /** The session user — their row is tinted and tagged "(you)". */
  currentUserId?: string;
}

/**
 * The read-only member table on the project detail page (design:
 * project.html): avatar + name, email, org role, the in-project flag
 * (Lead / Member) and the date they were added. Membership itself is
 * edited through the Manage members dialog, so rows carry no controls.
 */
export function ProjectMemberTable({
  project,
  currentUserId,
}: ProjectMemberTableProps) {
  const rows = project.members.map((member) => {
    const isSelf =
      currentUserId !== undefined && member.userId === currentUserId;

    return (
      <li
        key={member.userId}
        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-ink-line px-4 py-3 last:border-b-0 ${COLUMNS} ${
          isSelf ? 'bg-paper' : ''
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={member.name} />
          <span className="min-w-0 truncate font-semibold">
            {member.name}
            {isSelf ? (
              <span className="font-normal text-ink-soft"> (you)</span>
            ) : null}
          </span>
        </div>
        <span className="order-3 col-span-2 truncate text-sm text-ink-soft sm:order-none sm:col-span-1">
          {member.email}
        </span>
        <div className="hidden sm:block">
          <RoleBadge role={toRoleKey(member.role)} />
        </div>
        <div className="hidden sm:block">
          {member.isLead ? (
            <span className="inline-block bg-sun px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-ink">
              Lead
            </span>
          ) : (
            <span className="text-sm text-ink-soft">Member</span>
          )}
        </div>
        <span className="hidden text-sm text-ink-soft sm:block">
          {addedOn(member.addedAt)}
        </span>
      </li>
    );
  });

  return (
    <div className="border border-ink">
      <div
        className={`hidden gap-x-4 border-b border-ink bg-paper px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft sm:grid ${COLUMNS}`}
      >
        <span>Member</span>
        <span>Email</span>
        <span>Org role</span>
        <span>In this project</span>
        <span>Added</span>
      </div>
      <ul>{rows}</ul>
    </div>
  );
}
