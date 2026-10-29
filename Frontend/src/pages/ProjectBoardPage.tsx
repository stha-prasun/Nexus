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
import { Link, useNavigate, useParams } from 'react-router';
import { useDialog } from '@/components/dashboard/AppDialog';
import { AppShell } from '@/components/dashboard/AppShell';
import { LockIcon } from '@/components/dashboard/Icons';
import { Avatar, RoleBadge } from '@/components/dashboard/OrgView';
import { useToast } from '@/components/dashboard/Toast';
import { logout, type Project, type ProjectMember, type User } from '@/lib/api';
import {
  dayStr,
  dueChip,
  keyPrefix,
  STATUSES,
  type StatusKey,
  statusLabel,
} from '@/lib/board';
import { BTN, CURRENT_USER, INPUT, ROLES, toRoleKey } from '@/lib/dashboard';
import { useAppDispatch, useAppSelector, useOrganization } from '@/store/hooks';
import { setAnonymous } from '@/store/slices/authSlice';
import { clearMembers } from '@/store/slices/membersSlice';
import { clearOrg } from '@/store/slices/orgSlice';
import { clearProjects } from '@/store/slices/projectsSlice';

type PriorityKey = 'urgent' | 'high' | 'medium' | 'low';

const PRIORITIES: Record<PriorityKey, { label: string; color: string }> = {
  urgent: { label: 'Urgent', color: '#E5484D' },
  high: { label: 'High', color: '#F59E0B' },
  medium: { label: 'Medium', color: '#1F2FE0' },
  low: { label: 'Low', color: '#8A90AD' },
};

interface BoardTask {
  id: number;
  key: string;
  title: string;
  description: string;
  status: StatusKey;
  /** ProjectMember.userId — null is the "Unassigned" slot. */
  assigneeId: string | null;
  priority: PriorityKey;
  /** YYYY-MM-DD — the shape <input type="date"> expects. */
  due: string | null;
}

const DEMO_ADDED_AT = '2026-01-05T09:00:00.000Z';

/** Demo roster from the design (project-board.html). */
const DEMO_MEMBERS: ProjectMember[] = [
  {
    userId: 'demo-maya',
    name: 'Maya Kim',
    email: 'maya@acme.com',
    role: 'Admin',
    isLead: false,
    addedAt: DEMO_ADDED_AT,
  },
  {
    userId: 'demo-jonas',
    name: 'Jonas Weber',
    email: 'jonas@acme.com',
    role: 'PM',
    isLead: true,
    addedAt: DEMO_ADDED_AT,
  },
  {
    userId: 'demo-tomas',
    name: 'Tomás Reyes',
    email: 'tomas@acme.com',
    role: 'PM',
    isLead: false,
    addedAt: DEMO_ADDED_AT,
  },
  {
    userId: 'demo-dana',
    name: 'Dana Ortiz',
    email: 'dana@acme.com',
    role: 'HR',
    isLead: false,
    addedAt: DEMO_ADDED_AT,
  },
  {
    userId: 'demo-priya',
    name: 'Priya Patel',
    email: 'priya@acme.com',
    role: 'Dev',
    isLead: false,
    addedAt: DEMO_ADDED_AT,
  },
  {
    userId: 'demo-lena',
    name: 'Lena Wu',
    email: 'lena@acme.com',
    role: 'Dev',
    isLead: false,
    addedAt: DEMO_ADDED_AT,
  },
];

/**
 * Fallback while the projects store is empty (a fresh deep link — the board
 * itself never fetches): the design's "Website relaunch", with the signed-in
 * viewer folded in so the access gates stay open.
 */
function demoProject(id: string | undefined, viewer: User | null): Project {
  const members = [...DEMO_MEMBERS];
  if (viewer && !members.some((member) => member.email === viewer.email)) {
    members.push({
      userId: viewer.id,
      name: viewer.name,
      email: viewer.email,
      role: viewer.role,
      isLead: viewer.role === 'PM',
      addedAt: DEMO_ADDED_AT,
    });
  }
  return {
    id: id ?? 'demo',
    name: 'Website relaunch',
    description: 'Rebuild the marketing site and move it to the new CMS.',
    color: '#FFD83D',
    createdByUserId: 'demo-maya',
    createdByName: 'Maya Kim',
    members,
    createdAt: DEMO_ADDED_AT,
    updatedAt: DEMO_ADDED_AT,
  };
}

/** [title, status, demo assignee email, priority, due offset in days]. */
type SeedRow = [string, StatusKey, string | null, PriorityKey, number];

const SEED: SeedRow[] = [
  ['Finalize homepage copy', 'done', 'priya@acme.com', 'medium', -6],
  ['Export brand assets', 'done', 'lena@acme.com', 'low', -5],
  ['Set up analytics', 'resolved', 'priya@acme.com', 'medium', -2],
  ['Update API docs', 'testing', 'lena@acme.com', 'high', 1],
  ['Fix checkout timeout', 'review', 'priya@acme.com', 'urgent', 0],
  ['Write release notes', 'review', 'jonas@acme.com', 'low', 3],
  ['Review mobile layout', 'progress', 'priya@acme.com', 'high', 1],
  ['Hero animation', 'progress', 'lena@acme.com', 'medium', 4],
  [
    'Waiting on legal for cookie banner',
    'hold',
    'jonas@acme.com',
    'medium',
    -1,
  ],
  ['Migrate blog posts', 'todo', null, 'medium', 7],
  ['Audit accessibility', 'todo', 'lena@acme.com', 'high', 6],
  ['Set up staging redirects', 'todo', 'priya@acme.com', 'low', 9],
];

