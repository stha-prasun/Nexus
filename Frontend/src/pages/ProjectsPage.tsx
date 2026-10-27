import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { AppShell } from '@/components/dashboard/AppShell';
import { ManageMembersDialog } from '@/components/dashboard/ManageMembersDialog';
import { NewProjectDialog } from '@/components/dashboard/NewProjectDialog';
import { Avatar } from '@/components/dashboard/OrgView';
import { useToast } from '@/components/dashboard/Toast';
import { logout, type Project, type ProjectMember } from '@/lib/api';
import {
  BTN,
  CURRENT_USER,
  INPUT,
  pad2,
  ROLES,
  toRoleKey,
} from '@/lib/dashboard';
import {
  useAppDispatch,
  useAppSelector,
  useOrganization,
  useProjects,
} from '@/store/hooks';
import { setAnonymous } from '@/store/slices/authSlice';
import { clearMembers } from '@/store/slices/membersSlice';
import { clearOrg } from '@/store/slices/orgSlice';
import { clearProjects } from '@/store/slices/projectsSlice';

type Filter = 'all' | 'mine';

const leadNames = (project: Project): string =>
  project.members
    .filter((member) => member.isLead)
    .map((member) => member.name)
    .join(', ') || 'Unknown';

function AvatarStack({
  members,
  size,
  max,
}: {
  members: ProjectMember[];
  size: string;
  max: number;
}) {
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  return (
    <div className="flex -space-x-px">
      {shown.map((member) => (
        <Avatar
          key={member.userId}
          name={member.name}
          size={size}
          extra="ring-2 ring-white"
        />
      ))}
      {extra > 0 ? (
        <span
          className={`flex ${size} items-center justify-center bg-paper font-bold text-ink-soft ring-2 ring-white`}
        >
          +{extra}
        </span>
      ) : null}
    </div>
  );
}

/** Kanban skeleton — the design's right half of the empty state. */
function EmptyKanban() {
  const col = (label: string, cards: ReactNode) => (
    <div>
      <p className="mb-2 border-b border-ink-line pb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-soft/70">
        {label}
      </p>
      {cards}
    </div>
  );
  const card = (width: string, accent = false) => (
    <div
      className={`mb-2 border border-dashed border-ink-soft/40 bg-white/70 p-2.5 ${
        accent ? 'border-l-4 border-l-sun' : ''
      }`}
    >
      <div className={`h-1.5 ${width} bg-ink-line`} />
      <div className="mt-2 h-1.5 w-1/3 bg-ink-line/70" />
    </div>
  );
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-3 gap-3 border-t border-ink bg-paper p-5 md:border-l md:border-t-0"
    >
      {col(
        'To do',
        <>
          {card('w-3/4', true)}
          {card('w-1/2')}
        </>,
      )}
      {col('In progress', card('w-2/3'))}
      {col(
        'Done',
        <>
          {card('w-1/2')}
          {card('w-3/4')}
        </>,
      )}
    </div>
  );
}

function EmptyProjectsBlock({
  orgName,
  canCreate,
  onCreate,
  nonCreateText,
}: {
  orgName: string;
  canCreate: boolean;
  onCreate: () => void;
  /** Role-specific fallback for the "not on a project" copy (HR differs). */
  nonCreateText?: string;
}) {
  // Admin/PM see an empty list as "no projects exist" (they can create);
  // Dev/HR are never given a Create CTA — the list is simply theirs to read.
  const title = canCreate
    ? 'Start your first project'
    : 'Nothing to work on yet';
  const text = canCreate
    ? `A project is where your team's tasks live. Create one and pick its members from ${orgName}.`
    : (nonCreateText ??
      'Admins and PMs add you to projects. They will show up here.');
  return (
    <div className="grid border border-ink md:grid-cols-2">
      <div className="flex flex-col justify-center p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-wider text-ink-soft">
          No projects yet
        </p>
        <h2 className="mt-3 font-display text-3xl font-bold leading-[1.05] tracking-tight">
          {title}
        </h2>
        <p className="mt-3 max-w-sm text-sm text-ink-soft">{text}</p>
        {canCreate ? (
          <div className="mt-6">
            <button type="button" onClick={onCreate} className={BTN}>
              Create project
            </button>
          </div>
        ) : null}
      </div>
      <EmptyKanban />
    </div>
  );
}

