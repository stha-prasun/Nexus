import { useEffect, useRef, useState } from 'react';
import type { Member, Org, Project, RoleKey } from '@/lib/dashboard';
import { BTN, initials, pad2, ROLE_ORDER, ROLES, tint } from '@/lib/dashboard';
import { HubGraph } from './HubGraph';
import { CheckIcon, ChevronDownIcon, WarningIcon } from './Icons';

interface OrgViewProps {
  org: Org;
  members: Member[];
  projects: Project[];
  /** Display role for "you" (hero badge, description line) — from the real session. */
  viewAs: RoleKey;
  /** Edit/delete the organization — Admin only. */
  canManageOrg: boolean;
  /** Invite/remove members and change their roles — visual only until member APIs land. */
  canManageMembers: boolean;
  graphKey: number;
  onAddMember: () => void;
  onRemoveMember: (index: number) => void;
  onRoleChange: (index: number, role: RoleKey) => void;
  onEditOrg: () => void;
  onDeleteOrg: () => void;
  onNewProject: () => void;
}

function Avatar({
  name,
  size = 'h-9 w-9 text-xs',
  extra = '',
}: {
  name: string;
  size?: string;
  extra?: string;
}) {
  return (
    <span
      className={`flex ${size} shrink-0 items-center justify-center font-bold text-ink ${extra}`}
      style={{ background: tint(name) }}
    >
      {initials(name)}
    </span>
  );
}

