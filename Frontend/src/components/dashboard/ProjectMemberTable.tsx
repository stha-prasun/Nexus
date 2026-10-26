import type { Project, ProjectMember, Role } from '@/lib/api';
import { initials, pad2, tint, toRoleKey } from '@/lib/dashboard';
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

interface ProjectMemberTableProps {
  project: Project;
  /** Session role — anything but Admin/PM renders read-only (HR/Dev). */
  actorRole?: Role | null;
  /** Hides the Remove control on your own row (server 403s it anyway). */
  currentUserId?: string;
  onRemove: (member: ProjectMember) => void;
  onToggleLead: (member: ProjectMember, isLead: boolean) => void;
}

/**
 * The member table on the project detail page (plan §6): avatar, name,
 * email, org role, lead badge and added date, with per-row controls that
 * mirror the §1.1 matrix — Admin removes anyone (not self, not sole lead),
 * PM removes Dev targets only; lead on/off for Admin/PM. HR and Dev get a
 * read-only table (`actorRole` outside Admin/PM).
 */
export function ProjectMemberTable({
  project,
  actorRole,
  currentUserId,
  onRemove,
  onToggleLead,
}: ProjectMemberTableProps) {
  const canManage = actorRole === 'Admin' || actorRole === 'PM';

  const rows = project.members.map((member) => {
    const isSelf =
      currentUserId !== undefined && member.userId === currentUserId;
    // PM sees Remove only on Dev rows; Admin on any row; never on yourself.
    const canRemove =
      canManage && !isSelf && (actorRole === 'Admin' || member.role === 'Dev');

    return (
      <li
        key={member.userId}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-ink-line px-4 py-3 last:border-b-0 hover:bg-paper/70 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.8fr)_90px_90px_100px_auto]"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={member.name} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">
              {member.name}
              {isSelf ? (
                <span className="font-normal text-ink-soft"> (you)</span>
              ) : null}
            </span>
            <span className="block truncate text-xs text-ink-soft sm:hidden">
              {member.email}
            </span>
          </span>
        </div>
        <span className="order-3 col-span-2 hidden truncate text-sm text-ink-soft sm:order-none sm:col-span-1 sm:block">
          {member.email}
        </span>
        <div className="hidden sm:block">
          <RoleBadge role={toRoleKey(member.role)} />
        </div>
        <span className="hidden sm:block">
          {member.isLead ? (
            <span className="inline-block bg-sun px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-ink">
              Lead
            </span>
          ) : (
            <span className="text-sm text-ink-soft">—</span>
          )}
        </span>
        <span className="hidden text-sm text-ink-soft sm:block">
          {addedOn(member.addedAt)}
        </span>
        <div className="flex items-center justify-end gap-3 text-right">
          {canManage ? (
            <button
              type="button"
              onClick={() => onToggleLead(member, !member.isLead)}
              className="text-sm text-ink-soft underline-offset-2 hover:text-cobalt hover:underline"
            >
              {member.isLead ? 'Remove lead' : 'Make lead'}
            </button>
          ) : null}
          {canRemove ? (
            <button
              type="button"
              onClick={() => onRemove(member)}
              className="text-sm text-ink-soft underline-offset-2 hover:text-red-600 hover:underline"
            >
              Remove
            </button>
          ) : null}
        </div>
      </li>
    );
  });

  return (
    <div className="border border-ink">
      <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1.8fr)_90px_90px_100px_auto] gap-x-4 border-b border-ink bg-paper px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft sm:grid">
        <span>Member</span>
        <span>Email</span>
        <span>Role</span>
        <span>Lead</span>
        <span>Added</span>
        <span className="text-right">Actions</span>
      </div>
      <ul>{rows}</ul>
      <p className="border-t border-ink-line px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">
        {pad2(project.members.length)} members
      </p>
    </div>
  );
}
