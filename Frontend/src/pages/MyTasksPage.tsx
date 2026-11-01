import { cn } from 'cn';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useNavigate } from 'react-router';
import { AppShell } from '@/components/dashboard/AppShell';
import { LockIcon } from '@/components/dashboard/Icons';
import { Skeleton } from '@/components/dashboard/Skeleton';
import { useToast } from '@/components/dashboard/Toast';
import { ApiError, changeTaskStatus, logout } from '@/lib/api';
import {
  dayStr,
  dueChip,
  fromApiStatus,
  STATUSES,
  type StatusKey,
  statusLabel,
  toApiStatus,
} from '@/lib/board';
import {
  BTN,
  CURRENT_USER,
  INPUT,
  pad2,
  ROLES,
  toRoleKey,
} from '@/lib/dashboard';
import {
  countOpen,
  daysTo,
  fetchMyTasks,
  type GroupBy,
  groupTasks,
  isFinished,
  type MyTask,
  PRIORITIES,
  publishOpenCount,
  sortTasks,
  type TaskProject,
} from '@/lib/myTasks';
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

type TabKey = 'open' | 'done' | 'all';
type ViewKey = 'list' | 'calendar';

const VIEW_STORAGE_KEY = 'nexus.myTasksView';

const readStoredView = (): ViewKey => {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'calendar'
      ? 'calendar'
      : 'list';
  } catch {
    return 'list';
  }
};

/** Filter-bar selects — INPUT carries `w-full`, which a flex row must not. */
const SELECT_SM =
  'border border-ink/40 bg-white px-3 py-2 text-sm font-medium text-ink outline-none transition focus:border-cobalt';

const ROW_SELECT =
  'border border-ink/40 bg-white px-2 py-1.5 text-sm font-medium outline-none focus:border-cobalt';

const projectOf = (projects: TaskProject[], id: string): TaskProject =>
  projects.find((project) => project.id === id) ?? {
    id,
    name: 'Unknown project',
    color: '#8A90AD',
  };

/** Title opens the board; the project chip opens its page (design's links). */
const titleTo = (project: TaskProject): string =>
  `/dashboard/projects/${project.id}/board`;

const projectTo = (project: TaskProject): string =>
  `/dashboard/projects/${project.id}`;

const apiMessage = (error: unknown): string =>
  error instanceof ApiError
    ? error.messages.join(' ')
    : "Can't reach the server. Please try again shortly.";

function DueCell({ task }: { task: MyTask }) {
  if (!task.due) {
    return <span className="text-sm text-ink-soft">No date</span>;
  }
  const { text, late } = dueChip(task.due, task.status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm',
        late ? 'font-bold text-red-600' : 'text-ink-soft',
      )}
    >
      {late ? <span className="h-2 w-2 bg-red-600" /> : null}
      {text}
    </span>
  );
}

function TaskRow({
  task,
  project,
  onToggle,
  onStatus,
}: {
  task: MyTask;
  project: TaskProject;
  onToggle: (task: MyTask, checked: boolean) => void;
  onStatus: (task: MyTask, status: StatusKey) => void;
}) {
  const priority = PRIORITIES[task.priority];
  const done = isFinished(task.status);
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-ink-line px-4 py-3 last:border-b-0 hover:bg-paper/70 md:grid-cols-[auto_minmax(0,3fr)_minmax(0,1.6fr)_140px_100px]">
      <input
        type="checkbox"
        checked={done}
        onChange={(event) => onToggle(task, event.target.checked)}
        aria-label={`Mark ${task.key} as done`}
        className="h-4 w-4 shrink-0 cursor-pointer accent-cobalt"
      />
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[11px] font-bold text-ink-soft">
          <span>{task.key}</span>
          <span className="inline-flex items-center gap-1.5 uppercase tracking-wider">
            <span className="h-2 w-2" style={{ background: priority.color }} />
            {priority.label}
          </span>
        </p>
        <Link
          to={titleTo(project)}
          className={cn(
            'mt-0.5 block truncate font-semibold hover:text-cobalt',
            done && 'text-ink-soft line-through',
          )}
        >
          {task.title}
        </Link>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-soft md:hidden">
          <span className="h-2 w-2" style={{ background: project.color }} />
          {project.name}
        </p>
      </div>
      <Link
        to={projectTo(project)}
        className="hidden min-w-0 items-center gap-2 text-sm hover:text-cobalt md:flex"
      >
        <span
          className="h-2.5 w-2.5 shrink-0"
          style={{ background: project.color }}
        />
        <span className="truncate">{project.name}</span>
      </Link>
      <select
        value={task.status}
        onChange={(event) => onStatus(task, event.target.value as StatusKey)}
        aria-label={`Status of ${task.key}`}
        className={`${ROW_SELECT} col-start-2 md:col-start-auto`}
      >
        {STATUSES.map((status) => (
          <option key={status.k} value={status.k}>
            {status.label}
          </option>
        ))}
      </select>
      <div className="col-start-2 md:col-start-auto md:text-right">
        <DueCell task={task} />
      </div>
    </li>
  );
}

