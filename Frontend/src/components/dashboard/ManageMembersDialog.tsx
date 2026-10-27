import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  addProjectMember,
  getProject,
  type Project,
  type Role,
  removeProjectMember,
} from '@/lib/api';
import { canManageMember, INPUT, toRoleKey } from '@/lib/dashboard';
import {
  useAppDispatch,
  useAppSelector,
  useMembers,
  useOrganization,
} from '@/store/hooks';
import { upsertProject } from '@/store/slices/projectsSlice';
import { Avatar, RoleBadge } from './OrgView';

const displayName = (name: string | null, email: string): string =>
  name ?? email.split('@')[0] ?? email;

interface ManageMembersDialogProps {
  open: boolean;
  /** Re-read on every open — the lead rows and roster drive the UI. */
  project: Project;
  onClose: () => void;
  /** Fires after every change lands — parent closes + toasts. */
  onSaved?: (project: Project) => void;
}

/**
 * Manage-members dialog (design): leads pinned on top with a "Lead" chip,
 * a checkbox roster over the org's ACTIVE non-HR members, and a Save that
 * diffs the selection into sequential add/remove calls. Rows the server
 * would 403 on (self-removal, PM → non-Dev target) are disabled — the UI
 * hides what the API rejects; a failed step aborts, re-syncs from the
 * server, and surfaces the message inline.
 */
export function ManageMembersDialog({
  open,
  project,
  onClose,
  onSaved,
}: ManageMembersDialogProps) {
  const dispatch = useAppDispatch();
  const authUser = useAppSelector((state) => state.auth.user);
  const { members } = useMembers();
  const { org } = useOrganization();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Fresh state when the dialog opens for a project only — mid-save upserts
  // refresh `project` but must not clobber the selection being applied or
  // the inline error.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      openedFor.current = null;
      return;
    }
    if (openedFor.current === project.id) return;
    openedFor.current = project.id;
    setSelected(
      new Set(
        project.members
          .filter((member) => !member.isLead)
          .map((member) => member.userId),
      ),
    );
    setQuery('');
    setError('');
    setBusy(false);
  }, [open, project.id, project.members]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const actorRole = authUser ? toRoleKey(authUser.role) : null;
  const leadIds = new Set(
    project.members.filter((member) => member.isLead).map((m) => m.userId),
  );
  const currentIds = new Set(
    project.members
      .filter((member) => !member.isLead)
      .map((member) => member.userId),
  );

  const roster = members.filter(
    (row) =>
      row.status === 'ACTIVE' &&
      row.role !== 'HR' &&
      typeof row.userId === 'string' &&
      !leadIds.has(row.userId),
  );
  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? roster.filter((row) =>
        `${row.name ?? ''} ${row.email}`.toLowerCase().includes(normalized),
      )
    : roster;

  /** Unchecking removes; checking adds — each mirrors the server's rules. */
  const canToggle = (userId: string, role: Role): boolean => {
    if (!currentIds.has(userId)) return true;
    // Self-removal is 403 for every role; the removal matrix (Admin anyone,
    // PM → Dev only) is the client mirror of §1.1.
    if (userId === authUser?.id) return false;
    return actorRole !== null && canManageMember(actorRole, toRoleKey(role));
  };

  const toggle = (userId: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const adds = [...selected].filter((userId) => !currentIds.has(userId));
    const removes = [...currentIds].filter((userId) => !selected.has(userId));
    if (adds.length === 0 && removes.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    void (async () => {
      let latest = project;
      try {
        for (const userId of adds) {
          const { project: updated } = await addProjectMember(
            project.id,
            userId,
          );
          latest = updated;
          dispatch(upsertProject(updated));
        }
        for (const userId of removes) {
          const { project: updated } = await removeProjectMember(
            project.id,
            userId,
          );
          latest = updated;
          dispatch(upsertProject(updated));
        }
        // Every response is the full roster — the last one is converged.
        onSaved?.(latest);
      } catch (err) {
        // Earlier steps in a partial run already landed — converge on the
        // server's truth so retry diffs against reality, not intent.
        try {
          const { project: fresh } = await getProject(project.id);
          dispatch(upsertProject(fresh));
          setSelected(
            new Set(
              fresh.members
                .filter((member) => !member.isLead)
                .map((member) => member.userId),
            ),
          );
        } catch {
          // Keep the local view; the inline error still explains the failure.
        }
        setError(
          err instanceof ApiError
            ? err.messages.join(' ')
            : 'Something went wrong. Please try again.',
        );
        setBusy(false);
      }
    })();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed left-1/2 top-1/2 z-50 m-0 max-h-[85vh] w-[92%] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto border-2 border-ink bg-white p-0 shadow-[8px_8px_0_#14183A] [&::backdrop]:bg-ink/50"
    >
      <form onSubmit={handleSubmit} className="p-6" noValidate>
        <h2 className="font-display text-xl font-bold tracking-tight">
          Members of {project.name}
        </h2>

        <div className="mt-4 space-y-3">
          {project.members
            .filter((member) => member.isLead)
            .map((lead) => (
              <div
                key={lead.userId}
                className="flex items-center gap-3 border border-ink-line bg-paper px-3 py-2"
              >
                <Avatar name={lead.name} size="h-7 w-7 text-[10px]" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                  {lead.name}
                </span>
                <span className="shrink-0 bg-sun px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink">
                  Lead
                </span>
              </div>
            ))}

          <div>
            <label
              htmlFor="mm-q"
              className="mb-1.5 block font-semibold text-ink"
            >
              Members{' '}
              <span className="font-normal text-ink-soft">
                from {org?.name ?? 'your organization'}
              </span>
            </label>
            <input
              id="mm-q"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
              autoComplete="off"
              className={`${INPUT} mb-2`}
            />
            <ul className="max-h-52 divide-y divide-ink-line overflow-auto border border-ink-line">
              {visible.map((row) => {
                const userId = row.userId as string;
                const checked = selected.has(userId);
                const enabled = canToggle(userId, row.role);
                const name = displayName(row.name, row.email);
                return (
                  <li key={row.id}>
                    <label
                      className={`flex items-center gap-3 px-3 py-2 ${
                        enabled
                          ? 'cursor-pointer hover:bg-paper'
                          : 'cursor-not-allowed opacity-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!enabled}
                        onChange={() => toggle(userId)}
                        className="h-4 w-4 shrink-0 accent-cobalt"
                      />
                      <Avatar name={name} size="h-7 w-7 text-[10px]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">
                          {name}
                        </span>
                        <span className="block truncate text-xs text-ink-soft">
                          {row.email}
                        </span>
                      </span>
                      <RoleBadge role={toRoleKey(row.role)} />
                    </label>
                  </li>
                );
              })}
              {visible.length === 0 ? (
                <li className="px-3 py-2.5 text-sm text-ink-soft">
                  {roster.length === 0
                    ? 'Everyone eligible is already on this project.'
                    : 'No one matches that search.'}
                </li>
              ) : null}
            </ul>
            <p className="mt-1.5 text-xs text-ink-soft">
              {selected.size === 0
                ? 'Only the lead for now. You can add people later.'
                : `${selected.size} selected, plus the lead`}
            </p>
          </div>
        </div>

        {error ? (
          <p
            role="alert"
            className="mt-3 border-l-4 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="border border-ink px-4 py-2 text-sm font-semibold hover:bg-paper disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save members'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