function FeaturedProject({
  project,
  isMineLead,
  canManage,
  canCreate,
  onOpen,
  onMembers,
  onNew,
}: {
  project: Project;
  isMineLead: boolean;
  canManage: boolean;
  canCreate: boolean;
  onOpen: () => void;
  onMembers: () => void;
  onNew: () => void;
}) {
  const strip =
    'flex flex-1 items-center justify-between px-6 py-3 text-left text-sm font-semibold text-ink-soft transition-colors hover:bg-paper hover:text-ink';
  return (
    <div className="border border-ink">
      <div className="grid md:grid-cols-[minmax(0,1fr)_14rem]">
        <div
          className="p-6 sm:p-8"
          style={{ boxShadow: `inset 6px 0 0 ${project.color}` }}
        >
          <p className="pl-2 text-xs font-bold uppercase tracking-wider text-ink-soft">
            Project 01{isMineLead ? ' · You lead this' : ''}
          </p>
          <h2 className="mt-3 pl-2 font-display text-3xl font-bold leading-none tracking-tight">
            {project.name}
          </h2>
          {project.description ? (
            <p className="mt-3 max-w-xl pl-2 text-sm text-ink-soft">
              {project.description}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-4 pl-2">
            <AvatarStack
              members={project.members}
              size="h-9 w-9 text-xs"
              max={6}
            />
            <span className="text-sm text-ink-soft">
              {project.members.length} members · Lead: {leadNames(project)}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpen}
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
      {canManage || canCreate ? (
        <div className="flex divide-x divide-ink-line border-t border-ink-line">
          {canManage ? (
            <button type="button" onClick={onMembers} className={strip}>
              <span>Manage members</span>
              <span className="font-normal">{project.members.length}</span>
            </button>
          ) : null}
          {canCreate ? (
            <button type="button" onClick={onNew} className={strip}>
              <span>+ New project</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ProjectGrid({
  items,
  isMineLead,
  canManage,
  canCreate,
  onOpen,
  onMembers,
  onNew,
}: {
  items: Project[];
  isMineLead: (project: Project) => boolean;
  canManage: (project: Project) => boolean;
  canCreate: boolean;
  onOpen: (project: Project) => void;
  onMembers: (project: Project) => void;
  onNew: () => void;
}) {
  const cells: ReactNode[] = items.map((project, n) => (
    <li
      key={project.id}
      className="flex flex-col bg-white p-5"
      style={{ boxShadow: `inset 0 4px 0 ${project.color}` }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-ink-soft">{pad2(n + 1)}</span>
        {isMineLead(project) ? (
          <span className="bg-sun px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink">
            You lead
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onOpen(project)}
        className="mt-6 text-left font-display text-xl font-bold tracking-tight hover:text-cobalt"
      >
        {project.name}
      </button>
      <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">
        {project.description || 'No description'}
      </p>
      <p className="mt-3 text-xs text-ink-soft">
        Lead:{' '}
        <span className="font-semibold text-ink">{leadNames(project)}</span>
      </p>
      <div className="mt-auto flex items-center justify-between pt-4">
        <AvatarStack
          members={project.members}
          size="h-7 w-7 text-[10px]"
          max={4}
        />
        {canManage(project) ? (
          <button
            type="button"
            onClick={() => onMembers(project)}
            className="text-sm font-semibold text-cobalt underline-offset-2 hover:underline"
          >
            Members · {project.members.length}
          </button>
        ) : (
          <span className="text-sm text-ink-soft">
            {project.members.length} members
          </span>
        )}
      </div>
    </li>
  ));
  if (canCreate) {
    cells.push(
      <li key="new-project" className="bg-white">
        <button
          type="button"
          onClick={onNew}
          className="flex h-full min-h-[190px] w-full flex-col items-start justify-between bg-paper p-5 text-left text-sm font-semibold text-ink-soft transition-colors hover:bg-[#E9ECF7] hover:text-ink"
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
    <ul className="grid gap-px border border-ink bg-ink sm:grid-cols-2 lg:grid-cols-3">
      {cells}
    </ul>
  );
}

export function ProjectsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { show, element: toastElement } = useToast();
  const authUser = useAppSelector((state) => state.auth.user);
  const {
    org,
    status: orgStatus,
    error: orgError,
    retry: retryOrg,
  } = useOrganization();
  const {
    projects,
    status: projectsStatus,
    error: projectsError,
    retry: retryProjects,
  } = useProjects();

  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // Id, not object — the dialog must read the live Redux project so its
  // diff runs against the roster as mutations land.
  const [membersForId, setMembersForId] = useState<string | null>(null);

  const roleKey = authUser ? toRoleKey(authUser.role) : 'pm';
  const canCreate = authUser?.role === 'Admin' || authUser?.role === 'PM';
  const myId = authUser?.id;

  const isLeadByMe = (project: Project): boolean =>
    project.members.some((member) => member.isLead && member.userId === myId);
  const canManage = (project: Project): boolean =>
    authUser?.role === 'Admin' ||
    (authUser?.role === 'PM' &&
      project.members.some((member) => member.userId === myId));

  useEffect(() => {
    document.title = 'Projects · Nexus';
  }, []);

  /** This device only — same action as the sidebar Log out. */
  const handleLogout = (): void => {
    void (async () => {
      try {
        await logout();
      } catch {
        // Best-effort server-side invalidation; the cookie still dies at TTL.
      }
      dispatch(clearProjects());
      dispatch(clearMembers());
      dispatch(clearOrg());
      dispatch(setAnonymous());
      navigate('/', { replace: true });
    })();
  };

  const openProject = (project: Project): void => {
    navigate(`/dashboard/projects/${project.id}`);
  };

  const subtitle = org
    ? roleKey === 'admin' || roleKey === 'hr'
      ? `Every project in ${org.name}.`
      : roleKey === 'pm'
        ? 'Projects you lead or belong to.'
        : "Projects you've been added to."
    : '';

  const all = projects;
  const membersProject = membersForId
    ? (projects.find((project) => project.id === membersForId) ?? null)
    : null;
  let items = all;
  if (filter === 'mine') items = items.filter(isLeadByMe);
  if (q) {
    const needle = q.toLowerCase();
    items = items.filter((project) =>
      `${project.name} ${project.description ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }
  const showFeatured = all.length === 1 && !q && filter === 'all';

  const crumb = org ? (
    <>
      <span>{org.name}</span>
      <span className="mx-1.5 text-ink-line">/</span>
      <span className="font-semibold text-ink">Projects</span>
    </>
  ) : (
    <span className="font-semibold text-ink">Projects</span>
  );

  const tab = (key: Filter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(key)}
      className={`px-3.5 py-2 text-sm font-semibold ${
        filter === key
          ? 'bg-ink text-white'
          : 'text-ink-soft hover:bg-paper hover:text-ink'
      }`}
    >
      {label}
    </button>
  );

  let body: ReactNode;
  if (orgStatus === 'unknown' || orgStatus === 'loading') {
    body = (
      <div
        role="status"
        aria-label="Loading organization"
        className="flex justify-center py-24"
      >
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-line border-t-cobalt" />
      </div>
    );
  } else if (orgStatus === 'error') {
    body = (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-[15px] font-semibold text-ink">
          Couldn&apos;t load your organization.
        </p>
        <p className="max-w-sm text-sm text-ink-soft">{orgError.join(' ')}</p>
        <button
          type="button"
          onClick={retryOrg}
          className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark"
        >
          Retry
        </button>
      </div>
    );
  } else if (!org) {
    body = (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="font-display text-2xl font-bold tracking-tight">
          Create an organization first
        </p>
        <p className="max-w-sm text-sm text-ink-soft">
          Projects live inside an organization — set yours up, then come back
          here.
        </p>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className={BTN}
        >
          Go to Organization
        </button>
      </div>
    );
  } else if (projectsStatus === 'unknown' || projectsStatus === 'loading') {
    body = (
      <div
        role="status"
        aria-label="Loading projects"
        className="flex justify-center py-24"
      >
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-line border-t-cobalt" />
      </div>
    );
  } else if (projectsStatus === 'error') {
    body = (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-[15px] font-semibold text-ink">
          Couldn&apos;t load your projects.
        </p>
        <p className="max-w-sm text-sm text-ink-soft">
          {projectsError.join(' ')}
        </p>
        <button
          type="button"
          onClick={retryProjects}
          className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark"
        >
          Retry
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[2rem] font-bold leading-none tracking-tight">
              Projects{' '}
              <span className="ml-1 align-middle font-sans text-sm font-bold text-ink-soft">
                {pad2(all.length)}
              </span>
            </h1>
            <p className="mt-2 text-sm text-ink-soft">{subtitle}</p>
          </div>
          {canCreate && all.length > 1 ? (
            <button
              type="button"
              onClick={() => setNewProjectOpen(true)}
              className={BTN}
            >
              New project
            </button>
          ) : null}
        </div>

        {all.length > 1 ? (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <input
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Search projects"
              autoComplete="off"
              aria-label="Search projects"
              className={`${INPUT} max-w-xs py-2`}
            />
            {canCreate ? (
              <div className="flex border border-ink">
                {tab('all', 'All')}
                {tab('mine', 'I lead')}
              </div>
            ) : null}
          </div>
        ) : null}

        <section className="mt-6" aria-label="Project list">
          {all.length === 0 ? (
            <EmptyProjectsBlock
              orgName={org.name}
              canCreate={canCreate}
              onCreate={() => setNewProjectOpen(true)}
              nonCreateText={
                roleKey === 'hr'
                  ? 'Admins and PMs create projects. They will show up here.'
                  : undefined
              }
            />
          ) : showFeatured ? (
            <FeaturedProject
              project={all[0]}
              isMineLead={isLeadByMe(all[0])}
              canManage={canManage(all[0])}
              canCreate={canCreate}
              onOpen={() => openProject(all[0])}
              onMembers={() => setMembersForId(all[0].id)}
              onNew={() => setNewProjectOpen(true)}
            />
          ) : items.length === 0 ? (
            <p className="border border-dashed border-ink-line p-8 text-center text-sm text-ink-soft">
              No projects match
              {q ? ` “${q}”` : ' this filter'}.
            </p>
          ) : (
            <ProjectGrid
              items={items}
              isMineLead={isLeadByMe}
              canManage={canManage}
              canCreate={canCreate}
              onOpen={openProject}
              onMembers={(project) => setMembersForId(project.id)}
              onNew={() => setNewProjectOpen(true)}
            />
          )}
        </section>
      </>
    );
  }

  return (
    <AppShell
      org={org}
      user={{
        name: authUser?.name ?? CURRENT_USER.name,
        email: authUser?.email ?? CURRENT_USER.email,
        roleLabel: authUser
          ? ROLES[toRoleKey(authUser.role)].label
          : 'No role yet',
      }}
      crumb={crumb}
      onLogout={handleLogout}
    >
      {/* Keyed on role/count/filter — typing in search must not remount the
          view (the input would lose focus); everything else replays `view-in`. */}
      <div key={`${roleKey}-${all.length}-${filter}`} className="view-in">
        {body}
      </div>
      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={(project) => {
          setNewProjectOpen(false);
          setFilter('all');
          setQ('');
          show(`Project “${project.name}” created`);
        }}
      />
      {membersProject ? (
        <ManageMembersDialog
          open
          project={membersProject}
          onClose={() => setMembersForId(null)}
          onSaved={() => {
            setMembersForId(null);
            show('Members updated');
          }}
        />
      ) : null}
      {toastElement}
    </AppShell>
  );
}
