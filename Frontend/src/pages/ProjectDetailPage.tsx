import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AddProjectMemberDialog } from '@/components/dashboard/AddProjectMemberDialog';
import { useDialog } from '@/components/dashboard/AppDialog';
import { AppShell } from '@/components/dashboard/AppShell';
import { ProjectMemberTable } from '@/components/dashboard/ProjectMemberTable';
import { useToast } from '@/components/dashboard/Toast';
import {
  ApiError,
  deleteProject,
  getProject,
  logout,
  type Project,
  type ProjectMember,
  removeProjectMember,
  setProjectLead,
  updateProject,
} from '@/lib/api';
import {
  CURRENT_USER,
  INPUT,
  initials,
  pad2,
  ROLES,
  tint,
  toRoleKey,
} from '@/lib/dashboard';
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

/** Fixed palette — same values as NewProjectDialog, all server-valid hex. */
const COLORS = [
  '#1F2FE0',
  '#2FB67C',
  '#E8590C',
  '#7C3AED',
  '#DB2777',
  '#0E7490',
];

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
  const [color, setColor] = useState(
    COLORS.includes(initialColor) ? initialColor : COLORS[0],
  );

  return (
    <>
      <Field htmlFor="ep-name" label="Name">
        <input
          id="ep-name"
          name="name"
          value={name}
          maxLength={100}
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
          {COLORS.map((swatch) => (
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

function Avatar({ name, extra = '' }: { name: string; extra?: string }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center text-xs font-bold text-ink ${extra}`}
      style={{ background: tint(name) }}
    >
      {initials(name)}
    </span>
  );
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { show, element: toastElement } = useToast();
  const { ask, element: dialogElement } = useDialog();
  const authUser = useAppSelector((session) => session.auth.user);
  const { org } = useOrganization();

  const [project, setProject] = useState<Project | null>(null);
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'error' | 'notfound'
  >('loading');
  const [error, setError] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);

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

  const handleRemoveMember = async (member: ProjectMember): Promise<void> => {
    if (!project) return;
    const result = await ask({
      title: `Remove ${member.name}?`,
      ok: 'Remove',
      danger: true,
      body: (
        <p>
          {member.name} will lose access to{' '}
          <strong className="text-ink">{project.name}</strong>.
        </p>
      ),
    });
    if (!result) return;
    try {
      const { project: updated } = await removeProjectMember(
        project.id,
        member.userId,
      );
      adopt(updated);
      show(`${member.name} removed`);
    } catch (err) {
      show(
        err instanceof ApiError
          ? err.messages.join(' ')
          : 'Something went wrong. Please try again.',
      );
    }
  };

  const handleToggleLead = (member: ProjectMember, isLead: boolean): void => {
    if (!project) return;
    void (async () => {
      try {
        const { project: updated } = await setProjectLead(
          project.id,
          member.userId,
          isLead,
        );
        adopt(updated);
        show(
          isLead
            ? `${member.name} is now a team lead`
            : `${member.name} is no longer a team lead`,
        );
      } catch (err) {
        show(
          err instanceof ApiError
            ? err.messages.join(' ')
            : 'Something went wrong. Please try again.',
        );
      }
    })();
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
    body = (
      <div
        role="status"
        aria-label="Loading project"
        className="flex justify-center py-24"
      >
        <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-line border-t-cobalt" />
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
    body = (
      <>
        <section
          aria-labelledby="p-title"
          className="border border-ink p-6 sm:p-8"
          style={{ boxShadow: `inset 6px 0 0 ${project.color}` }}
        >
          <p className="pl-2 text-xs font-bold uppercase tracking-wider text-ink-soft">
            Project
          </p>
          <h1
            id="p-title"
            className="mt-3 pl-2 font-display text-3xl font-bold leading-none tracking-tight"
          >
            {project.name}
          </h1>
          {project.description ? (
            <p className="mt-3 max-w-xl pl-2 text-[15px] leading-relaxed text-ink-soft">
              {project.description}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-4 pl-2">
            <div className="flex -space-x-px">
              {members.slice(0, 6).map((member) => (
                <Avatar
                  key={member.userId}
                  name={member.name}
                  extra="ring-2 ring-white"
                />
              ))}
            </div>
            <span className="text-sm text-ink-soft">
              {members.length} members
            </span>
            <span className="text-sm text-ink-soft">
              Created by {project.createdByName}
            </span>
          </div>
          {canManage ? (
            <div className="mt-5 flex flex-wrap gap-2 pl-2">
              <button
                type="button"
                onClick={() => void handleEdit()}
                className="border border-ink px-4 py-2 text-sm font-semibold hover:bg-paper"
              >
                Edit project
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark"
              >
                Add member
              </button>
            </div>
          ) : null}
        </section>

        <section className="mt-10" aria-labelledby="p-members">
          <div className="mb-3 flex items-end justify-between">
            <h2
              id="p-members"
              className="font-display text-2xl font-bold tracking-tight"
            >
              Members{' '}
              <span className="ml-1 align-middle font-sans text-sm font-bold text-ink-soft">
                {pad2(members.length)}
              </span>
            </h2>
          </div>
          <ProjectMemberTable
            project={project}
            actorRole={actorRole ?? null}
            currentUserId={currentUserId}
            onRemove={(member) => void handleRemoveMember(member)}
            onToggleLead={handleToggleLead}
          />
        </section>

        {canManage ? (
          <section
            className="mt-12 border-2 border-red-600"
            aria-labelledby="p-danger"
          >
            <div className="flex items-center gap-2 bg-red-600 px-5 py-2 text-white">
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
                  <strong className="text-ink">{project.name}</strong> and
                  removes every member from it. Members lose access immediately.{' '}
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
      {project ? (
        <AddProjectMemberDialog
          open={addOpen}
          project={project}
          onClose={() => setAddOpen(false)}
          onAdded={(updated) => {
            setAddOpen(false);
            adopt(updated);
            show('Member added');
          }}
        />
      ) : null}
      {dialogElement}
      {toastElement}
    </AppShell>
  );
}
