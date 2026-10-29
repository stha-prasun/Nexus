import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  addProjectMember,
  getProject,
  type Project,
  type ProjectMember,
  type Role,
  removeProjectMember,
  setProjectLead,
} from '@/lib/api';
import { canManageMember, toRoleKey } from '@/lib/dashboard';
import {
  useAppDispatch,
  useAppSelector,
  useMembers,
  useOrganization,
} from '@/store/hooks';
import { upsertProject } from '@/store/slices/projectsSlice';
import { useDialog } from './AppDialog';
import { Avatar, RoleBadge } from './OrgView';

const displayName = (name: string | null, email: string): string =>
  name ?? email.split('@')[0] ?? email;

const BTN_SM =
  'border border-ink px-3 py-1.5 text-xs font-semibold hover:bg-ink hover:text-white';
const REMOVE =
  'text-sm text-ink-soft underline-offset-2 hover:text-red-600 hover:underline';

interface ManageMembersDialogProps {
  open: boolean;
  /** Re-read on every open — the lead cards and roster drive the UI. */
  project: Project;
  /** Jump straight into the lead picker (the "needs a lead" CTA). */
  openLeadPicker?: boolean;
  onClose: () => void;
  /** Fires after every change lands — parent closes + toasts. */
  onSaved?: (project: Project) => void;
}

/**
 * Manage-members drawer (design: project.html): the Dev lead sits in its own
 * card with a "Change" control, the team lists Add/Remove rows, and Save
 * diffs the draft into sequential add / lead-toggle / remove calls. Lead
 * promotion is Dev-only and runs before demotions so the server's ≥1-lead
 * invariant never trips; rows the API would 403 on (self-removal, PM →
 * non-Dev target, the project creator) carry no Remove control. A failed
 * step aborts, re-syncs from the server, and surfaces the message inline.
 */
