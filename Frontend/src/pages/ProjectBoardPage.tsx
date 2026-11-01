import { cn } from 'cn';
import {
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useDialog } from '@/components/dashboard/AppDialog';
import { AppShell } from '@/components/dashboard/AppShell';
import { LockIcon } from '@/components/dashboard/Icons';
import { Avatar, RoleBadge } from '@/components/dashboard/OrgView';
import { ProjectTabs } from '@/components/dashboard/ProjectTabs';
import { Skeleton } from '@/components/dashboard/Skeleton';
import { useToast } from '@/components/dashboard/Toast';
import {
  ApiError,
  assignTask,
  changeTaskStatus,
  createTask,
  deleteTask,
  getTask,
  listProjectTasks,
  logout,
  type ProjectMember,
  type Task,
  type TaskPriority,
  updateTask,
} from '@/lib/api';
import {
  dueChip,
  fromApiStatus,
  STATUSES,
  type StatusKey,
  statusLabel,
  toApiStatus,
} from '@/lib/board';
import { BTN, CURRENT_USER, INPUT, ROLES, toRoleKey } from '@/lib/dashboard';
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

type PriorityKey = TaskPriority;

const PRIORITIES: Record<PriorityKey, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: '#E5484D' },
  high: { label: 'High', color: '#F59E0B' },
  medium: { label: 'Medium', color: '#1F2FE0' },
  low: { label: 'Low', color: '#8A90AD' },
};

/** UI-shaped task — the board's local drag state (API status mapped in/out). */
interface BoardTask {
  id: string;
  key: string;
  title: string;
  description: string;
  status: StatusKey;
  /** ProjectMember.userId — null is the "Unassigned" slot. */
  assigneeId: string | null;
  priority: PriorityKey;
  /** YYYY-MM-DD — the shape <input type="date"> expects. */
  due: string | null;
  /** Read-only view dialog extras — never mutated by the board. */
  createdByName: string;
  createdAt: string;
}

/** API row → the board's local shape (status through the lib/board maps). */
const fromApiTask = (task: Task): BoardTask => ({
  id: task.id,
  key: task.key,
  title: task.title,
  description: task.description,
  status: fromApiStatus(task.status),
  assigneeId: task.assignee?.id ?? null,
  priority: task.priority,
  due: task.dueDate,
  createdByName: task.createdByName,
  createdAt: task.createdAt,
});

const apiMessage = (error: unknown): string =>
  error instanceof ApiError
    ? error.messages.join(' ')
    : "Can't reach the server. Please try again shortly.";

/** Remove + reinsert (the design's moveTask) — order elsewhere is preserved. */
function relocate(
  list: BoardTask[],
  id: string,
  status: StatusKey,
  beforeId: string | null,
): BoardTask[] {
  const current = list.find((task) => task.id === id);
  if (!current) return list;
  const rest = list.filter((task) => task.id !== id);
  const moved = { ...current, status };
  const index =
    beforeId === null ? -1 : rest.findIndex((task) => task.id === beforeId);
  return index < 0
    ? [...rest, moved]
    : [...rest.slice(0, index), moved, ...rest.slice(index)];
}

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

function LockedScreen({
  title,
  note,
  cta,
  to,
}: {
  title: string;
  note: string;
  cta: string;
  to: string;
}) {
  return (
    <div className="max-w-2xl border border-ink p-8 sm:p-10">
      <span className="flex h-12 w-12 items-center justify-center bg-paper text-ink-soft">
        <LockIcon className="h-6 w-6" />
      </span>
      <h1 className="mt-5 font-display text-3xl font-bold leading-tight tracking-tight">
        {title}
      </h1>
      <p className="mt-3 max-w-md text-sm text-ink-soft">{note}</p>
      <Link to={to} className={`mt-6 inline-block ${BTN}`}>
        {cta}
      </Link>
    </div>
  );
}

/** Layout-matching placeholder for the board while org/projects load. */
function BoardSkeleton({ label }: { label: string }) {
  const column = (key: number) => (
    <div key={key} className="flex w-[272px] shrink-0 flex-col gap-3">
      <div className="flex items-center gap-2 py-2">
        <Skeleton className="h-2.5 w-2.5" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="ml-auto h-3 w-5" />
      </div>
      {[0, 1].map((card) => (
        <div key={card} className="border border-ink-line bg-white p-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-14" />
          </div>
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-4/5" />
          <div className="mt-4 flex items-center justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-6" />
          </div>
        </div>
      ))}
    </div>
  );
  return (
    <div role="status" aria-label={label} className="space-y-4">
      <div
        className="border border-ink p-5 pl-7 sm:p-6 sm:pl-8"
        style={{ boxShadow: 'inset 6px 0 0 #CDD0E0' }}
      >
        <Skeleton className="h-4 w-44" />
        <Skeleton className="mt-3 h-8 w-80 max-w-full" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <div className="flex -space-x-px">
            <Skeleton className="h-7 w-7" />
            <Skeleton className="h-7 w-7" />
            <Skeleton className="h-7 w-7" />
          </div>
          <div className="w-56 max-w-full">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="mt-2 h-2 w-full" />
          </div>
          <Skeleton className="ml-auto h-9 w-32" />
        </div>
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="flex gap-3 overflow-hidden">
        {[0, 1, 2, 3, 4].map(column)}
      </div>
    </div>
  );
}

