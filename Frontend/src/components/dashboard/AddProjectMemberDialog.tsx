import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  addProjectMember,
  type MemberListItem,
  type Project,
} from '@/lib/api';
import { toRoleKey } from '@/lib/dashboard';
import { useAppDispatch, useMembers } from '@/store/hooks';
import { upsertProject } from '@/store/slices/projectsSlice';
import { RoleBadge } from './OrgView';

const displayName = (row: MemberListItem): string =>
  row.name ?? row.email.split('@')[0] ?? row.email;

interface AddProjectMemberDialogProps {
  open: boolean;
  /** Drives the "already on this project" filter — re-read on every open. */
  project: Project;
  onClose: () => void;
  /** Fires with the server's updated project — parent syncs state + toasts. */
  onAdded?: (project: Project) => void;
}

/**
 * Add-a-member dialog (plan §6): single-select over the org roster filtered
 * to ACTIVE, role ≠ HR, and users not already on the project — the same
 * rules the server re-checks (403 not_org_member / project_member_role_
 * forbidden, 409 already_project_member surface inline).
 */
export function AddProjectMemberDialog({
  open,
  project,
  onClose,
  onAdded,
}: AddProjectMemberDialogProps) {
  const dispatch = useAppDispatch();
  const { members } = useMembers();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setError('');
    setBusy(false);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const onProject = new Set(project.members.map((member) => member.userId));
  const candidates = members.filter(
    (row) =>
      row.status === 'ACTIVE' &&
      row.role !== 'HR' &&
      typeof row.userId === 'string' &&
      !onProject.has(row.userId),
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!picked) {
      setError('Pick a member to add.');
      return;
    }
    setBusy(true);
    setError('');
    void (async () => {
      try {
        const { project: updated } = await addProjectMember(project.id, picked);
        dispatch(upsertProject(updated));
        onAdded?.(updated);
      } catch (err) {
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
      className="fixed left-1/2 top-1/2 z-50 m-0 max-h-[85vh] w-[92%] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto border-2 border-ink bg-white p-0 shadow-[8px_8px_0_#14183A] [&::backdrop]:bg-ink/50"
    >
      <form onSubmit={handleSubmit} className="p-6" noValidate>
        <h2 className="font-display text-xl font-bold tracking-tight">
          Add member
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          To <span className="font-semibold text-ink">{project.name}</span> —
          active organization members only.
        </p>

        <ul className="mt-4 max-h-64 space-y-1 overflow-y-auto border border-ink-line p-2">
          {candidates.map((row) => {
            const userId = row.userId as string;
            const isSelected = picked === userId;
            return (
              <li key={row.id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 px-2 py-2 transition ${
                    isSelected ? 'bg-cobalt/5' : 'hover:bg-paper'
                  }`}
                >
                  <input
                    type="radio"
                    name="apm-member"
                    checked={isSelected}
                    onChange={() => setPicked(userId)}
                    className="h-4 w-4 shrink-0 accent-cobalt"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {displayName(row)}
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
          {candidates.length === 0 ? (
            <li className="px-2 py-3 text-sm text-ink-soft">
              Everyone eligible is already on this project.
            </li>
          ) : null}
        </ul>

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
            disabled={busy || picked === null}
            className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add member'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