export function ManageMembersDialog({
  open,
  project,
  openLeadPicker,
  onClose,
  onSaved,
}: ManageMembersDialogProps) {
  const dispatch = useAppDispatch();
  const authUser = useAppSelector((state) => state.auth.user);
  const { members } = useMembers();
  const { org } = useOrganization();
  const { ask, element: leadDialog } = useDialog();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const leadPrompted = useRef(false);

  const [draftMembers, setDraftMembers] = useState<Set<string>>(new Set());
  const [draftLeads, setDraftLeads] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Fresh state when the dialog opens for a project only — mid-save upserts
  // refresh `project` but must not clobber the draft being applied or the
  // inline error.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      openedFor.current = null;
      leadPrompted.current = false;
      return;
    }
    if (openedFor.current === project.id) return;
    openedFor.current = project.id;
    setDraftMembers(
      new Set(
        project.members
          .filter((member) => !member.isLead)
          .map((member) => member.userId),
      ),
    );
    setDraftLeads(
      new Set(
        project.members
          .filter((member) => member.isLead)
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

  /** Everything the draft holds — members plus the Dev leads on top. */
  const draftAll = new Set([...draftMembers, ...draftLeads]);
  const currentMemberIds = new Set(project.members.map((m) => m.userId));
  const currentLeadIds = new Set(
    project.members.filter((m) => m.isLead).map((m) => m.userId),
  );
  const adds = [...draftAll].filter((id) => !currentMemberIds.has(id));
  const removes = [...currentMemberIds].filter((id) => !draftAll.has(id));
  const promotes = [...draftLeads].filter((id) => !currentLeadIds.has(id));
  const demotes = [...currentLeadIds].filter((id) => !draftLeads.has(id));
  const leadChanged = promotes.length > 0 || demotes.length > 0;
  const changed = adds.length > 0 || removes.length > 0 || leadChanged;

  const projectById = new Map(project.members.map((m) => [m.userId, m]));
  const rosterById = new Map(
    members
      .filter((row) => typeof row.userId === 'string')
      .map((row) => [row.userId as string, row]),
  );
  const infoOf = (
    userId: string,
  ): { name: string; email: string; role: Role } | null => {
    const member: ProjectMember | undefined = projectById.get(userId);
    if (member) {
      return { name: member.name, email: member.email, role: member.role };
    }
    const row = rosterById.get(userId);
    if (!row) return null;
    return {
      name: displayName(row.name, row.email),
      email: row.email,
      role: row.role,
    };
  };

  const normalized = query.trim().toLowerCase();
  const match = (name: string, email: string): boolean =>
    !normalized || `${name} ${email}`.toLowerCase().includes(normalized);

  /** Hide what the API rejects: self, the creator, and role-matrix misses. */
  const canRemove = (member: ProjectMember): boolean =>
    member.userId !== authUser?.id &&
    member.userId !== project.createdByUserId &&
    actorRole !== null &&
    canManageMember(actorRole, toRoleKey(member.role));

  /**
   * Swap one lead (or fill the empty slot) in the draft: the pick joins the
   * leads, the old one stays on as a regular member unless the caller also
   * ticks "also remove".
   */
  const changeLead = async (oldId: string | null): Promise<void> => {
    const oldInfo = oldId ? infoOf(oldId) : null;
    const eligible = members.filter(
      (row) =>
        row.status === 'ACTIVE' &&
        row.role === 'Dev' &&
        typeof row.userId === 'string' &&
        !draftLeads.has(row.userId) &&
        row.userId !== oldId,
    );
    const result = await ask({
      title: oldInfo ? 'Change project lead' : 'Choose a project lead',
      ok: 'Set as lead',
      body: (
        <>
          <p>
            {oldInfo ? `${oldInfo.name} leads this project now. ` : ''}
            The lead runs the task board day to day and must be a Dev. Admins
            and PMs manage the project, but can&apos;t be its lead.
          </p>
          {eligible.length > 0 ? (
            <ul className="divide-y divide-ink-line border border-ink-line">
              {eligible.map((row) => {
                const userId = row.userId as string;
                const name = displayName(row.name, row.email);
                return (
                  <li key={row.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-paper">
                      <input
                        type="radio"
                        name="lead"
                        value={userId}
                        className="h-4 w-4 border-ink/40 text-cobalt focus:ring-cobalt/30"
                      />
                      <Avatar name={name} size="h-8 w-8 text-[10px]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-ink">
                          {name}
                        </span>
                        <span className="block text-xs">
                          {draftAll.has(userId)
                            ? 'Already on this project'
                            : 'Will be added to the project'}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="border-l-4 border-red-500 bg-red-50 px-3 py-2 text-red-800">
              There are no other Devs in the organization yet.
            </p>
          )}
          {oldInfo ? (
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                name="removeOld"
                className="mt-0.5 h-4 w-4 border-ink/40 text-cobalt"
              />
              <span>
                <span className="font-semibold text-ink">
                  Also remove {oldInfo.name} from this project
                </span>
                <br />
                Otherwise they stay on as a regular member.
              </span>
            </label>
          ) : null}
        </>
      ),
      validate: (data) =>
        data.get('lead')
          ? ''
          : eligible.length > 0
            ? 'Choose who will lead the project.'
            : 'There is no one else who can lead this project yet.',
    });
    if (!result) return;
    const next = result.get('lead') as string;
    const keepOld = !result.get('removeOld');
    setDraftLeads((current) => {
      const draft = new Set(current);
      if (oldId) draft.delete(oldId);
      draft.add(next);
      return draft;
    });
    setDraftMembers((current) => {
      const draft = new Set(current);
      draft.delete(next);
      if (oldId && keepOld) draft.add(oldId);
      return draft;
    });
  };

  // The "needs a lead" CTA opens the drawer and the picker in one go.
  useEffect(() => {
    if (!open || !openLeadPicker || leadPrompted.current) return;
    if (openedFor.current !== project.id) return;
    leadPrompted.current = true;
    void changeLead(null);
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!changed) {
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
        // Promote before demoting/removing — the server keeps ≥1 lead.
        for (const userId of promotes) {
          const { project: updated } = await setProjectLead(
            project.id,
            userId,
            true,
          );
          latest = updated;
          dispatch(upsertProject(updated));
        }
        for (const userId of demotes) {
          // A demoted member who is also leaving is handled by the remove.
          if (removes.includes(userId)) continue;
          const { project: updated } = await setProjectLead(
            project.id,
            userId,
            false,
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
          setDraftMembers(
            new Set(
              fresh.members
                .filter((member) => !member.isLead)
                .map((member) => member.userId),
            ),
          );
          setDraftLeads(
            new Set(
              fresh.members
                .filter((member) => member.isLead)
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

  const head = (label: string, count?: number) => (
    <p className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-line bg-paper px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-soft">
      <span>{label}</span>
      {count !== undefined ? <span>{count}</span> : null}
    </p>
  );

  const personRow = (
    key: string,
    name: string,
    email: string,
    role: Role,
    right: React.ReactNode,
  ) => (
    <li
      key={key}
      className="flex items-center gap-3 border-b border-ink-line px-5 py-3"
    >
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {name}
          {email === authUser?.email ? (
            <span className="font-normal text-ink-soft"> (you)</span>
          ) : null}
        </p>
        <p className="truncate text-xs text-ink-soft">{email}</p>
      </div>
      <RoleBadge role={toRoleKey(role)} />
      <div className="ml-1 min-w-[4.5rem] text-right">{right}</div>
    </li>
  );

  const none = (text: string) => (
    <p className="px-5 py-6 text-center text-sm text-ink-soft">{text}</p>
  );

  const teamRows = [...draftMembers]
    .map((userId) => ({ userId, info: infoOf(userId) }))
    .filter(
      (
        row,
      ): row is {
        userId: string;
        info: NonNullable<ReturnType<typeof infoOf>>;
      } => row.info !== null && match(row.info.name, row.info.email),
    );
  const addable = members.filter(
    (row) =>
      row.role !== 'HR' &&
      typeof row.userId === 'string' &&
      !draftAll.has(row.userId),
  );
  const visibleActive = addable.filter(
    (row) =>
      row.status === 'ACTIVE' &&
      match(displayName(row.name, row.email), row.email),
  );
  const visiblePending = addable.filter(
    (row) =>
      row.status === 'INVITED' &&
      match(displayName(row.name, row.email), row.email),
  );

  const leadCards = [...draftLeads]
    .map((userId) => ({ userId, info: infoOf(userId) }))
    .filter(
      (
        row,
      ): row is {
        userId: string;
        info: NonNullable<ReturnType<typeof infoOf>>;
      } => row.info !== null,
    );

  const summary = !changed
    ? 'No changes yet.'
    : (
        [
          adds.length > 0 ? `${adds.length} added` : '',
          removes.length > 0 ? `${removes.length} removed` : '',
          leadChanged ? 'lead changed' : '',
        ].filter(Boolean) as string[]
      ).join(' · ') +
      (removes.length > 0
        ? '. Their tasks stay on the board, unassigned.'
        : '');

  return (
    <>
      {/* Escape is the keyboard path (onCancel below); this is a backdrop-click
          convenience that only fires when the click lands on the dialog edge. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss, Escape covered by onCancel */}
      <dialog
        ref={dialogRef}
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) onClose();
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current && !busy) onClose();
        }}
        className="fixed inset-y-0 right-0 left-auto m-0 h-screen max-h-none w-full max-w-md border-l-2 border-ink p-0 [&::backdrop]:bg-ink/50"
      >
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-ink px-5 py-4">
            <div>
              <h2 className="font-display text-xl font-bold tracking-tight">
                Manage members
              </h2>
              <p className="mt-0.5 text-sm text-ink-soft">
                {project.name} · {draftAll.size} member
                {draftAll.size === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              disabled={busy}
              onClick={onClose}
              className="border border-ink px-2.5 py-0.5 text-lg leading-none hover:bg-ink hover:text-white disabled:opacity-50"
            >
              ×
            </button>
          </header>

          <div className="border-b border-ink-line px-5 py-3">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search people"
              autoComplete="off"
              aria-label="Search people"
              className="w-full border border-ink/40 bg-white px-3.5 py-2 text-[15px] outline-none transition focus:border-cobalt focus:ring-2 focus:ring-cobalt/25"
            />
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col"
            noValidate
          >
            <div className="flex-1 overflow-auto">
              {head('Project lead')}
              {leadCards.length > 0 ? (
                leadCards.map(({ userId, info }) => (
                  <div
                    key={userId}
                    className="flex items-center gap-3 border-b border-ink-line border-l-4 border-l-sun bg-white px-5 py-4"
                  >
                    <Avatar name={info.name} size="h-11 w-11 text-sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{info.name}</p>
                      <p className="truncate text-xs text-ink-soft">
                        {info.email}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void changeLead(userId)}
                      className={BTN_SM}
                    >
                      Change
                    </button>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-3 border-b border-ink-line border-l-4 border-l-red-600 bg-red-50 px-5 py-4">
                  <p className="min-w-0 flex-1 text-sm text-red-800">
                    <strong>No lead yet.</strong> Pick a Dev to run the board.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void changeLead(null)}
                    className={`${BTN_SM} bg-white`}
                  >
                    Choose lead
                  </button>
                </div>
              )}

              {head('Team', teamRows.length)}
              {teamRows.length > 0 ? (
                <ul>
                  {teamRows.map(({ userId, info }) =>
                    personRow(
                      userId,
                      info.name,
                      info.email,
                      info.role,
                      userId === project.createdByUserId ? (
                        <span className="border border-cobalt px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-cobalt">
                          Owner
                        </span>
                      ) : projectById.has(userId) &&
                        canRemove(projectById.get(userId) as ProjectMember) ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setDraftMembers((current) => {
                              const draft = new Set(current);
                              draft.delete(userId);
                              return draft;
                            })
                          }
                          className={REMOVE}
                        >
                          Remove
                        </button>
                      ) : null,
                    ),
                  )}
                </ul>
              ) : (
                none(
                  normalized
                    ? 'No one matches your search.'
                    : 'Just the lead so far.',
                )
              )}

              {head(
                `Add from ${org?.name ?? 'your organization'}`,
                addable.length,
              )}
              {visibleActive.length + visiblePending.length > 0 ? (
                <ul>
                  {visibleActive.map((row) => {
                    const userId = row.userId as string;
                    const name = displayName(row.name, row.email);
                    return personRow(
                      row.id,
                      name,
                      row.email,
                      row.role,
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setDraftMembers((current) =>
                            new Set(current).add(userId),
                          )
                        }
                        className={BTN_SM}
                      >
                        Add
                      </button>,
                    );
                  })}
                  {visiblePending.map((row) =>
                    personRow(
                      row.id,
                      displayName(row.name, row.email),
                      row.email,
                      row.role,
                      <span className="text-xs text-ink-soft">
                        Invite pending
                      </span>,
                    ),
                  )}
                </ul>
              ) : (
                none(
                  addable.length > 0
                    ? 'No one matches your search.'
                    : 'Everyone in the organization is already on this project.',
                )
              )}

              <p className="px-5 py-4 text-xs text-ink-soft">
                Only people already in the organization can be added. HR
                isn&apos;t listed, because HR doesn&apos;t work on projects. The
                lead is always a Dev, and the project creator can&apos;t be
                removed here.
              </p>
            </div>

            {error ? (
              <p
                role="alert"
                className="border-t border-ink-line bg-red-50 px-5 py-3 text-sm text-red-800"
              >
                {error}
              </p>
            ) : null}

            <footer className="border-t border-ink px-5 py-4">
              <p className="mb-3 text-sm text-ink-soft">{summary}</p>
              <div className="flex justify-end gap-2">
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
                  disabled={busy || !changed}
                  className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark disabled:opacity-40 disabled:hover:bg-cobalt"
                >
                  {busy ? 'Saving…' : 'Save members'}
                </button>
              </div>
            </footer>
          </form>
        </div>
      </dialog>
      {leadDialog}
    </>
  );
}