function StatsRow({ tasks }: { tasks: MyTask[] }) {
  const open = tasks.filter((task) => !isFinished(task.status));
  const overdue = open.filter((task) => daysTo(task.due) < 0).length;
  const today = open.filter((task) => daysTo(task.due) === 0).length;
  const stat = (label: string, value: number, danger = false) => (
    <div className="px-4 py-3 first:pl-0">
      <dt className="text-xs font-bold uppercase tracking-wider text-ink-soft">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 font-display text-2xl font-bold leading-tight',
          danger && value > 0 && 'text-red-600',
        )}
      >
        {value}
      </dd>
    </div>
  );
  return (
    <dl className="grid grid-cols-2 divide-x divide-ink-line border-y border-ink-line sm:grid-cols-4">
      {stat('Open', open.length)}
      {stat('Overdue', overdue, true)}
      {stat('Due today', today)}
      {stat('Completed', tasks.length - open.length)}
    </dl>
  );
}

/** The design's "nothing assigned" panel with the ghost list beside it. */
function EmptyTasksBlock() {
  const ghost = (width: string) => (
    <div className="mb-2 flex items-center gap-3 border border-dashed border-ink-soft/40 bg-white/70 p-3">
      <span className="h-4 w-4 border border-dashed border-ink-soft/50" />
      <div className="flex-1">
        <div className={`h-1.5 ${width} bg-ink-line`} />
        <div className="mt-2 h-1.5 w-1/4 bg-ink-line/70" />
      </div>
    </div>
  );
  return (
    <div className="grid border border-ink md:grid-cols-2">
      <div className="flex flex-col justify-center p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-wider text-ink-soft">
          Nothing assigned
        </p>
        <h2 className="mt-3 font-display text-3xl font-bold leading-[1.05] tracking-tight">
          You have no tasks yet
        </h2>
        <p className="mt-3 max-w-sm text-sm text-ink-soft">
          When a PM or a project lead assigns you a task, it shows up here,
          whichever project it belongs to.
        </p>
        <div className="mt-6">
          <Link to="/dashboard/projects" className={cn('inline-block', BTN)}>
            Go to Projects
          </Link>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="border-t border-ink bg-paper p-5 md:border-l md:border-t-0"
      >
        {ghost('w-3/4')}
        {ghost('w-1/2')}
        {ghost('w-2/3')}
      </div>
    </div>
  );
}

function TasksSkeleton({ label }: { label: string }) {
  const row = (index: number) => (
    <li
      key={index}
      className="flex items-center gap-3 border-b border-ink-line px-4 py-3 last:border-b-0"
    >
      <Skeleton className="h-4 w-4" />
      <div className="flex-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-4 w-2/3" />
      </div>
      <Skeleton className="hidden h-4 w-28 sm:block" />
      <Skeleton className="h-8 w-24" />
    </li>
  );
  return (
    <div role="status" aria-label={label} className="space-y-6">
      <div>
        <Skeleton className="h-9 w-52" />
        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-12 w-full" />
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 w-full max-w-[16rem]" />
        <Skeleton className="h-10 w-52" />
        <Skeleton className="h-10 w-44" />
      </div>
      <ul className="border border-ink-line">{[0, 1, 2, 3].map(row)}</ul>
    </div>
  );
}

