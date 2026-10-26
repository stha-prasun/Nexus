import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  createProject,
  type MemberListItem,
  type Project,
} from '@/lib/api';
import { INPUT, toRoleKey } from '@/lib/dashboard';
import { useAppDispatch, useAppSelector, useMembers } from '@/store/hooks';
import { upsertProject } from '@/store/slices/projectsSlice';
import { RoleBadge } from './OrgView';

/** Fixed palette — every value satisfies the server's `^#[0-9A-Fa-f]{6}$`. */
const COLORS = [
  '#1F2FE0',
  '#2FB67C',
  '#E8590C',
  '#7C3AED',
  '#DB2777',
  '#0E7490',
];

const displayName = (row: MemberListItem): string =>
  row.name ?? row.email.split('@')[0] ?? row.email;

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fires after the API accepts the project — parent closes + toasts. */
  onCreated?: (project: Project) => void;
}

/**
 * Create-project dialog (plan §6): name, fixed color swatches, org-roster
 * member picker (ACTIVE, role ≠ HR, the creator excluded — they're
 * auto-added), and a lead toggle per Dev member (only Devs can lead). The
 * ≥1-Dev-lead rule is enforced client-side before the POST and re-checked
 * by the server.
 */
export function NewProjectDialog({
  open,
  onClose,
  onCreated,
}: NewProjectDialogProps) {
  const dispatch = useAppDispatch();
  const authUser = useAppSelector((state) => state.auth.user);
  const { members } = useMembers();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [leads, setLeads] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Fresh state on every open — leads start empty because only Dev members
  // can lead (the Admin/PM creator never does).
  useEffect(() => {
    if (!open) return;
    setName('');
    setColor(COLORS[0]);
    setSelected(new Set());
    setLeads(new Set());
    setError('');
    setBusy(false);
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const candidates = members.filter(
    (row) =>
      row.status === 'ACTIVE' &&
      row.role !== 'HR' &&
      typeof row.userId === 'string' &&
      row.email !== authUser?.email,
  );

  const toggleSelected = (userId: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) {
        next.delete(userId);
        // Dropping the member also drops their lead claim.
        setLeads((leadSet) => {
          const leadNext = new Set(leadSet);
          leadNext.delete(userId);
          return leadNext;
        });
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const toggleLead = (userId: string): void => {
    setLeads((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Give your project a name.');
      return;
    }
    if (leads.size === 0) {
      setError('Add a Dev member and mark them as the team lead.');
      return;
    }
    setBusy(true);
    setError('');
    void (async () => {
      try {
        const { project } = await createProject({
          name: trimmed,
          color,
          memberUserIds: [...selected],
          leadUserIds: [...leads],
        });
        dispatch(upsertProject(project));
        onCreated?.(project);
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
      className="fixed left-1/2 top-1/2 z-50 m-0 max-h-[85vh] w-[92%] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto border-2 border-ink bg-white p-0 shadow-[8px_8px_0_#14183A] [&::backdrop]:bg-ink/50"
    >
      <form onSubmit={handleSubmit} className="p-6" noValidate>
        <h2 className="font-display text-xl font-bold tracking-tight">
          New project
        </h2>

        <div className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="np-name"
              className="mb-1.5 block font-semibold text-ink"
            >
              Name
            </label>
            <input
              id="np-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Website relaunch"
              maxLength={100}
              className={INPUT}
            />
          </div>

          <div>
            <span className="mb-1.5 block font-semibold text-ink">Color</span>
            <fieldset className="flex flex-wrap gap-2 border-0 p-0">
              <legend className="sr-only">Project color</legend>
              {COLORS.map((swatch) => (
                <span key={swatch} className="relative inline-flex">
                  <input
                    type="radio"
                    name="np-color"
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
          </div>

          <div>
            <span className="mb-1.5 block font-semibold text-ink">Members</span>
            <ul className="max-h-56 space-y-2 overflow-y-auto border border-ink-line p-2">
              {authUser ? (
                <li className="flex items-center gap-3 bg-paper px-2 py-2">
                  <input
                    type="checkbox"
                    checked
                    disabled
                    readOnly
                    aria-label="You are always added"
                    className="h-4 w-4 shrink-0 accent-cobalt"
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold">{authUser.name}</span>{' '}
                    <span className="text-ink-soft">(you · auto-added)</span>
                  </span>
                </li>
              ) : null}
              {candidates.map((row) => {
                const userId = row.userId as string;
                const isSelected = selected.has(userId);
                return (
                  <li
                    key={row.id}
                    className={`flex items-center gap-3 px-2 py-2 transition ${
                      isSelected ? 'bg-cobalt/5' : 'hover:bg-paper'
                    }`}
                  >
                    <input
                      id={`np-member-${row.id}`}
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(userId)}
                      className="h-4 w-4 shrink-0 accent-cobalt"
                    />
                    <label
                      htmlFor={`np-member-${row.id}`}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
                    >
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block truncate font-semibold">
                          {displayName(row)}
                        </span>
                        <span className="block truncate text-xs text-ink-soft">
                          {row.email}
                        </span>
                      </span>
                      <RoleBadge role={toRoleKey(row.role)} />
                    </label>
                    {isSelected && row.role === 'Dev' ? (
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-soft">
                        <input
                          type="checkbox"
                          checked={leads.has(userId)}
                          onChange={() => toggleLead(userId)}
                          className="h-3.5 w-3.5 accent-cobalt"
                        />
                        Lead
                      </label>
                    ) : null}
                  </li>
                );
              })}
              {candidates.length === 0 && authUser ? (
                <li className="px-2 py-2 text-sm text-ink-soft">
                  No other eligible members — a project needs at least one Dev
                  as lead.
                </li>
              ) : null}
            </ul>
            <p className="mt-1.5 text-[13px] text-ink-soft">
              Only active organization members appear here. At least one Dev
              must be marked as lead.
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
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