/**
 * Seed emails map onto the current roster — a real project falls back to a
 * stable round-robin so every member owns movable cards of their own.
 */
const resolveAssignee = (
  email: string,
  members: ProjectMember[],
  index: number,
): string | null => {
  const hit = members.find((member) => member.email === email);
  if (hit) return hit.userId;
  return members[index % members.length]?.userId ?? null;
};

function seedTasks(project: Project): BoardTask[] {
  const prefix = keyPrefix(project.name);
  return SEED.map(([title, status, email, priority, offset], index) => ({
    id: index + 1,
    key: `${prefix}-${index + 1}`,
    title,
    description: '',
    status,
    assigneeId: email ? resolveAssignee(email, project.members, index) : null,
    priority,
    due: dayStr(offset),
  }));
}

/** Remove + reinsert (the design's moveTask) — order elsewhere is preserved. */
function relocate(
  list: BoardTask[],
  id: number,
  status: StatusKey,
  beforeId: number | null,
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

export function ProjectBoardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { show, element: toastElement } = useToast();
  const { ask, element: dialogElement } = useDialog();
  const authUser = useAppSelector((session) => session.auth.user);
  const known = useAppSelector((state) => state.projects.projects);
  const { org } = useOrganization();

  // Store project when known; the design's demo stands in while the list is
  // empty — this page deliberately never fetches (static board).
  const stored = known.find((project) => project.id === id);
  const project =
    stored ?? (known.length === 0 ? demoProject(id, authUser) : null);
  const source = project
    ? stored
      ? `real:${project.id}`
      : `demo:${project.id}`
    : 'none';

  const [tasks, setTasks] = useState<BoardTask[]>(() =>
    project ? seedTasks(project) : [],
  );
  const [seededFor, setSeededFor] = useState(source);
  if (seededFor !== source) {
    // New route id, or the store caught up mid-load — the seed follows the roster.
    setSeededFor(source);
    setTasks(project ? seedTasks(project) : []);
  }

  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<StatusKey>>(() => new Set());
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    status: StatusKey;
    beforeId: number | null;
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
  // Design's full(): create, edit, delete, assign and move anything.
  const full =
    actorRole === 'Admin' || isLead || (actorRole === 'PM' && isMember);
  const canMove = (task: BoardTask): boolean =>
    full || (currentUserId !== null && task.assigneeId === currentUserId);
  const access: 'ok' | 'missing' | 'hr' | 'denied' = !project
    ? 'missing'
    : actorRole === 'HR'
      ? 'hr'
      : actorRole === 'Admin' || isMember
        ? 'ok'
        : 'denied';

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

  const moveTask = (
    id: number,
    status: StatusKey,
    beforeId: number | null = null,
  ): void => {
    const current = tasks.find((task) => task.id === id);
    if (!current) return;
    setTasks((prev) => relocate(prev, id, status, beforeId));
    if (current.status !== status) {
      show(`${current.key} moved to ${statusLabel(status)}`);
    }
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
      (card) => Number(card.dataset.task) !== dragId,
    );
    let beforeId: number | null = null;
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        beforeId = Number(card.dataset.task);
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
    // Enter/Space activate the card natively (it's a <button>) → onClick opens it.
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
    // The delete link submits through this flag instead of smuggling a hidden
    // input into the form, which would poison later dialogs' FormData.
    let deleteRequested = false;

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
                disabled={readOnly}
                defaultValue={task?.assigneeId ?? ''}
                className={INPUT}
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
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
      const num =
        tasks.reduce(
          (max, item) => Math.max(max, Number(item.key.split('-')[1]) || 0),
          0,
        ) + 1;
      setTasks((prev) => [
        ...prev,
        {
          id: Date.now(),
          key: `${keyPrefix(project.name)}-${num}`,
          title,
          description,
          status,
          assigneeId,
          priority,
          due,
        },
      ]);
      show('Task created');
      return;
    }

    const patch = (list: BoardTask[]): BoardTask[] =>
      full
        ? list.map((item) =>
            item.id === task.id
              ? { ...item, title, description, assigneeId, priority, due }
              : item,
          )
        : list;

    if (status !== task.status) {
      setTasks((prev) => relocate(patch(prev), task.id, status, null));
      show(`${task.key} moved to ${statusLabel(status)}`);
    } else if (full) {
      setTasks(patch);
      show('Task updated');
    }
  };

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
        onClick={() => void openTaskDialog(task)}
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
  if (access === 'missing') {
    body = (
      <LockedScreen
        title="Project not found"
        note="This project doesn't exist, or it was deleted."
        cta="Back to Projects"
        to="/dashboard/projects"
      />
    );
  } else if (access === 'hr') {
    body = (
      <LockedScreen
        title="Projects aren't part of the HR role"
        note="HR looks after the people in the organization. Project work is handled by PMs, Admins and Devs."
        cta="Go to Organization"
        to="/dashboard"
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
          {full ? (
            <button
              type="button"
              onClick={() => void openTaskDialog(null, 'todo')}
              className={BTN}
            >
              New task
            </button>
          ) : null}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
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
            {full
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
                {full ? (
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