interface CalendarViewProps {
  visible: MyTask[];
  all: MyTask[];
  projects: TaskProject[];
  month: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onDay: (key: string) => void;
  onClear: () => void;
}

function CalendarView({
  visible,
  all,
  projects,
  month,
  onPrev,
  onNext,
  onToday,
  onDay,
  onClear,
}: CalendarViewProps) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const startOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const weeks = Math.ceil(
    (startOffset + new Date(year, monthIndex + 1, 0).getDate()) / 7,
  );

  const byDate = new Map<string, MyTask[]>();
  sortTasks(visible).forEach((task) => {
    if (!task.due) return;
    const bucket = byDate.get(task.due);
    if (bucket) bucket.push(task);
    else byDate.set(task.due, [task]);
  });

  const todayKey = dayStr(0);
  const unscheduled = visible.filter((task) => !task.due).length;
  const monthLabel = month.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
  const now = new Date();
  const isCurrent =
    month.getFullYear() === now.getFullYear() &&
    month.getMonth() === now.getMonth();

  const cells = Array.from({ length: weeks * 7 }, (_, index) => {
    const date = new Date(year, monthIndex, 1 - startOffset + index);
    const key = date.toLocaleDateString('en-CA');
    const items = byDate.get(key) ?? [];
    const inMonth = date.getMonth() === monthIndex;
    const isToday = key === todayKey;

    const chips = items.slice(0, 3).map((task) => {
      const project = projectOf(projects, task.project);
      const late = !isFinished(task.status) && daysTo(task.due) < 0;
      return (
        <Link
          key={task.id}
          to={titleTo(project)}
          title={`${task.key}: ${task.title}`}
          className={cn(
            'mt-1 hidden truncate border-l-[3px] bg-paper px-1.5 py-0.5 text-xs font-semibold hover:bg-[#E9ECF7] sm:block',
            isFinished(task.status)
              ? 'text-ink-soft line-through'
              : late && 'text-red-600',
          )}
          style={{ borderColor: project.color }}
        >
          {task.title}
        </Link>
      );
    });
    const more =
      items.length > 3 ? (
        <button
          type="button"
          onClick={() => onDay(key)}
          className="mt-1 hidden text-xs font-semibold text-cobalt hover:underline sm:block"
        >
          +{items.length - 3} more
        </button>
      ) : null;
    const dots =
      items.length > 0 ? (
        <span className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
          {items.slice(0, 4).map((task) => (
            <span
              key={task.id}
              className="h-1.5 w-1.5"
              style={{
                background: projectOf(projects, task.project).color,
              }}
            />
          ))}
        </span>
      ) : null;
    const label =
      date.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }) +
      (items.length > 0
        ? `, ${items.length} task${items.length > 1 ? 's' : ''}`
        : '');

    return (
      <div
        key={key}
        className={cn(
          'min-h-[60px] border-b border-r border-ink-line p-1.5 sm:min-h-[112px]',
          inMonth ? 'bg-white' : 'bg-paper/70',
        )}
      >
        <button
          type="button"
          onClick={items.length > 0 ? () => onDay(key) : undefined}
          tabIndex={items.length > 0 ? undefined : -1}
          aria-label={label}
          className={cn(
            'block w-full text-left',
            items.length > 0 ? 'cursor-pointer' : 'cursor-default',
          )}
        >
          <span
            className={cn(
              'inline-block min-w-[1.5rem] px-1 text-center text-sm font-semibold',
              isToday
                ? 'bg-cobalt text-white'
                : inMonth
                  ? ''
                  : 'text-ink-soft/60',
            )}
          >
            {date.getDate()}
          </span>
          {dots}
        </button>
        {chips}
        {more}
      </div>
    );
  });

  const legend = (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
      {[...new Set(all.map((task) => task.project))].map((id) => {
        const project = projectOf(projects, id);
        return (
          <span key={id} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2" style={{ background: project.color }} />
            {project.name}
          </span>
        );
      })}
    </p>
  );

  const foot =
    unscheduled > 0 ? (
      <p className="mt-2 text-sm text-ink-soft">
        {unscheduled} task{unscheduled > 1 ? 's have' : ' has'} no due date, so{' '}
        {unscheduled > 1 ? 'they are' : 'it is'} not on the calendar. The list
        view shows {unscheduled > 1 ? 'them' : 'it'}.
      </p>
    ) : null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl font-bold tracking-tight">
          {monthLabel}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToday}
            disabled={isCurrent}
            className="border border-ink px-3.5 py-1.5 text-sm font-semibold hover:bg-ink hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit"
          >
            Today
          </button>
          <div className="flex border border-ink">
            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous month"
              className="px-3 py-1.5 text-lg leading-none hover:bg-ink hover:text-white"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Next month"
              className="border-l border-ink px-3 py-1.5 text-lg leading-none hover:bg-ink hover:text-white"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mb-3 border-l-4 border-sun bg-[#FFF8D6] px-3 py-2 text-sm">
          No tasks match these filters.{' '}
          <button
            type="button"
            onClick={onClear}
            className="font-semibold text-cobalt underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        </p>
      ) : null}

      {/* biome-ignore lint/a11y/useSemanticElements: the month is a CSS grid
          of day cells (ARIA grid), not a data table. */}
      <div
        role="grid"
        aria-label={monthLabel}
        className="grid grid-cols-7 border-l border-t border-ink-line"
      >
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name) => (
          <div
            key={name}
            className="border-b border-r border-ink-line bg-paper px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-soft"
          >
            {name}
          </div>
        ))}
        {cells}
      </div>

      {legend}
      {foot}
    </>
  );
}