export function RoleBadge({ role }: { role: RoleKey }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${ROLES[role].cls}`}
    >
      {ROLES[role].label}
    </span>
  );
}

/**
 * Custom listbox for picking a role: bordered button showing the colored
 * role chip + chevron, opening a styled option list (badges, descriptions,
 * checkmark). Keeps its own selection so it works inside dialogs (FormData
 * reads the hidden input) and reports changes via onChange.
 *
 * The list is full trigger width (min 16rem). Inside a <dialog> it opens
 * toward the roomier side and is capped to that space, so it never pushes
 * past the dialog's `overflow-y-auto` box — that used to spawn a scrollbar
 * in the dialog while covering only part of the field.
 */
export function RoleSelect({
  value,
  name,
  ariaLabel,
  onChange,
  description = false,
  className = '',
}: {
  value: RoleKey;
  name?: string;
  ariaLabel: string;
  onChange?: (role: RoleKey) => void;
  description?: boolean;
  className?: string;
}) {
  const [selected, setSelected] = useState<RoleKey>(value);
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<{ up: boolean; maxHeight?: number }>({
    up: false,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setSelected(value), [value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Close only the listbox; let the next Escape close the dialog.
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const select = (key: RoleKey): void => {
    setSelected(key);
    onChange?.(key);
    setOpen(false);
  };

  const toggleOpen = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    const trigger = triggerRef.current;
    const dialog = trigger?.closest('dialog');
    if (trigger && dialog) {
      const t = trigger.getBoundingClientRect();
      const d = dialog.getBoundingClientRect();
      const above = t.top - d.top - 8;
      const below = d.bottom - t.bottom - 8;
      const up = above >= below;
      setMenuBox({ up, maxHeight: Math.max(96, up ? above : below) });
    } else {
      setMenuBox({ up: false });
    }
    setOpen(true);
  };

  return (
    <div className={className}>
      <div ref={containerRef} className="relative flex">
        <button
          ref={triggerRef}
          type="button"
          onClick={toggleOpen}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="flex w-full cursor-pointer items-center justify-between gap-2 border border-ink bg-white px-2 py-1.5 outline-none transition hover:bg-paper focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt/25"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={`h-2.5 w-2.5 shrink-0 ${ROLES[selected].dot}`}
              aria-hidden="true"
            />
            <span className="truncate text-[13px] font-semibold text-ink">
              {ROLES[selected].label}
            </span>
          </span>
          <ChevronDownIcon
            className={`h-3.5 w-3.5 text-ink-soft transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>

        {open ? (
          <div
            role="listbox"
            aria-label={ariaLabel}
            style={
              menuBox.maxHeight === undefined
                ? undefined
                : { maxHeight: menuBox.maxHeight }
            }
            className={`absolute left-0 z-30 w-full min-w-64 overflow-y-auto border border-ink bg-white shadow-[6px_6px_0_#14183A] ${
              menuBox.up ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]'
            }`}
          >
            {ROLE_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={selected === key}
                onClick={() => select(key)}
                className={`flex w-full items-center gap-2.5 border-b border-ink-line px-3 py-2.5 text-left last:border-b-0 hover:bg-paper ${
                  selected === key ? 'bg-paper/70' : ''
                }`}
              >
                <span
                  className={`shrink-0 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${ROLES[key].cls}`}
                >
                  {ROLES[key].label}
                </span>
                <span className="flex-1 text-xs leading-snug text-ink-soft">
                  {ROLES[key].desc}
                </span>
                {selected === key ? (
                  <CheckIcon className="h-4 w-4 shrink-0 text-cobalt" />
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {description ? (
        <p className="mt-1.5 text-[13px] text-ink-soft">
          {ROLES[selected].desc}
        </p>
      ) : null}
      {name ? (
        <input type="hidden" name={name} value={selected} readOnly />
      ) : null}
    </div>
  );
}

export function OrgView({
  org,
  members,
  projects,
  viewAs,
  canManageOrg,
  canManageMembers,
  graphKey,
  onAddMember,
  onRemoveMember,
  onRoleChange,
  onEditOrg,
  onDeleteOrg,
  onNewProject,
}: OrgViewProps) {
  const rows = members.map((member, i) => {
    const isMe = i === 0;
    const role = isMe ? viewAs : member.role;
    const roleCell =
      canManageMembers && !isMe ? (
        <RoleSelect
          value={member.role}
          ariaLabel={`Role for ${member.name}`}
          onChange={(role) => onRoleChange(i, role)}
          className="min-w-[110px]"
        />
      ) : (
        <RoleBadge role={role} />
      );
    const status = member.invited ? (
      <>
        <span className="inline-block h-2 w-2 border border-ink-soft" /> Invited
      </>
    ) : (
      <>
        <span className="inline-block h-2 w-2 bg-emerald-500" /> Active
      </>
    );

    return (
      <li
        key={member.email}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-ink-line px-4 py-3 last:border-b-0 hover:bg-paper/70 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_120px_100px_72px]"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={member.name} />
          <span className="truncate font-semibold">
            {member.name}
            {isMe ? (
              <span className="font-normal text-ink-soft"> (you)</span>
            ) : null}
          </span>
        </div>
        <span className="order-3 col-span-2 truncate text-sm text-ink-soft sm:order-none sm:col-span-1">
          {member.email}
        </span>
        <div>{roleCell}</div>
        <span className="hidden items-center gap-2 text-sm sm:flex">
          {status}
        </span>
        <div className="hidden text-right sm:block">
          {canManageMembers && !isMe ? (
            <button
              type="button"
              onClick={() => onRemoveMember(i)}
              className="text-sm text-ink-soft underline-offset-2 hover:text-red-600 hover:underline"
            >
              Remove
            </button>
          ) : null}
        </div>
      </li>
    );
  });

  const cells = projects.map((project, n) => (
    <li key={project.name} className="bg-white p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-ink-soft">{pad2(n + 1)}</span>
        <span className="h-3 w-3" style={{ background: project.color }} />
      </div>
      <p className="mt-8 font-display text-xl font-bold tracking-tight">
        {project.name}
      </p>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex -space-x-px">
          {project.people.slice(0, 4).map((idx) => (
            <Avatar
              key={idx}
              name={members[idx]?.name || '?'}
              size="h-7 w-7 text-[10px]"
              extra="ring-1 ring-white"
            />
          ))}
        </div>
        <span className="text-sm text-ink-soft">
          {project.people.length} members
        </span>
      </div>
    </li>
  ));

  if (canManageMembers) {
    cells.push(
      <li key="new-project" className="bg-white">
        <button
          type="button"
          onClick={onNewProject}
          className="flex h-full min-h-[148px] w-full flex-col items-start justify-between bg-paper p-5 text-left text-sm font-semibold text-ink-soft hover:bg-cobalt hover:text-white"
        >
          <span className="text-2xl leading-none">+</span>
          New project
        </button>
      </li>,
    );
  }
  while (cells.length % 3 !== 0) {
    cells.push(
      <li
        key={`filler-${cells.length}`}
        className="hidden bg-white lg:block"
      />,
    );
  }

  return (
    <>
      <section
        className="dots relative overflow-hidden bg-cobalt p-6 text-white sm:p-8"
        aria-labelledby="org-title"
      >
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0 max-w-md">
            <span className="flex h-14 w-14 items-center justify-center bg-sun font-display text-xl font-bold text-ink">
              {initials(org.name)}
            </span>
            <h1
              id="org-title"
              className="mt-4 font-display text-4xl font-bold leading-none tracking-tight"
            >
              {org.name}
            </h1>
            <p className="mt-2 text-white/75">{`nexus.app/${org.slug}`}</p>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
              <span>
                <strong className="font-display text-xl">
                  {members.length}
                </strong>{' '}
                <span className="text-white/75">people</span>
              </span>
              <span>
                <strong className="font-display text-xl">
                  {projects.length}
                </strong>{' '}
                <span className="text-white/75">projects</span>
              </span>
              <span className="bg-white/15 px-3 py-1 font-semibold">
                {`You're ${viewAs === 'admin' ? 'an' : 'a'} ${ROLES[viewAs].label}`}
              </span>
            </div>
            {canManageOrg ? (
              <button
                type="button"
                onClick={onEditOrg}
                className="mt-5 bg-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/25"
              >
                Edit organization
              </button>
            ) : null}
          </div>
          <div
            key={graphKey}
            className="anim hidden h-56 w-full max-w-[400px] md:block"
          >
            <HubGraph members={members} />
          </div>
        </div>
      </section>
      <p className="mt-4 border-l-2 border-cobalt pl-3 text-sm text-ink-soft">
        {ROLES[viewAs].desc}
      </p>

      <section className="mt-10" aria-labelledby="h-members">
        <div className="mb-3 flex items-end justify-between">
          <h2
            id="h-members"
            className="font-display text-2xl font-bold tracking-tight"
          >
            People{' '}
            <span className="ml-1 align-middle font-sans text-sm font-bold text-ink-soft">
              {pad2(members.length)}
            </span>
          </h2>
          {canManageMembers ? (
            <button type="button" onClick={onAddMember} className={BTN}>
              Add member
            </button>
          ) : null}
        </div>
        <div className="border border-ink">
          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,2fr)_120px_100px_72px] gap-x-4 border-b border-ink bg-paper px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft sm:grid">
            <span>Member</span>
            <span>Email</span>
            <span>Role</span>
            <span>Status</span>
            <span />
          </div>
          <ul>{rows}</ul>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="h-projects">
        <h2
          id="h-projects"
          className="mb-3 font-display text-2xl font-bold tracking-tight"
        >
          Projects{' '}
          <span className="ml-1 align-middle font-sans text-sm font-bold text-ink-soft">
            {pad2(projects.length)}
          </span>
        </h2>
        {projects.length > 0 || canManageMembers ? (
          <ul className="grid gap-px border border-ink bg-ink-line sm:grid-cols-2 lg:grid-cols-3">
            {cells}
          </ul>
        ) : (
          <p className="border border-dashed border-ink-line p-8 text-center text-sm text-ink-soft">
            No projects yet. Your Admin or PM will add them here.
          </p>
        )}
      </section>

      {canManageOrg ? (
        <section
          className="mt-12 border-2 border-red-600"
          aria-labelledby="h-danger"
        >
          <div className="flex items-center gap-2 bg-red-600 px-5 py-2 text-white">
            <WarningIcon />
            <h2
              id="h-danger"
              className="text-xs font-bold uppercase tracking-wider"
            >
              Danger zone · Sensitive area
            </h2>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="max-w-xl">
              <p className="font-semibold">Delete this organization</p>
              <p className="mt-1 text-sm text-ink-soft">
                This permanently deletes{' '}
                <strong className="text-ink">{org.name}</strong>, all of its
                projects and every task. Members lose access immediately.{' '}
                <strong className="text-red-700">This cannot be undone.</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={onDeleteOrg}
              className="border border-red-600 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-600 hover:text-white"
            >
              Delete organization
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}

export { Avatar };