export function ProjectBoardPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { show, element: toastElement } = useToast();
  const { ask, element: dialogElement } = useDialog();
  const authUser = useAppSelector((session) => session.auth.user);
  const {
    org,
    status: orgStatus,
    error: orgError,
    retry: retryOrg,
  } = useOrganization();
  const {
    projects: known,
    status: projectsStatus,
    error: projectsError,
    retry: retryProjects,
  } = useProjects();

  // The store is the roster's source of truth — no demo fallback: while the
  // list hydrates the skeleton below covers the gap, and an unknown id is a
  // genuine "not found".
  const project = known.find((row) => row.id === id) ?? null;
  const projectId = project?.id ?? null;

  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [tasksStatus, setTasksStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [tasksError, setTasksError] = useState<string[]>([]);
  // Retry bump — the fetch effect keys off it without re-running on renders.
  const [tasksNonce, setTasksNonce] = useState(0);

  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<StatusKey>>(() => new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    status: StatusKey;
    beforeId: string | null;
  } | null>(null);
  const bodyRefs = useRef<Partial<Record<StatusKey, HTMLDivElement | null>>>(
    {},
  );
  // Edge auto-scroll while dragging — refs only, so gliding never re-renders.
  const boardRef = useRef<HTMLDivElement>(null);
  const pointerXRef = useRef<number | null>(null);
  const scrollDirRef = useRef<-1 | 0 | 1>(0);
  const rafRef = useRef<number | null>(null);

  const members = project?.members ?? [];
  const currentUserId = authUser?.id ?? null;
  const actorRole = authUser?.role;
  const isMember =
    currentUserId !== null &&
    members.some((member) => member.userId === currentUserId);
  const isLead =
    currentUserId !== null &&
    members.some((member) => member.userId === currentUserId && member.isLead);
  // Design's full(): edit fields, delete, assign and move anything.
  const full =
    actorRole === 'Admin' || isLead || (actorRole === 'PM' && isMember);
  const canMove = (task: BoardTask): boolean =>
    full || (currentUserId !== null && task.assigneeId === currentUserId);
  // HR reads the board too (plan §1 — GET visibility), so the locked screen
  // is only for missing / non-member projects; `full` stays false for HR and
  // hides every mutation, matching the API's 403s.
  const canView = actorRole === 'Admin' || actorRole === 'HR' || isMember;
  const access: 'ok' | 'missing' | 'denied' = !project
    ? 'missing'
    : canView
      ? 'ok'
      : 'denied';
  // Create: Admin + project members (a Dev's create is a self-assign) —
  // never HR (§1.1 matrix; HR is never a project member anyway).
  const canCreate = actorRole === 'Admin' || isMember;

  // Board payload — seeded from the API on every project change; the local
  // `tasks` state exists purely for drag performance (plan §10).
  // biome-ignore lint/correctness/useExhaustiveDependencies: tasksNonce is a retry bump — it must re-run the fetch without being read inside.
  useEffect(() => {
    if (projectId === null || !canView) return;
    let cancelled = false;
    setTasksStatus('loading');
    setTasksError([]);
    listProjectTasks(projectId)
      .then(({ tasks: rows }) => {
        if (cancelled) return;
        setTasks(rows.map(fromApiTask));
        setTasksStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          // Definitive session verdict — RequireAuth bounces to login.
          dispatch(setAnonymous());
          return;
        }
        setTasksStatus('error');
        setTasksError(
          error instanceof ApiError
            ? error.messages
            : ["Can't reach the server. Please try again shortly."],
        );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, canView, tasksNonce, dispatch]);

  // Notification deep link: ?task=<id> opens that task's read-only view
  // dialog. The param is consumed once (replace) so re-renders can't reopen
  // it; a fresh click re-sets it. The view fn is read through a latest-ref
  // assigned further down (it closes over this render's state), keeping the
  // effect stable.
  const openDialogRef = useRef<((task: BoardTask) => Promise<void>) | null>(
    null,
  );
  const handledTaskParamRef = useRef<string | null>(null);
  useEffect(() => {
    const wanted = searchParams.get('task');
    if (!wanted) {
      handledTaskParamRef.current = null;
      return;
    }
    if (handledTaskParamRef.current === wanted || tasksStatus !== 'ready') {
      return;
    }
    handledTaskParamRef.current = wanted;
    setSearchParams({}, { replace: true });
    const open = openDialogRef.current;
    if (!open) return;
    const local = tasks.find((item) => item.id === wanted);
    if (local) {
      void open(local);
      return;
    }
    // Not on this board (or deleted since) — resolve it directly (§10).
    getTask(wanted)
      .then(({ task }) => {
        if (task.projectId === projectId) {
          void open(fromApiTask(task));
        } else {
          show('That task no longer exists.');
        }
      })
      .catch((error: unknown) => {
        show(
          error instanceof ApiError && error.status === 404
            ? 'That task no longer exists.'
            : apiMessage(error),
        );
      });
  }, [searchParams, tasksStatus, tasks, projectId, setSearchParams, show]);

  useEffect(() => {
    document.title = project
      ? `${project.name} board · Nexus`
      : 'Board · Nexus';
  }, [project]);

  // Empty deps on purpose: the cleanup only cancels a ref-held frame, so
  // dropTarget re-renders mid-drag can never kill an active scroll.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
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

  /**
   * Optimistic status move: relocate locally at once (drag feel), then
   * `PATCH /tasks/:id/status`. A within-column drop is cosmetic only — the
   * API has no ordering — so it never leaves the client. Failure rolls the
   * list back to its pre-move snapshot and toasts (plan §10).
   */
  const moveTask = (
    id: string,
    status: StatusKey,
    beforeId: string | null = null,
  ): void => {
    const current = tasks.find((task) => task.id === id);
    if (!current) return;
    const previous = tasks;
    setTasks((prev) => relocate(prev, id, status, beforeId));
    if (current.status === status) return; // cosmetic reorder inside a column
    show(`${current.key} moved to ${statusLabel(status)}`);
    changeTaskStatus(id, toApiStatus(status))
      .then(({ task }) => {
        const nextStatus = fromApiTask(task).status;
        setTasks((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, status: nextStatus } : item,
          ),
        );
      })
      .catch((error: unknown) => {
        setTasks(previous);
        show(apiMessage(error));
      });
  };

  const toggleCol = (key: StatusKey): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDragStart = (event: DragEvent, task: BoardTask): void => {
    if (!canMove(task)) return;
    setDragId(task.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(task.id));
  };

  const handleDragOver = (event: DragEvent, status: StatusKey): void => {
    if (dragId === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const body = bodyRefs.current[status];
    if (!body) {
      // Collapsed column: highlight nothing, but the drop still appends (below).
      setDropTarget(null);
      return;
    }
    // The cobalt line precedes this card — the dragged card never qualifies, so
    // dropping beside itself keeps its place (the design's trick).
    const cards = [...body.querySelectorAll<HTMLElement>('[data-task]')].filter(
      (card) => card.dataset.task !== dragId,
    );
    let beforeId: string | null = null;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        beforeId = card.dataset.task ?? null;
        break;
      }
    }
    setDropTarget({ status, beforeId });
  };

  const handleDrop = (event: DragEvent, status: StatusKey): void => {
    if (dragId === null) return;
    event.preventDefault();
    pointerXRef.current = null;
    stopAutoScroll();
    const id = dragId;
    const beforeId = dropTarget?.status === status ? dropTarget.beforeId : null;
    setDragId(null);
    setDropTarget(null);
    moveTask(id, status, beforeId);
  };

  const handleDragEnd = (): void => {
    pointerXRef.current = null;
    stopAutoScroll();
    setDragId(null);
    setDropTarget(null);
  };

  const stopAutoScroll = (): void => {
    scrollDirRef.current = 0;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  /** One edge-scroll frame; speed grows quadratically toward the board edge. */
  const tick = (): void => {
    rafRef.current = null;
    const board = boardRef.current;
    const x = pointerXRef.current;
    const dir = scrollDirRef.current;
    if (!board || x === null || dir === 0) {
      stopAutoScroll();
      return;
    }
    const rect = board.getBoundingClientRect();
    const zone = Math.min(120, rect.width / 4);
    const distance = dir === -1 ? x - rect.left : rect.right - x;
    if (distance > zone) {
      stopAutoScroll();
      return;
    }
    const strength = Math.max(0, 1 - distance / zone);
    board.scrollLeft += dir * 15 * strength * strength;
    rafRef.current = requestAnimationFrame(tick);
  };

  /** Re-derive the direction (-1 left, 0 none, 1 right) from the last pointer. */
  const updateAutoScrollDir = (): void => {
    const board = boardRef.current;
    const x = pointerXRef.current;
    if (!board || x === null) {
      stopAutoScroll();
      return;
    }
    const rect = board.getBoundingClientRect();
    const zone = Math.min(120, rect.width / 4);
    const fromLeft = x - rect.left;
    const fromRight = rect.right - x;
    const dir =
      fromLeft <= zone && fromLeft < fromRight ? -1 : fromRight <= zone ? 1 : 0;
    if (dir === scrollDirRef.current) return;
    scrollDirRef.current = dir;
    if (dir === 0) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    } else if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  /** Board-level dragover — bubbles up from columns, gaps, strips and headers. */
  const trackBoardDrag = (event: DragEvent<HTMLDivElement>): void => {
    if (dragId === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    pointerXRef.current = event.clientX;
    updateAutoScrollDir();
  };

  /** Pointer left the board entirely — glide stops until it returns. */
  const handleBoardDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      pointerXRef.current = null;
      stopAutoScroll();
    }
  };

  const handleCardKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    task: BoardTask,
  ): void => {
    // Enter/Space activate the card natively (it's a <button>) → onClick opens its view.
    if (
      (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') ||
      !canMove(task)
    ) {
      return;
    }
    event.preventDefault();
    const index =
      STATUSES.findIndex((status) => status.k === task.status) +
      (event.key === 'ArrowRight' ? 1 : -1);
    const next = index >= 0 && index < STATUSES.length ? STATUSES[index] : null;
    if (!next) return;
    // A collapsed destination still gets the card — expand it first.
    setCollapsed((prev) => {
      if (!prev.has(next.k)) return prev;
      const expanded = new Set(prev);
      expanded.delete(next.k);
      return expanded;
    });
    moveTask(task.id, next.k);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-task="${task.id}"]`)?.focus();
    });
  };

  const openPeopleDialog = (): void => {
    if (!project) return;
    void ask({
      title: 'Project members',
      ok: 'Close',
      hideOk: true,
      body: (
        <>
          <ul className="divide-y divide-ink-line border border-ink-line">
            {members.map((member) => (
              <li
                key={member.userId}
                className="flex items-center gap-3 px-3 py-2"
              >
                <Avatar name={member.name} size="h-8 w-8 text-[10px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">
                    {member.name}{' '}
                    {member.isLead ? (
                      <span className="bg-sun px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                        Lead
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs">{member.email}</span>
                </span>
                <RoleBadge role={toRoleKey(member.role)} />
              </li>
            ))}
          </ul>
          {full ? (
            <Link
              to={`/dashboard/projects/${project.id}`}
              className="inline-block text-sm font-semibold text-cobalt underline-offset-2 hover:underline"
            >
              Manage members on the project page
            </Link>
          ) : null}
        </>
      ),
    });
  };

  const openTaskDialog = async (
    task: BoardTask | null,
    defaultStatus: StatusKey = 'todo',
  ): Promise<void> => {
    if (!project) return;
    const edit = task !== null;
    const movable = task ? canMove(task) : true;
    const readOnly = task !== null && !full;
    const isDev = actorRole === 'Dev';
    // The delete link submits through this flag instead of smuggling a hidden
    // input into the form, which would poison later dialogs' FormData.
    let deleteRequested = false;

    // Client mirror of TasksPolicy.canAssignTarget (§1.2) — the server stays
    // the authority; this only shapes which options the select offers:
    // Admin → Dev/PM/Admin targets; PM/Lead → Dev targets; HR excluded.
    const assignable: ProjectMember[] = full
      ? members.filter((member) => {
          if (member.role === 'HR') return false;
          if (actorRole === 'Admin') return true;
          return member.role === 'Dev';
        })
      : [];
    // The current value (or the Dev's forced self on create) always renders
    // as an option even when the actor couldn't pick it fresh.
    const ensureOption = (userId: string | null): void => {
      if (!userId || assignable.some((row) => row.userId === userId)) return;
      const member = members.find((row) => row.userId === userId);
      if (member) assignable.push(member);
    };
    if (task) ensureOption(task.assigneeId);
    if (!task && isDev) ensureOption(currentUserId);

    const result = await ask({
      title: edit ? `${task.key} · ${task.title}` : 'New task',
      ok: !edit ? 'Create task' : full ? 'Save changes' : 'Save status',
      hideOk: readOnly && !movable,
      size: 'lg',
      body: (
        <>
          <Field htmlFor="t-title" label="Title">
            <input
              id="t-title"
              name="title"
              defaultValue={task?.title ?? ''}
              disabled={readOnly}
              autoComplete="off"
              className={INPUT}
            />
          </Field>
          <Field htmlFor="t-desc" label="Description">
            <textarea
              id="t-desc"
              name="description"
              rows={3}
              defaultValue={task?.description ?? ''}
              disabled={readOnly}
              placeholder={
                readOnly ? 'No description' : 'What needs to be done?'
              }
              className={INPUT}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field htmlFor="t-status" label="Status">
              <select
                id="t-status"
                name="status"
                disabled={!movable}
                defaultValue={task?.status ?? defaultStatus}
                className={INPUT}
              >
                {STATUSES.map((status) => (
                  <option key={status.k} value={status.k}>
                    {status.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor="t-assignee" label="Assignee">
              <select
                id="t-assignee"
                name="assignee"
                // A Dev's create is a self-assign (§1.1) — the server forces
                // it, so the select is locked to self rather than free.
                disabled={readOnly || (!task && isDev)}
                defaultValue={
                  !task && isDev
                    ? (currentUserId ?? '')
                    : (task?.assigneeId ?? '')
                }
                className={INPUT}
              >
                <option value="">Unassigned</option>
                {assignable.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                    {!task && member.userId === currentUserId ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor="t-priority" label="Priority">
              <select
                id="t-priority"
                name="priority"
                disabled={readOnly}
                defaultValue={task?.priority ?? 'medium'}
                className={INPUT}
              >
                {(Object.keys(PRIORITIES) as PriorityKey[]).map((key) => (
                  <option key={key} value={key}>
                    {PRIORITIES[key].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor="t-due" label="Due date">
              <input
                id="t-due"
                name="due"
                type="date"
                disabled={readOnly}
                defaultValue={task?.due ?? ''}
                className={INPUT}
              />
            </Field>
          </div>
          {readOnly && !movable ? (
            <p className="border-l-2 border-cobalt pl-3">
              Only the lead or an admin can edit this task. You can move tasks
              that are assigned to you.
            </p>
          ) : null}
          {edit && full && task ? (
            <button
              type="button"
              className="text-sm font-semibold text-red-700 underline-offset-2 hover:underline"
              onClick={(event) => {
                deleteRequested = true;
                event.currentTarget.closest('form')?.requestSubmit();
              }}
            >
              Delete task
            </button>
          ) : null}
        </>
      ),
      validate: (data) =>
        deleteRequested ||
        readOnly ||
        String(data.get('title') ?? '').trim().length >= 2
          ? ''
          : 'Give the task a title.',
    });
    if (!result) return;

    if (deleteRequested && task) {
      const confirm = await ask({
        title: 'Delete this task?',
        ok: 'Delete task',
        danger: true,
        body: (
          <p>
            <strong className="text-ink">{task.key}</strong> will be removed
            from the board for everyone. This can&apos;t be undone.
          </p>
        ),
      });
      if (!confirm) return;
      try {
        await deleteTask(task.id);
      } catch (error) {
        show(apiMessage(error));
        return;
      }
      setTasks((prev) => prev.filter((item) => item.id !== task.id));
      show(`${task.key} deleted`);
      return;
    }

    const status = String(result.get('status') ?? 'todo') as StatusKey;
    const title = String(result.get('title') ?? '').trim();
    const description = String(result.get('description') ?? '').trim();
    const assigneeId = String(result.get('assignee') ?? '') || null;
    const priority = String(result.get('priority') ?? 'medium') as PriorityKey;
    const due = String(result.get('due') ?? '') || null;

    if (!task) {
      try {
        const { task: created } = await createTask(project.id, {
          title,
          description,
          status: toApiStatus(status),
          priority,
          assigneeId: isDev ? currentUserId : assigneeId,
          dueDate: due,
        });
        setTasks((prev) => [...prev, fromApiTask(created)]);
        show('Task created');
      } catch (error) {
        show(apiMessage(error));
      }
      return;
    }

    // Edit — three independent calls, each returning the fresh task; the
    // last response wins for the local sync (server is authoritative).
    const statusChanged = status !== task.status;
    let latest: Task | null = null;
    try {
      if (full) {
        const fieldsChanged =
          title !== task.title ||
          description !== task.description ||
          priority !== task.priority ||
          due !== task.due;
        if (fieldsChanged) {
          const { task: updated } = await updateTask(task.id, {
            title,
            description,
            priority,
            dueDate: due,
          });
          latest = updated;
        }
        if (assigneeId !== task.assigneeId) {
          const { task: assigned } = await assignTask(task.id, assigneeId);
          latest = assigned;
        }
      }
      // Status moves are open to full actors *and* the assignee (§1.1).
      if (statusChanged) {
        const { task: moved } = await changeTaskStatus(
          task.id,
          toApiStatus(status),
        );
        latest = moved;
      }
    } catch (error) {
      show(apiMessage(error));
      return;
    }

    if (latest !== null) {
      const applied = latest;
      setTasks((prev) =>
        prev.map((item) => (item.id === task.id ? fromApiTask(applied) : item)),
      );
    }
    if (statusChanged) {
      show(`${task.key} moved to ${statusLabel(status)}`);
    } else if (latest !== null) {
      show('Task updated');
    }
  };

  /**
   * Read-only task view — what a card click (or a notification deep link)
   * opens. The Edit button appears only for actors who can actually change
   * something (`full`, or the assignee with status rights) and hands over to
   * the edit dialog; everyone else just closes.
   */
  const openTaskViewDialog = async (task: BoardTask): Promise<void> => {
    if (!project) return;
    const editable = full || canMove(task);
    const assignee = task.assigneeId
      ? members.find((member) => member.userId === task.assigneeId)
      : null;
    const statusDef = STATUSES.find((row) => row.k === task.status);
    const priority = PRIORITIES[task.priority];
    const due = dueChip(task.due, task.status);
    const created = new Date(task.createdAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const result = await ask({
      title: `${task.key} · ${task.title}`,
      ok: 'Edit task',
      cancelLabel: 'Close',
      hideOk: !editable,
      size: 'lg',
      body: (
        <>
          {task.description ? (
            <p className="whitespace-pre-wrap text-ink">{task.description}</p>
          ) : (
            <p className="italic">No description</p>
          )}
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                Status
              </dt>
              <dd className="mt-1 flex items-center gap-2 font-semibold text-ink">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0"
                  style={{ background: statusDef?.color }}
                />
                {statusDef?.label ?? task.status}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                Priority
              </dt>
              <dd className="mt-1 flex items-center gap-2 font-semibold text-ink">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0"
                  style={{ background: priority.color }}
                />
                {priority.label}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                Assignee
              </dt>
              <dd className="mt-1 font-semibold text-ink">
                {assignee
                  ? `${assignee.name}${
                      task.assigneeId === currentUserId ? ' (you)' : ''
                    }`
                  : 'Unassigned'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                Due date
              </dt>
              <dd
                className={cn(
                  'mt-1 font-semibold',
                  due.late ? 'text-red-600' : 'text-ink',
                )}
              >
                {task.due ? due.text : '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                Created by
              </dt>
              <dd className="mt-1 font-semibold text-ink">
                {task.createdByName} · {created}
              </dd>
            </div>
          </dl>
        </>
      ),
    });
    // Submitting means "Edit task" — chain into the edit dialog; Close is null.
    if (!result || !editable) return;
    await openTaskDialog(task);
  };
  // Latest-ref handoff for the ?task= deep-link effect above.
  openDialogRef.current = openTaskViewDialog;

  const renderCard = (task: BoardTask): ReactNode => {
    const priority = PRIORITIES[task.priority];
    const movable = canMove(task);
    const assignee = task.assigneeId
      ? members.find((member) => member.userId === task.assigneeId)
      : undefined;
    const due = dueChip(task.due, task.status);
    return (
      <button
        key={task.id}
        type="button"
        data-task={task.id}
        draggable={movable}
        aria-label={`${task.title}, ${statusLabel(task.status)}`}
        onDragStart={(event) => handleDragStart(event, task)}
        onDragEnd={handleDragEnd}
        onKeyDown={(event) => handleCardKeyDown(event, task)}
        onClick={() => void openTaskViewDialog(task)}
        className={cn(
          'w-full border border-ink-line bg-white p-3 text-left outline-none transition-colors hover:border-ink focus-visible:border-cobalt focus-visible:ring-2 focus-visible:ring-cobalt/30',
          movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          dragId === task.id && 'opacity-40',
        )}
      >
        <span className="flex items-center justify-between text-[11px] font-bold text-ink-soft">
          <span>{task.key}</span>
          <span className="inline-flex items-center gap-1.5 uppercase tracking-wider">
            <span className="h-2 w-2" style={{ background: priority.color }} />
            {priority.label}
          </span>
        </span>
        <span className="mt-1.5 block text-sm font-semibold leading-snug">
          {task.title}
        </span>
        <span className="mt-3 flex items-center justify-between">
          {task.due ? (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-xs',
                due.late ? 'font-bold text-red-600' : 'text-ink-soft',
              )}
            >
              {due.late ? <span className="h-2 w-2 bg-red-600" /> : null}
              {due.text}
            </span>
          ) : (
            <span />
          )}
          {assignee ? (
            <Avatar name={assignee.name} size="h-6 w-6 text-[9px]" />
          ) : (
            <span
              className="flex h-6 w-6 items-center justify-center border border-dashed border-ink-soft/60 text-[10px] text-ink-soft"
              title="Unassigned"
            >
              ?
            </span>
          )}
        </span>
      </button>
    );
  };

  const crumb = (
    <>
      {org ? (
        <>
          <span>{org.name}</span>
          <span className="mx-1.5 text-ink-line">/</span>
        </>
      ) : null}
      <Link to="/dashboard/projects" className="hover:text-ink">
        Projects
      </Link>
      {project ? (
        <>
          <span className="mx-1.5 text-ink-line">/</span>
          <Link
            to={`/dashboard/projects/${project.id}`}
            className="hover:text-ink"
          >
            {project.name}
          </Link>
          <span className="mx-1.5 text-ink-line">/</span>
          <span className="font-semibold text-ink">Board</span>
        </>
      ) : (
        <>
          <span className="mx-1.5 text-ink-line">/</span>
          <span className="font-semibold text-ink">Not found</span>
        </>
      )}
    </>
  );

  let body: ReactNode;
  if (orgStatus === 'unknown' || orgStatus === 'loading') {
    body = <BoardSkeleton label="Loading organization" />;
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
  } else if (
    org &&
    (projectsStatus === 'unknown' || projectsStatus === 'loading')
  ) {
    body = <BoardSkeleton label="Loading projects" />;
  } else if (org && projectsStatus === 'error') {
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
  } else if (access === 'missing') {
    body = (
      <LockedScreen
        title="Project not found"
        note="This project doesn't exist, or it was deleted."
        cta="Back to Projects"
        to="/dashboard/projects"
      />
    );
  } else if (access === 'denied' || !project) {
    body = (
      <LockedScreen
        title="You're not on this project"
        note="Ask the project lead to add you, and it will show up in your Projects list."
        cta="Back to Projects"
        to="/dashboard/projects"
      />
    );
  } else if (tasksStatus === 'loading' || tasksStatus === 'idle') {
    body = <BoardSkeleton label="Loading tasks" />;
  } else if (tasksStatus === 'error') {
    body = (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-[15px] font-semibold text-ink">
          Couldn&apos;t load tasks.
        </p>
        <p className="max-w-sm text-sm text-ink-soft">{tasksError.join(' ')}</p>
        <button
          type="button"
          onClick={() => setTasksNonce((value) => value + 1)}
          className="bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark"
        >
          Retry
        </button>
      </div>
    );
  } else {
    const leadLabel =
      members
        .filter((member) => member.isLead)
        .map((member) => member.name)
        .join(', ') || 'None yet';
    const visible = tasks.filter(
      (task) =>
        (!mine || task.assigneeId === currentUserId) &&
        (!q ||
          `${task.title} ${task.key}`.toLowerCase().includes(q.toLowerCase())),
    );
    const doneCount = tasks.filter((task) => task.status === 'done').length;
    const total = tasks.length;
    // Zero-count segments stay mounted at 0% — so a status sliding in/out of
    // the bar animates its width instead of popping into existence.
    const segments = STATUSES.map((status) => ({
      status,
      count: tasks.filter((task) => task.status === status.k).length,
    }));

    body = (
      <>
        <div
          className="flex flex-wrap items-start justify-between gap-4 border border-ink p-5 pl-7 sm:p-6 sm:pl-8"
          style={{ boxShadow: `inset 6px 0 0 ${project.color}` }}
        >
          <div className="min-w-0 max-w-2xl">
            <Link
              to={`/dashboard/projects/${project.id}`}
              className="text-sm text-ink-soft hover:text-ink"
            >
              ← Project overview
            </Link>
            <h1 className="mt-2 font-display text-3xl font-bold leading-none tracking-tight">
              {project.name}
            </h1>
            {project.description ? (
              <p className="mt-2 text-sm text-ink-soft">
                {project.description}
              </p>
            ) : null}
            <div className="mt-4 space-y-4">
              <button
                type="button"
                onClick={openPeopleDialog}
                aria-label="View project members"
                className="flex items-center gap-3"
              >
                <span className="flex -space-x-px">
                  {members.slice(0, 5).map((member) => (
                    <Avatar
                      key={member.userId}
                      name={member.name}
                      size="h-8 w-8 text-[10px]"
                      extra="ring-2 ring-white"
                    />
                  ))}
                </span>
                <span className="text-sm text-ink-soft underline-offset-2 hover:underline">
                  {members.length} members · Lead:{' '}
                  <strong className="text-ink">{leadLabel}</strong>
                </span>
              </button>
              <div className="w-full max-w-sm">
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                    Progress
                  </span>
                  <span className="text-ink-soft">
                    <strong className="text-ink">{doneCount}</strong> of {total}{' '}
                    done
                  </span>
                </div>
                <div
                  className="flex h-2 w-full bg-paper"
                  role="img"
                  aria-label={`${doneCount} of ${total} tasks done`}
                >
                  {segments.map(({ status, count }) => (
                    <span
                      key={status.k}
                      title={`${status.label}: ${count}`}
                      className="transition-[width] duration-500 ease-out"
                      style={{
                        width: `${total > 0 ? (count / total) * 100 : 0}%`,
                        background: status.color,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
          {canCreate ? (
            <button
              type="button"
              onClick={() => void openTaskDialog(null, 'todo')}
              className={BTN}
            >
              New task
            </button>
          ) : null}
        </div>

        <ProjectTabs
          projectId={project.id}
          active="board"
          taskCount={tasks.length}
        />

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="search"
            placeholder="Search tasks"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            autoComplete="off"
            aria-label="Search tasks"
            className={`${INPUT} max-w-xs py-2`}
          />
          <button
            type="button"
            onClick={() => setMine((value) => !value)}
            aria-pressed={mine}
            className={cn(
              'border border-ink px-3.5 py-2 text-sm font-semibold',
              mine ? 'bg-ink text-white' : 'hover:bg-paper',
            )}
          >
            Only mine
          </button>
          <p className="ml-auto hidden text-xs text-ink-soft md:block">
            {actorRole === 'HR'
              ? 'You have read-only access to this board.'
              : full
                ? 'Drag cards between columns, or focus one and use ← →.'
                : 'You can move tasks assigned to you. Drag them, or focus one and use ← →.'}
          </p>
        </div>

        {/* No scrollbar-width here: the standard property would make Chromium
            skip the app-wide ::-webkit-scrollbar rules (index.css), leaving the
            horizontal bar native while the page's vertical one stays custom. */}
        <section
          id="board"
          aria-label="Task board columns"
          ref={boardRef}
          className="mt-4 flex gap-3 overflow-x-auto pb-4"
          onDragOver={trackBoardDrag}
          onDragLeave={handleBoardDragLeave}
        >
          {STATUSES.map((status) => {
            const count = tasks.filter(
              (task) => task.status === status.k,
            ).length;
            if (collapsed.has(status.k)) {
              return (
                <div
                  key={status.k}
                  className="flex w-12 shrink-0 flex-col items-center border border-ink-line bg-paper"
                >
                  <button
                    type="button"
                    aria-label={`Expand ${status.label}`}
                    onClick={() => toggleCol(status.k)}
                    className="flex w-full flex-1 flex-col items-center gap-3 py-3 hover:bg-white"
                  >
                    <span
                      className="h-2.5 w-2.5"
                      style={{ background: status.color }}
                    />
                    <span className="bg-white px-1.5 text-xs font-bold text-ink-soft">
                      {count}
                    </span>
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ writingMode: 'vertical-rl' }}
                    >
                      {status.label}
                    </span>
                  </button>
                </div>
              );
            }
            const items = visible.filter((task) => task.status === status.k);
            const targeted = dropTarget?.status === status.k;
            return (
              <section
                key={status.k}
                aria-label={status.label}
                className="flex w-[272px] shrink-0 flex-col"
                onDragOver={(event) => handleDragOver(event, status.k)}
                onDrop={(event) => handleDrop(event, status.k)}
              >
                <header
                  className="flex items-center gap-2 border-b-2 px-1 py-2"
                  style={{ borderColor: status.color }}
                >
                  <span
                    className="h-2.5 w-2.5"
                    style={{ background: status.color }}
                  />
                  <h2 className="text-xs font-bold uppercase tracking-wider">
                    {status.label}
                  </h2>
                  <span className="bg-paper px-1.5 text-xs font-bold text-ink-soft">
                    {count}
                  </span>
                  <button
                    type="button"
                    aria-label={`Collapse ${status.label}`}
                    onClick={() => toggleCol(status.k)}
                    className="ml-auto px-1.5 text-ink-soft hover:text-ink"
                  >
                    –
                  </button>
                </header>
                <div
                  ref={(element) => {
                    bodyRefs.current[status.k] = element;
                  }}
                  data-status={status.k}
                  className={cn(
                    'col-body mt-2 min-h-[140px] flex-1 space-y-2 border border-transparent p-1',
                    targeted && 'border-cobalt bg-paper',
                  )}
                >
                  {items.map((task) => (
                    <Fragment key={task.id}>
                      {targeted && dropTarget?.beforeId === task.id ? (
                        <div
                          className="my-1 h-[3px] bg-cobalt"
                          aria-hidden="true"
                        />
                      ) : null}
                      {renderCard(task)}
                    </Fragment>
                  ))}
                  {targeted && dropTarget?.beforeId === null ? (
                    <div
                      className="my-1 h-[3px] bg-cobalt"
                      aria-hidden="true"
                    />
                  ) : null}
                  {items.length === 0 && !targeted ? (
                    <p className="empty px-2 py-6 text-center text-xs text-ink-soft/70">
                      No tasks
                    </p>
                  ) : null}
                </div>
                {canCreate ? (
                  <button
                    type="button"
                    onClick={() => void openTaskDialog(null, status.k)}
                    className="mt-1 w-full border border-dashed border-ink-soft/40 py-2 text-xs font-semibold text-ink-soft transition-colors hover:border-solid hover:border-ink hover:bg-paper hover:text-ink"
                  >
                    + Add task
                  </button>
                ) : null}
              </section>
            );
          })}
        </section>
      </>
    );
  }

  return (
    <AppShell
      wide
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
      {dialogElement}
      {toastElement}
    </AppShell>
  );
}