interface DayDialogProps {
  day: string | null;
  items: MyTask[];
  projects: TaskProject[];
  onToggle: (task: MyTask, checked: boolean) => void;
  onStatus: (task: MyTask, status: StatusKey) => void;
  onClose: () => void;
}

/** Day chips open its tasks here — same row controls as the list. */
function DayDialog({
  day,
  items,
  projects,
  onToggle,
  onStatus,
  onClose,
}: DayDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (day && items.length > 0) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
      // Filters emptied the day while it was open — drop it so the chip
      // doesn't pop the dialog open again later.
      if (day) onClose();
    }
  }, [day, items.length, onClose]);

  const date = day ? new Date(`${day}T00:00:00`) : null;

  return (
    /* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss, Escape covered by onCancel */
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      aria-labelledby="day-title"
      className="fixed left-1/2 top-1/2 z-50 m-0 w-[94%] max-w-2xl -translate-x-1/2 -translate-y-1/2 border-2 border-ink p-0 shadow-[8px_8px_0_#14183A] [&::backdrop]:bg-ink/50"
    >
      <div className="flex items-start justify-between gap-4 border-b border-ink px-5 py-4">
        <div>
          <h2
            id="day-title"
            className="font-display text-xl font-bold tracking-tight"
          >
            {date
              ? date.toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })
              : ''}
          </h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            {items.length} task{items.length > 1 ? 's' : ''} due
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="border border-ink px-2.5 py-0.5 text-lg leading-none hover:bg-ink hover:text-white"
        >
          ×
        </button>
      </div>
      <ul className="max-h-[70vh] overflow-auto">
        {items.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            project={projectOf(projects, task.project)}
            onToggle={onToggle}
            onStatus={onStatus}
          />
        ))}
      </ul>
    </dialog>
  );
}

