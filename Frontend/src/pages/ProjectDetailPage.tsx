import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDialog } from '@/components/dashboard/AppDialog';
import { AppShell } from '@/components/dashboard/AppShell';
import { ManageMembersDialog } from '@/components/dashboard/ManageMembersDialog';
import { ProjectMemberTable } from '@/components/dashboard/ProjectMemberTable';
import { Skeleton } from '@/components/dashboard/Skeleton';
import { useToast } from '@/components/dashboard/Toast';
import {
  ApiError,
  deleteProject,
  getProject,
  logout,
  type Project,
  updateProject,
} from '@/lib/api';
import { CURRENT_USER, INPUT, pad2, ROLES, toRoleKey } from '@/lib/dashboard';
import { useAppDispatch, useAppSelector, useOrganization } from '@/store/hooks';
import { setAnonymous } from '@/store/slices/authSlice';
import { clearMembers } from '@/store/slices/membersSlice';
import { clearOrg } from '@/store/slices/orgSlice';
import {
  clearProjects,
  removeProject,
  upsertProject,
} from '@/store/slices/projectsSlice';

function Field({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block font-semibold text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Fixed palette — same swatches as the design's edit dialog, all server-valid hex. */
const COLORS = ['#1F2FE0', '#FFD83D', '#E5484D', '#2FB67C', '#14183A'];

/**
 * Placeholder task counts — there is no tasks API yet, so every project
 * renders the same demo numbers (design: project.html Progress section).
 */
const COUNTS: Record<string, number> = {
  todo: 3,
  progress: 2,
  review: 2,
  hold: 1,
  testing: 1,
  resolved: 1,
  done: 2,
};

const STATUSES = [
  { k: 'todo', label: 'To do', color: '#8A90AD' },
  { k: 'progress', label: 'In progress', color: '#1F2FE0' },
  { k: 'review', label: 'In review', color: '#FFD83D' },
  { k: 'hold', label: 'On hold', color: '#E5484D' },
  { k: 'testing', label: 'Testing', color: '#0EA5A5' },
  { k: 'resolved', label: 'Resolved', color: '#2FB67C' },
  { k: 'done', label: 'Done', color: '#14183A' },
];

const TASK_TOTAL = STATUSES.reduce((n, s) => n + (COUNTS[s.k] ?? 0), 0);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-4 py-3 first:pl-0">
      <dt className="text-xs font-bold uppercase tracking-wider text-ink-soft">
        {label}
      </dt>
      <dd
        className="mt-1 truncate font-display text-xl font-bold leading-tight"
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

/** Controlled body for the rename/re-describe/recolor dialog. */
function EditProjectFields({
  initialName,
  initialDescription,
  initialColor,
}: {
  initialName: string;
  initialDescription: string | null;
  initialColor: string;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [color, setColor] = useState(initialColor);
  /** The project's own colour always gets a swatch, even if it predates the palette. */
  const swatches = COLORS.includes(initialColor)
    ? COLORS
    : [initialColor, ...COLORS];

  return (
    <>
      <Field htmlFor="ep-name" label="Project name">
        <input
          id="ep-name"
          name="name"
          value={name}
          maxLength={100}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
          className={INPUT}
        />
      </Field>
      <Field htmlFor="ep-description" label="Description (optional)">
        <textarea
          id="ep-description"
          name="description"
          value={description}
          maxLength={500}
          rows={3}
          placeholder="What is this project about?"
          onChange={(event) => setDescription(event.target.value)}
          className={INPUT}
        />
      </Field>
      <div>
        <span className="mb-1.5 block font-semibold text-ink">Color</span>
        <fieldset className="flex flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">Project color</legend>
          {swatches.map((swatch) => (
            <span key={swatch} className="relative inline-flex">
              <input
                type="radio"
                name="ep-color"
                value={swatch}
                checked={color === swatch}
                onChange={() => setColor(swatch)}
                aria-label={`Color ${swatch}`}
                className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
              />
              <span
                aria-hidden="true"
                className={`block h-9 w-9 border-2 transition peer-focus-visible:ring-2 peer-focus-visible:ring-cobalt peer-focus-visible:ring-offset-2 ${
                  color === swatch
                    ? 'border-ink shadow-[3px_3px_0_#14183A]'
                    : 'border-transparent hover:border-ink/40'
                }`}
                style={{ background: swatch }}
              />
            </span>
          ))}
        </fieldset>
        {/* Submits through the dialog's FormData path alongside `name`. */}
        <input type="hidden" name="color" value={color} readOnly />
      </div>
    </>
  );
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { show, element: toastElement } = useToast();
  const { ask, element: dialogElement } = useDialog();
  const authUser = useAppSelector((session) => session.auth.user);
  const knownProjects = useAppSelector((state) => state.projects.projects);
  const { org } = useOrganization();

  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'error' | 'notfound'
  >('loading');
  const [error, setError] = useState<string[]>([]);
  const [manageOpen, setManageOpen] = useState(false);

  /** The server's project is the source of truth — synced to the list too. */
  const adopt = useCallback(
    (next: Project): void => {
      setProject(next);
      setStatus('ready');
      dispatch(upsertProject(next));
    },
    [dispatch],
  );

  const load = useCallback(async (): Promise<void> => {
    if (!id) return;
    setStatus('loading');
    setError([]);
    try {
      const { project: fetched } = await getProject(id);
      adopt(fetched);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setStatus('notfound');
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        dispatch(setAnonymous());
        return;
      }
      setStatus('error');
      setError(
        err instanceof ApiError
          ? err.messages
          : ['Something went wrong. Please try again.'],
      );
    }
  }, [id, adopt, dispatch]);

  useEffect(() => {
    void load();
  }, [load]);

  const actorRole = authUser?.role;
  const canManage = actorRole === 'Admin' || actorRole === 'PM';
  const currentUserId = authUser?.id;
  const members = project?.members ?? [];

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

  useEffect(() => {
    document.title = project ? `${project.name} · Nexus` : 'Project · Nexus';
  }, [project]);

  const handleEdit = async (): Promise<void> => {
    if (!project) return;
    const result = await ask({
      title: 'Edit project',
      ok: 'Save changes',
      body: (
        <EditProjectFields
          initialName={project.name}
          initialDescription={project.description}
          initialColor={project.color}
        />
      ),
      validate: (data) => {
        const name = String(data.get('name') ?? '').trim();
        if (name.length < 2) return 'Give your project a name.';
        // The list is only populated once it has been fetched — an empty
        // store simply skips the check rather than blocking the rename.
        const taken = knownProjects.some(
          (other) =>
            other.id !== project.id &&
            other.name.toLowerCase() === name.toLowerCase(),
        );
        if (taken) return 'Another project already has that name.';
        return '';
      },
    });
    if (!result) return;
    const name = String(result.get('name') ?? '').trim();
    const color = String(result.get('color') ?? '');
    const description = String(result.get('description') ?? '').trim();
    try {
      const { project: updated } = await updateProject(project.id, {
        name,
        color,
        // Blank clears it — the server stores null either way.
        description: description || null,
      });
      adopt(updated);
      show('Project updated');
    } catch (err) {
      show(
        err instanceof ApiError
          ? err.messages.join(' ')
          : 'Something went wrong. Please try again.',
      );
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!project) return;
    const name = project.name;
    const result = await ask({
      title: 'Delete project',
      ok: 'Delete forever',
      danger: true,
      body: (
        <>
          <p className="border-l-4 border-red-600 bg-red-50 px-3 py-2 font-semibold text-red-800">
            Sensitive action. There is no way to recover a deleted project.
          </p>
          <p>
            This permanently deletes{' '}
            <strong className="text-ink">{name}</strong> and every membership on
            it. This can&apos;t be undone.
          </p>
          <Field htmlFor="dp-confirm" label="Type the project name to confirm">
            <input
              id="dp-confirm"
              name="confirm"
              autoComplete="off"
              placeholder={name}
              className={INPUT}
            />
          </Field>
        </>
      ),
      validate: (data) =>
        String(data.get('confirm') ?? '').trim() === name
          ? ''
          : "The name doesn't match.",
    });
    if (!result) return;
    try {
      await deleteProject(project.id);
      dispatch(removeProject(project.id));
      navigate('/dashboard', { replace: true });
      show('Project deleted');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Deleted elsewhere — converge on the same outcome.
        dispatch(removeProject(project.id));
        navigate('/dashboard', { replace: true });
        return;
      }
      show(
        err instanceof ApiError
          ? err.messages.join(' ')
          : 'Something went wrong. Please try again.',
      );
    }
  };

  const crumb = (
    <>
      {org ? (
        <>
          <span>{org.name}</span>
          <span className="mx-1.5 text-ink-line">/</span>
        </>
      ) : null}
      <span>Projects</span>
      {project ? (
        <>
          <span className="mx-1.5 text-ink-line">/</span>
          <span className="font-semibold text-ink">{project.name}</span>
        </>
      ) : (
        <span className="font-semibold text-ink"> Project</span>
      )}
    </>
  );

  let body: ReactNode;
  if (status === 'loading') {
    const row = [0, 1, 2, 3];
    body = (
      <div role="status" aria-label="Loading project" className="space-y-10">
        <div className="border border-ink">
          <div className="grid md:grid-cols-[minmax(0,1fr)_14rem]">
            <div className="p-6 sm:p-8">
              <div className="flex items-center justify-between gap-3 pl-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-28" />
              </div>
              <Skeleton className="mt-5 ml-2 h-9 w-2/3 max-w-md" />
              <Skeleton className="mt-4 ml-2 h-4 w-full max-w-xl" />
              <Skeleton className="mt-2 ml-2 h-4 w-4/5 max-w-lg" />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-ink bg-paper px-6 py-5 md:border-l md:border-t-0">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-6 w-6" />
            </div>
          </div>
          <dl className="grid grid-cols-2 divide-x divide-ink-line border-t border-ink-line px-4 sm:grid-cols-4 sm:px-8">
            {row.map((cell) => (
              <div key={cell} className="px-4 py-3 first:pl-0">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="mt-2 h-5 w-24" />
              </div>
            ))}
          </dl>
        </div>

        <Skeleton className="h-4 w-3/4 max-w-2xl" />

        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-9 w-40" />
          </div>
          <div className="border border-ink">
            <div className="hidden gap-x-4 border-b border-ink bg-paper px-4 py-2 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_110px_120px_110px]">
              {[
                { key: 'member', width: 'w-16' },
                { key: 'email', width: 'w-14' },
                { key: 'org-role', width: 'w-16' },
                { key: 'in-this-project', width: 'w-24' },
                { key: 'added', width: 'w-14' },
              ].map((header) => (
                <Skeleton key={header.key} className={`h-3 ${header.width}`} />
              ))}
            </div>
            <ul>
              {[0, 1, 2, 3].map((member) => (
                <li
                  key={member}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-ink-line px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_110px_120px_110px]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Skeleton className="h-9 w-9 shrink-0" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <div className="order-3 col-span-2 sm:order-none sm:col-span-1">
                    <Skeleton className="h-3.5 w-40" />
                  </div>
                  <div className="hidden sm:block">
                    <Skeleton className="h-5 w-16" />
                  </div>
                  <div className="hidden sm:block">
                    <Skeleton className="h-4 w-14" />
                  </div>
                  <div className="hidden sm:block">
                    <Skeleton className="h-3.5 w-20" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    );
  } else if (status === 'notfound') {
    body = (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="font-display text-2xl font-bold tracking-tight">
          Project not found or you don&apos;t have access
        </p>
        <p className="max-w-sm text-sm text-ink-soft">
          It may have been deleted, or you&apos;re not a member of it.
        </p>
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark"
        >
          Back to dashboard
        </button>
      </div>
    );
  } else if (status === 'error' || !project) {
    body = (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-[15px] font-semibold text-ink">
          Couldn&apos;t load this project.
        </p>
        <p className="max-w-sm text-sm text-ink-soft">{error.join(' ')}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark"
        >
          Retry
        </button>
      </div>
    );
  } else {
    const leads = members.filter((member) => member.isLead);
    const leadLabel = leads.length
      ? leads.map((member) => member.name).join(', ')
      : project.createdByName;
    const isLead = members.some(
      (member) => member.userId === currentUserId && member.isLead,
    );
    const accessLabel =
      actorRole === 'Admin'
        ? 'Admin · oversight'
        : isLead
          ? 'You lead this project'
          : 'Member';
    const note =
      actorRole === 'Admin'
        ? 'As an admin you can oversee every project, and create, edit, assign and move any task.'
        : actorRole === 'PM'
          ? 'As the project lead you can create, edit, assign and delete tasks, and move any task on the board.'
          : 'You can see every task on the board, and move the ones assigned to you.';
    const done = COUNTS.done ?? 0;

    body = (
      <>
        <div className="border border-ink">
          <div className="grid md:grid-cols-[minmax(0,1fr)_14rem]">
            <div
              className="p-6 sm:p-8"
              style={{ boxShadow: `inset 6px 0 0 ${project.color}` }}
            >
              <div className="flex items-center justify-between gap-3 pl-2">
                <Link
                  to="/dashboard/projects"
                  className="text-sm text-ink-soft hover:text-ink"
                >
                  ← All projects
                </Link>
                {canManage ? (
                  <button
                    type="button"
                    onClick={() => void handleEdit()}
                    className="border border-ink px-3.5 py-1.5 text-sm font-semibold hover:bg-ink hover:text-white"
                  >
                    Edit project
                  </button>
                ) : null}
              </div>
              <h1 className="mt-3 pl-2 font-display text-4xl font-bold leading-none tracking-tight">
                {project.name}
              </h1>
              {project.description ? (
                <p className="mt-3 max-w-xl pl-2 text-ink-soft">
                  {project.description}
                </p>
              ) : null}
            </div>
            {/* Board route lands later — wired up when it exists. */}
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
          <dl className="grid grid-cols-2 divide-x divide-ink-line border-t border-ink-line px-4 sm:grid-cols-4 sm:px-8">
            <Stat label="Lead" value={leadLabel} />
            <Stat label="Members" value={String(members.length)} />
            <Stat label="Tasks" value={String(TASK_TOTAL)} />
            <Stat label="Your access" value={accessLabel} />
          </dl>
        </div>
        <p className="mt-4 border-l-2 border-cobalt pl-3 text-sm text-ink-soft">
          {note}
        </p>

        <section className="mt-10" aria-labelledby="p-members">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2
              id="p-members"
              className="font-display text-2xl font-bold tracking-tight"
            >
              Members{' '}
              <span className="ml-1 align-middle font-sans text-sm font-bold text-ink-soft">
                {pad2(members.length)}
              </span>
            </h2>
            {canManage ? (
              <button
                type="button"
                onClick={() => setManageOpen(true)}
                className="border border-ink px-4 py-2 text-sm font-semibold hover:bg-ink hover:text-white"
              >
                Manage members
              </button>
            ) : null}
          </div>
          <ProjectMemberTable project={project} currentUserId={currentUserId} />
        </section>

        <section className="mt-10" aria-labelledby="p-progress">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2
              id="p-progress"
              className="font-display text-2xl font-bold tracking-tight"
            >
              Progress
            </h2>
            <span className="text-sm text-ink-soft">
              <strong className="text-ink">{done}</strong> of {TASK_TOTAL} done
            </span>
          </div>
          <div
            className="flex h-3 w-full bg-paper"
            role="img"
            aria-label={`${done} of ${TASK_TOTAL} tasks done`}
          >
            {STATUSES.filter((status) => COUNTS[status.k]).map((status) => (
              <span
                key={status.k}
                title={`${status.label}: ${COUNTS[status.k]}`}
                style={{
                  width: `${((COUNTS[status.k] ?? 0) / TASK_TOTAL) * 100}%`,
                  background: status.color,
                }}
              />
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-px border border-ink-line bg-ink-line sm:grid-cols-4 lg:grid-cols-7">
            {STATUSES.map((status) => (
              <li key={status.k} className="bg-white p-3">
                <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  <span
                    className="h-2.5 w-2.5"
                    style={{ background: status.color }}
                  />
                  {status.label}
                </p>
                <p className="mt-1.5 font-display text-2xl font-bold">
                  {COUNTS[status.k] ?? 0}
                </p>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-2 bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark"
          >
            Go to the task board →
          </button>
        </section>

        {canManage ? (
          <section
            className="mt-12 border-2 border-red-600"
            aria-labelledby="p-danger"
          >
            <div className="flex items-center gap-2 bg-red-600 px-5 py-2 text-white">
              <svg
                className="h-4 w-4 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="square"
                aria-hidden="true"
              >
                <path d="M12 3L2 21h20L12 3zM12 10v5M12 18v.5" />
              </svg>
              <h2
                id="p-danger"
                className="text-xs font-bold uppercase tracking-wider"
              >
                Danger zone · Sensitive area
              </h2>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="max-w-xl">
                <p className="font-semibold">Delete this project</p>
                <p className="mt-1 text-sm text-ink-soft">
                  This permanently deletes{' '}
                  <strong className="text-ink">{project.name}</strong> and every
                  membership on it. Members lose access immediately.{' '}
                  <strong className="text-red-700">
                    This cannot be undone.
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="border border-red-600 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-600 hover:text-white"
              >
                Delete project
              </button>
            </div>
          </section>
        ) : null}
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
      <div className="view-in">{body}</div>
      {project && manageOpen ? (
        <ManageMembersDialog
          open
          project={project}
          onClose={() => setManageOpen(false)}
          onSaved={(updated) => {
            setManageOpen(false);
            adopt(updated);
            show('Members updated');
          }}
        />
      ) : null}
      {dialogElement}
      {toastElement}
    </AppShell>
  );
}
