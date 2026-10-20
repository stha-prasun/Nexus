import { useEffect, useRef, useState } from 'react';
import type { Member, Org, Project, RoleKey } from '@/lib/dashboard';
import {
  accessSummary,
  BTN,
  canManageMember,
  initials,
  pad2,
  ROLE_ORDER,
  ROLES,
  tint,
} from '@/lib/dashboard';
import { HubGraph } from './HubGraph';
import { CheckIcon, ChevronDownIcon, WarningIcon } from './Icons';

interface OrgViewProps {
  org: Org;
  members: Member[];
  projects: Project[];
  /** Display role for "you" (hero badge, description line) — from the real session. */
  viewAs: RoleKey;
  /** The session user's email — the row matching it is "you" (never index-based). */
  myEmail?: string;
  /** Edit/delete the organization — Admin only. */
  canManageOrg: boolean;
  /** Invite/remove members and change their roles (server-enforced §1.1 matrix). */
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
 * Custom listbox for picking a role: bordered trigger showing the colored
 * role chip + chevron, opening a styled option list (badges, descriptions,
 * checkmark) downward — matches the dialog's border-2 + hard-shadow weight.
 * Keeps its own selection so it works anywhere; reports changes via onChange.
 */
export function RoleSelect({
  value,
  name,
  ariaLabel,
  onChange,
  description = false,
  className = '',
  allowed,
}: {
  value: RoleKey;
  name?: string;
  ariaLabel: string;
  onChange?: (role: RoleKey) => void;
  description?: boolean;
  className?: string;
  /** Restrict the listbox to these roles; omit for all. */
  allowed?: RoleKey[];
}) {
  const [selected, setSelected] = useState<RoleKey>(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options = allowed ?? ROLE_ORDER;

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

  return (
    <div className={className}>
      <div ref={containerRef} className="relative flex">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className={`flex w-full cursor-pointer items-center justify-between gap-2 border bg-white px-2 py-1.5 outline-none transition ${
            open
              ? 'border-cobalt ring-2 ring-cobalt/25'
              : 'border-ink hover:bg-paper focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt/25'
          }`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={`inline-block shrink-0 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${ROLES[selected].cls}`}
            >
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
            className="animate-in fade-in zoom-in-95 duration-100 origin-top-left absolute left-0 top-[calc(100%+4px)] z-30 max-h-64 w-full min-w-64 overflow-y-auto border-2 border-ink bg-white shadow-[8px_8px_0_#14183A]"
          >
            {options.map((key) => (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={selected === key}
                onClick={() => select(key)}
                className={`flex w-full items-center gap-2.5 border-b border-l-4 border-b-ink-line py-2.5 pl-2.5 pr-3 text-left transition last:border-b-0 ${
                  selected === key
                    ? 'border-l-cobalt bg-cobalt/5'
                    : 'border-l-transparent hover:bg-paper'
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

/**
 * Always-visible role picker for dialogs: a grid of radio-card tiles
 * (badge + descriptor). No popup — native radios named `role` submit
 * through FormData. Filter with `roles` (invite dialog passes the
 * actor's invitable set).
 */
export function RolePicker({
  roles,
  name = 'role',
  defaultValue = 'dev',
}: {
  roles: RoleKey[];
  name?: string;
  defaultValue?: RoleKey;
}) {
  const fallback = roles.includes(defaultValue)
    ? defaultValue
    : (roles[0] ?? 'dev');
  const [picked, setPicked] = useState<RoleKey>(fallback);

  return (
    <fieldset className="grid grid-cols-2 gap-2">
      <legend className="sr-only">Role</legend>
      {roles.map((key) => {
        const isSelected = picked === key;
        return (
          <label
            key={key}
            className={`flex cursor-pointer flex-col gap-1.5 border-2 p-3 transition ${
              isSelected
                ? 'border-cobalt bg-cobalt/5 shadow-[3px_3px_0_#1f2fe0]'
                : 'border-ink/25 bg-white hover:border-ink hover:bg-paper'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={key}
              checked={isSelected}
              onChange={() => setPicked(key)}
              className="sr-only"
            />
            <span className="flex items-center justify-between gap-2">
              <span
                className={`inline-block px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${ROLES[key].cls}`}
              >
                {ROLES[key].label}
              </span>
              {isSelected ? (
                <CheckIcon className="h-4 w-4 shrink-0 text-cobalt" />
              ) : null}
            </span>
            <span className="text-xs leading-snug text-ink-soft">
              {ROLES[key].desc}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** Decorative placeholder card in the empty-state kanban skeleton. */
function SkeletonCard({
  width,
  accent = false,
}: {
  width: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`mb-2 border border-dashed border-ink-soft/40 bg-white/70 p-2.5 ${
        accent ? 'border-l-4 border-l-sun' : ''
      }`}
    >
      <div className={`h-1.5 ${width} bg-ink-line`} />
      <div className="mt-2 h-1.5 w-1/3 bg-ink-line/70" />
    </div>
  );
}

/**
 * Zero-projects panel (design: dashboard-no-projects.html) — copy and CTA
 * on the left, a decorative kanban skeleton on the right.
 */
function EmptyProjects({
  orgName,
  canManage,
  onCreateProject,
}: {
  orgName: string;
  canManage: boolean;
  onCreateProject: () => void;
}) {
  return (
    <div className="grid border border-ink md:grid-cols-2">
      <div className="flex flex-col justify-center p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-wider text-ink-soft">
          No projects yet
        </p>
        <h3 className="mt-3 font-display text-3xl font-bold leading-[1.05] tracking-tight">
          {canManage ? 'Start your first project' : 'Nothing to work on yet'}
        </h3>
        <p className="mt-3 max-w-sm text-sm text-ink-soft">
          {canManage
            ? `A project is where your team's tasks live. Create one and pick its members from ${orgName}.`
            : 'Your PM creates projects and adds you to them. They will show up here.'}
        </p>
        {canManage ? (
          <div className="mt-6">
            <button type="button" onClick={onCreateProject} className={BTN}>
              Create project
            </button>
          </div>
        ) : null}
      </div>
      <div
        aria-hidden="true"
        className="grid grid-cols-3 gap-3 border-t border-ink bg-paper p-5 md:border-l md:border-t-0"
      >
        <div>
          <p className="mb-2 border-b border-ink-line pb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-soft/70">
            To do
          </p>
          <SkeletonCard width="w-3/4" accent />
          <SkeletonCard width="w-1/2" />
        </div>
        <div>
          <p className="mb-2 border-b border-ink-line pb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-soft/70">
            In progress
          </p>
          <SkeletonCard width="w-2/3" />
        </div>
        <div>
          <p className="mb-2 border-b border-ink-line pb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-soft/70">
            Done
          </p>
          <SkeletonCard width="w-1/2" />
          <SkeletonCard width="w-3/4" />
        </div>
      </div>
    </div>
  );
}

/**
 * Single-project panel (design: dashboard-one-project.html) — the one
 * project gets a full-width card with an inset color spine, its roster
 * and an "Open board" CTA, plus the add-another row for managers.
 */
function SingleProject({
  project,
  members,
  canManage,
  onNewProject,
}: {
  project: Project;
  members: Member[];
  canManage: boolean;
  onNewProject: () => void;
}) {
  const people = project.people
    .map((idx) => members[idx])
    .filter((member): member is Member => Boolean(member));

  return (
    <div className="border border-ink">
      <div className="grid md:grid-cols-[minmax(0,1fr)_14rem]">
        <div
          className="p-6 sm:p-8"
          style={{ boxShadow: `inset 6px 0 0 ${project.color}` }}
        >
          <p className="pl-2 text-xs font-bold uppercase tracking-wider text-ink-soft">
            Project 01
          </p>
          <h3 className="mt-3 pl-2 font-display text-3xl font-bold leading-none tracking-tight">
            {project.name}
          </h3>
          <div className="mt-6 flex flex-wrap items-center gap-4 pl-2">
            <div className="flex -space-x-px">
              {people.slice(0, 6).map((member) => (
                <Avatar
                  key={member.email}
                  name={member.name}
                  size="h-9 w-9 text-xs"
                  extra="ring-2 ring-white"
                />
              ))}
            </div>
            <span className="text-sm text-ink-soft">
              {people.length} members
            </span>
          </div>
        </div>
        <button
          type="button"
          className="group flex items-center justify-between gap-6 border-t border-ink bg-cobalt px-6 py-5 text-left font-display text-lg font-bold text-white hover:bg-cobalt-dark md:flex-col md:items-start md:justify-between md:border-l md:border-t-0"
        >
          Open board
          <span
            aria-hidden="true"
            className="text-2xl leading-none text-sun transition-transform group-hover:translate-x-1"
          >
            →
          </span>
        </button>
      </div>
      {canManage ? (
        <button
          type="button"
          onClick={onNewProject}
          className="flex w-full items-center justify-between border-t border-dashed border-ink-soft/50 px-6 py-3 text-left text-sm font-semibold text-ink-soft transition-colors hover:border-solid hover:border-ink hover:bg-paper hover:text-ink"
        >
          <span>+ New project</span>
          <span className="font-normal">Add another</span>
        </button>
      ) : null}
    </div>
  );
}

export function OrgView({
  org,
  members,
  projects,
  viewAs,
  myEmail,
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
    const isMe = myEmail !== undefined && member.email === myEmail;
    const role = isMe ? viewAs : member.role;
    // Per-row §1.1 matrix: HR can't touch Admin/HR rows, PM only Dev, nobody
    // touches their own row — the server 403s the same set.
    const manageable =
      canManageMembers && !isMe && canManageMember(viewAs, member.role);
    const roleCell = manageable ? (
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
          {manageable ? (
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

  // The "+ New project" tile and row fillers belong to the multi-project
  // grid; the zero-project panel and single-project card are designed
  // layouts of their own.
  if (projects.length > 1) {
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
        {canManageMembers ? (
          <p className="mb-3 text-[13px] text-ink-soft">
            {accessSummary(viewAs)}
          </p>
        ) : null}
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
        {projects.length === 0 ? (
          <EmptyProjects
            orgName={org.name}
            canManage={canManageMembers}
            onCreateProject={onNewProject}
          />
        ) : projects.length === 1 ? (
          <SingleProject
            project={projects[0]}
            members={members}
            canManage={canManageMembers}
            onNewProject={onNewProject}
          />
        ) : (
          <ul className="grid gap-px border border-ink bg-ink-line sm:grid-cols-2 lg:grid-cols-3">
            {cells}
          </ul>
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