export function MyTasksPage() {
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

  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [tasksStatus, setTasksStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [tasksError, setTasksError] = useState<string[]>([]);
  // Retry bump — increments to re-run the fetch without other deps changing.
  const [tasksNonce, setTasksNonce] = useState(0);

  const taskProjects = useMemo<TaskProject[]>(
    () =>
      projects.map((project) => ({
        id: project.id,
        name: project.name,
        color: project.color,
      })),
    [projects],
  );

  const [q, setQ] = useState('');
  const [tab, setTab] = useState<TabKey>('open');
  const [project, setProject] = useState('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('due');
  const [view, setView] = useState<ViewKey>(readStoredView);
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [day, setDay] = useState<string | null>(null);

  const roleKey = authUser ? toRoleKey(authUser.role) : 'dev';

  useEffect(() => {
    document.title = 'My tasks · Nexus';
  }, []);

  // The API only serves tasks per project, so the page fans out one board
  // fetch per visible project and keeps rows assigned to me (board's load
  // pattern: cancelled flag, 401 → anonymous, one error state with retry).
  // HR renders the lock screen above this branch, so it never fetches.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tasksNonce is a retry bump — it must re-run the fetch without being read inside.
  useEffect(() => {
    if (projectsStatus !== 'ready' || authUser === null || roleKey === 'hr') {
      return;
    }
    let cancelled = false;
    setTasksStatus('loading');
    setTasksError([]);
    fetchMyTasks(projects, authUser.id)
      .then((rows) => {
        if (cancelled) return;
        setTasks(rows);
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
  }, [projects, projectsStatus, authUser, tasksNonce, dispatch]);

  // The sidebar badge reads this — keyed by user, and kept after unmount so
  // navigating away doesn't blank the count it just helped load.
  useEffect(() => {
    if (tasksStatus === 'ready' && authUser !== null) {
      publishOpenCount(countOpen(tasks), authUser.id);
    }
  }, [tasks, tasksStatus, authUser]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter(
      (task) =>
        (tab === 'all' ||
          (tab === 'done'
            ? isFinished(task.status)
            : !isFinished(task.status))) &&
        (project === 'all' || task.project === project) &&
        (!needle || `${task.title} ${task.key}`.toLowerCase().includes(needle)),
    );
  }, [tasks, q, tab, project]);

  const dayItems = useMemo(
    () => (day ? sortTasks(visible.filter((task) => task.due === day)) : []),
    [day, visible],
  );

  const closeDay = useCallback(() => setDay(null), []);

  /**
   * Optimistic status move: flip locally at once (the checkbox/select feel),
   * then `PATCH /tasks/:id/status` — I'm the assignee, so the API's status
   * rights always admit me. A failure rolls the list back and toasts, the
   * board's moveTask pattern; the server response re-syncs on success.
   */
  const patchStatus = (
    task: MyTask,
    next: StatusKey,
    message: string,
  ): void => {
    if (task.status === next) return;
    const before = tasks;
    setTasks((previous) =>
      previous.map((row) =>
        row.id === task.id ? { ...row, prev: row.status, status: next } : row,
      ),
    );
    show(message);
    changeTaskStatus(task.id, toApiStatus(next))
      .then(({ task: updated }) => {
        setTasks((previous) =>
          previous.map((row) =>
            row.id === updated.id
              ? { ...row, status: fromApiStatus(updated.status) }
              : row,
          ),
        );
      })
      .catch((error: unknown) => {
        setTasks(before);
        show(apiMessage(error));
      });
  };

  const handleToggle = (task: MyTask, checked: boolean): void => {
    const next: StatusKey = checked
      ? 'done'
      : task.prev && task.prev !== 'done'
        ? task.prev
        : 'progress';
    patchStatus(
      task,
      next,
      checked ? `${task.key} marked done` : `${task.key} reopened`,
    );
  };

  const handleStatus = (task: MyTask, status: StatusKey): void => {
    patchStatus(task, status, `${task.key} moved to ${statusLabel(status)}`);
  };

  const clearFilters = (): void => {
    setQ('');
    setTab('open');
    setProject('all');
  };

  const changeView = (next: ViewKey): void => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Private mode — the choice just won't persist.
    }
  };

  const openCount = countOpen(tasks);
  const doneCount = tasks.length - openCount;
  const groups = groupTasks(visible, groupBy, taskProjects);

  const tabButton = (key: TabKey, label: string, count: number) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      aria-pressed={tab === key}
      className={cn(
        'px-3.5 py-2 text-sm font-semibold',
        tab === key
          ? 'bg-ink text-white'
          : 'text-ink-soft hover:bg-paper hover:text-ink',
      )}
    >
      {label}{' '}
      <span className={tab === key ? 'text-white/70' : 'text-ink-soft'}>
        {count}
      </span>
    </button>
  );

  const crumb = org ? (
    <>
      <span>{org.name}</span>
      <span className="mx-1.5 text-ink-line">/</span>
      <span className="font-semibold text-ink">My tasks</span>
    </>
  ) : (
    <span className="font-semibold text-ink">My tasks</span>
  );

  let body: ReactNode;
  if (orgStatus === 'unknown' || orgStatus === 'loading') {
    body = <TasksSkeleton label="Loading organization" />;
  } else if (orgStatus === 'error') {
    body = (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-[15px] font-semibold text-ink">
          Couldn&apos;t load your organization.
        </p>
        <p className="max-w-sm text-sm text-ink-soft">{orgError.join(' ')}</p>
        <button type="button" onClick={retryOrg} className={BTN}>
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
          Tasks live inside an organization — set yours up, then come back here.
        </p>
        <Link to="/dashboard" className={BTN}>
          Go to Organization
        </Link>
      </div>
    );
  } else if (roleKey === 'hr') {
    body = (
      <div className="max-w-2xl border border-ink p-8 sm:p-10">
        <span className="flex h-12 w-12 items-center justify-center bg-paper text-ink-soft">
          <LockIcon className="h-6 w-6" />
        </span>
        <h1 className="mt-5 font-display text-3xl font-bold leading-tight tracking-tight">
          Tasks aren&apos;t part of the HR role
        </h1>
        <p className="mt-3 max-w-md text-sm text-ink-soft">
          HR looks after the people in {org.name}, so no tasks are assigned to
          you.
        </p>
        <Link to="/dashboard" className={cn('mt-6 inline-block', BTN)}>
          Go to Organization
        </Link>
      </div>
    );
  } else if (projectsStatus === 'unknown' || projectsStatus === 'loading') {
    body = <TasksSkeleton label="Loading tasks" />;
  } else if (projectsStatus === 'error') {
    body = (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-[15px] font-semibold text-ink">
          Couldn&apos;t load your projects.
        </p>
        <p className="max-w-sm text-sm text-ink-soft">
          {projectsError.join(' ')}
        </p>
        <button type="button" onClick={retryProjects} className={BTN}>
          Retry
        </button>
      </div>
    );
  } else if (tasksStatus === 'loading') {
    body = <TasksSkeleton label="Loading tasks" />;
  } else if (tasksStatus === 'error') {
    body = (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-[15px] font-semibold text-ink">
          Couldn&apos;t load your tasks.
        </p>
        <p className="max-w-sm text-sm text-ink-soft">{tasksError.join(' ')}</p>
        <button
          type="button"
          onClick={() => setTasksNonce((nonce) => nonce + 1)}
          className={BTN}
        >
          Retry
        </button>
      </div>
    );
  } else if (tasks.length === 0) {
    body = <EmptyTasksBlock />;
  } else {
    const emptyMatch =
      tab === 'open' && project === 'all' && !q.trim() ? (
        <p className="border border-dashed border-ink-line p-8 text-center text-sm text-ink-soft">
          <strong className="text-ink">All caught up.</strong> You have finished
          everything assigned to you.
        </p>
      ) : (
        <p className="border border-dashed border-ink-line p-8 text-center text-sm text-ink-soft">
          No tasks match these filters.{' '}
          <button
            type="button"
            onClick={clearFilters}
            className="font-semibold text-cobalt underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        </p>
      );

    const area =
      view === 'calendar' ? (
        <CalendarView
          visible={visible}
          all={tasks}
          projects={taskProjects}
          month={month}
          onPrev={() =>
            setMonth(
              (previous) =>
                new Date(previous.getFullYear(), previous.getMonth() - 1, 1),
            )
          }
          onNext={() =>
            setMonth(
              (previous) =>
                new Date(previous.getFullYear(), previous.getMonth() + 1, 1),
            )
          }
          onToday={() => {
            const now = new Date();
            setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
          }}
          onDay={(key) => setDay(key)}
          onClear={clearFilters}
        />
      ) : visible.length === 0 ? (
        emptyMatch
      ) : (
        groups.map((group) => (
          <section key={group.label} className="mb-8" aria-label={group.label}>
            <h2
              className={cn(
                'flex items-center gap-2 border-b-2 pb-2 text-xs font-bold uppercase tracking-wider',
                group.danger && 'text-red-600',
              )}
              style={{ borderColor: group.color }}
            >
              <span
                className="h-2.5 w-2.5"
                style={{ background: group.color }}
              />
              {group.label}
              <span className="bg-paper px-1.5 text-ink-soft">
                {group.items.length}
              </span>
            </h2>
            <ul className="border border-t-0 border-ink-line">
              {group.items.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  project={projectOf(taskProjects, task.project)}
                  onToggle={handleToggle}
                  onStatus={handleStatus}
                />
              ))}
            </ul>
          </section>
        ))
      );

    body = (
      <>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[2rem] font-bold leading-none tracking-tight">
              My tasks{' '}
              <span className="ml-1 align-middle font-sans text-sm font-bold text-ink-soft">
                {pad2(openCount)} open
              </span>
            </h1>
            <p className="mt-2 text-sm text-ink-soft">
              Everything assigned to you, across every project.
            </p>
          </div>
          <fieldset aria-label="View" className="flex border border-ink">
            <button
              type="button"
              onClick={() => changeView('list')}
              aria-pressed={view === 'list'}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 text-sm font-semibold',
                view === 'list' ? 'bg-ink text-white' : 'hover:bg-paper',
              )}
            >
              <svg
                className="h-[18px] w-[18px] shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="square"
                aria-hidden="true"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              List
            </button>
            <button
              type="button"
              onClick={() => changeView('calendar')}
              aria-pressed={view === 'calendar'}
              className={cn(
                'flex items-center gap-2 border-l border-ink px-3.5 py-2 text-sm font-semibold',
                view === 'calendar' ? 'bg-ink text-white' : 'hover:bg-paper',
              )}
            >
              <svg
                className="h-[18px] w-[18px] shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="square"
                aria-hidden="true"
              >
                <path d="M4 5h16v15H4zM4 10h16M8 3v4M16 3v4" />
              </svg>
              Calendar
            </button>
          </fieldset>
        </div>

        <div id="stats" className="mt-6">
          <StatsRow tasks={tasks} />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search my tasks"
            autoComplete="off"
            aria-label="Search my tasks"
            className={`${INPUT} max-w-[16rem] py-2`}
          />
          <fieldset className="flex border border-ink" aria-label="Show">
            {tabButton('open', 'Open', openCount)}
            {tabButton('done', 'Done', doneCount)}
            {tabButton('all', 'All', tasks.length)}
          </fieldset>
          <select
            value={project}
            onChange={(event) => setProject(event.target.value)}
            aria-label="Project"
            className={SELECT_SM}
          >
            <option value="all">All projects</option>
            {taskProjects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {view === 'list' ? (
            <label className="ml-auto flex items-center gap-2 text-sm text-ink-soft">
              Group by{' '}
              <select
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value as GroupBy)}
                className={cn(SELECT_SM, 'text-ink')}
              >
                <option value="due">Due date</option>
                <option value="project">Project</option>
              </select>
            </label>
          ) : null}
        </div>

        <div id="list" className="mt-6">
          {area}
        </div>
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
      onLogout={() => {
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
      }}
    >
      {/* Keyed on role/tab/view — typing in search must not remount the
          view (the input would lose focus); everything else replays `view-in`. */}
      <div key={`${roleKey}-${tab}-${project}-${view}`} className="view-in">
        {body}
      </div>
      <DayDialog
        day={day}
        items={dayItems}
        projects={taskProjects}
        onToggle={handleToggle}
        onStatus={handleStatus}
        onClose={closeDay}
      />
      {toastElement}
    </AppShell>
  );
}
