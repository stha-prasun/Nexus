import type { Project, TaskPriority } from '@/lib/api';
import { dayStr, keyPrefix, type StatusKey } from '@/lib/board';

/** My-tasks domain — task shapes, the demo seed and grouping (my-tasks.html). */

/** A project the seeded tasks hang off — real (Redux) or demo fallback. */
export interface TaskProject {
  id: string;
  name: string;
  color: string;
  /** Demo-fallback rows link to the projects list, not a (missing) board. */
  real: boolean;
}

export interface MyTask {
  id: string;
  key: string;
  title: string;
  status: StatusKey;
  priority: TaskPriority;
  /** YYYY-MM-DD — every seeded task has a due date. */
  due: string;
  /** TaskProject.id. */
  project: string;
  /** Status the done-checkbox restores on uncheck. */
  prev: StatusKey | null;
}

export interface TaskGroup {
  label: string;
  color: string;
  items: MyTask[];
  /** Overdue bucket — rendered red. */
  danger?: boolean;
}

export const PRIORITIES: Record<
  TaskPriority,
  { label: string; color: string; rank: number }
> = {
  urgent: { label: 'Urgent', color: '#E5484D', rank: 0 },
  high: { label: 'High', color: '#F59E0B', rank: 1 },
  medium: { label: 'Medium', color: '#1F2FE0', rank: 2 },
  low: { label: 'Low', color: '#8A90AD', rank: 3 },
};

/** [title, status, priority, due offset in days]. */
type SeedRow = [string, StatusKey, TaskPriority, number];

/**
 * The design's three seed groups (my-tasks.html), dealt round-robin across
 * whichever projects exist — so one project gets group 1, two get 1+2, five
 * cycle back to group 1. Every row is assigned to "you"; the prototype's
 * assignee filter is gone with the `?as=` viewer.
 */
const SEED_GROUPS: SeedRow[][] = [
  [
    ['Finalize homepage copy', 'done', 'medium', -6],
    ['Export brand assets', 'done', 'low', -5],
    ['Set up analytics', 'resolved', 'medium', -2],
    ['Update API docs', 'testing', 'high', 1],
    ['Fix checkout timeout', 'review', 'urgent', 0],
    ['Write release notes', 'review', 'low', 3],
    ['Review mobile layout', 'progress', 'high', 1],
    ['Hero animation', 'progress', 'medium', 4],
    ['Waiting on legal for cookie banner', 'hold', 'medium', -1],
    ['Migrate blog posts', 'todo', 'medium', 7],
    ['Audit accessibility', 'todo', 'high', 6],
    ['Set up staging redirects', 'todo', 'low', 9],
  ],
  [
    ['Push notifications', 'progress', 'high', 2],
    ['Onboarding flow', 'review', 'medium', 1],
    ['App store listing', 'todo', 'low', 12],
    ['Crash reporting', 'done', 'medium', -3],
  ],
  [
    ['Logo shortlist', 'review', 'high', 0],
    ['Color palette', 'progress', 'medium', 3],
    ['Type specimen', 'todo', 'low', 8],
  ],
];

/** Stand-ins when the store has no projects — the page always has content. */
const DEMO_PROJECTS: TaskProject[] = [
  { id: 'demo-1', name: 'Website relaunch', color: '#FFD83D', real: false },
  { id: 'demo-2', name: 'Mobile app', color: '#2FB67C', real: false },
  { id: 'demo-3', name: 'Brand refresh', color: '#E5484D', real: false },
];

/**
 * Demo tasks for the signed-in user — frontend-only until `GET /me/tasks`
 * exists. Real projects seed first; an empty store falls back to the design's
 * three demo projects so the list and calendar always render.
 */
export function seedMyTasks(projects: Project[]): {
  projects: TaskProject[];
  tasks: MyTask[];
} {
  const real: TaskProject[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    color: project.color,
    real: true,
  }));
  const list = real.length > 0 ? real : DEMO_PROJECTS;
  const tasks: MyTask[] = [];
  list.forEach((project, index) => {
    const rows = SEED_GROUPS[index % SEED_GROUPS.length] ?? SEED_GROUPS[0];
    const prefix = keyPrefix(project.name);
    rows.forEach(([title, status, priority, offset], row) => {
      tasks.push({
        id: `${project.id}-${row}`,
        key: `${prefix}-${row + 1}`,
        title,
        status,
        priority,
        due: dayStr(offset),
        project: project.id,
        prev: null,
      });
    });
  });
  return { projects: list, tasks };
}

export const isFinished = (status: StatusKey): boolean =>
  status === 'done' || status === 'resolved';

/** Whole days until the due date (negative = overdue). */
export const daysTo = (due: string): number =>
  Math.round(
    (new Date(`${due}T00:00:00`).getTime() -
      new Date(`${dayStr(0)}T00:00:00`).getTime()) /
      86_400_000,
  );

/** Due, then priority — the prototype's sortTasks. */
export const sortTasks = (list: MyTask[]): MyTask[] =>
  [...list].sort(
    (a, b) =>
      (a.due || '9999').localeCompare(b.due || '9999') ||
      PRIORITIES[a.priority].rank - PRIORITIES[b.priority].rank,
  );

export type GroupBy = 'due' | 'project';

/**
 * Due-date buckets (overdue → completed) or one group per project — the
 * prototype's groupsOf, minus the empty-bucket filter the caller applies.
 */
export function groupTasks(
  list: MyTask[],
  groupBy: GroupBy,
  projects: TaskProject[],
): TaskGroup[] {
  if (groupBy === 'project') {
    return projects
      .map((project) => ({
        label: project.name,
        color: project.color,
        items: sortTasks(list.filter((task) => task.project === project.id)),
      }))
      .filter((group) => group.items.length > 0);
  }
  const bucket = (task: MyTask): string => {
    if (isFinished(task.status)) return 'done';
    const n = daysTo(task.due);
    return n < 0 ? 'overdue' : n === 0 ? 'today' : n <= 7 ? 'week' : 'later';
  };
  const defs: [string, string, string, boolean][] = [
    ['overdue', 'Overdue', '#E5484D', true],
    ['today', 'Today', '#1F2FE0', false],
    ['week', 'Next 7 days', '#14183A', false],
    ['later', 'Later', '#8A90AD', false],
    ['done', 'Completed', '#2FB67C', false],
  ];
  return defs
    .map(([key, label, color, danger]) => ({
      label,
      color,
      danger,
      items: sortTasks(list.filter((task) => bucket(task) === key)),
    }))
    .filter((group) => group.items.length > 0);
}

/** Open tasks — the sidebar's My-tasks badge. */
export const countOpen = (tasks: MyTask[]): number =>
  tasks.filter((task) => !isFinished(task.status)).length;

/**
 * Live open-count shared with the sidebar: the page publishes after every
 * local change, and `null` on unmount so the badge falls back to the seed
 * count computed from the store. Tiny external store — the page's task list
 * stays local state until `GET /me/tasks` gives it one real source.
 */
let publishedOpen: number | null = null;
const openListeners = new Set<() => void>();

export const subscribeOpenCount = (listener: () => void): (() => void) => {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
};

export const getOpenCount = (): number | null => publishedOpen;

export const publishOpenCount = (count: number | null): void => {
  if (count === publishedOpen) return;
  publishedOpen = count;
  openListeners.forEach((listener) => {
    listener();
  });
};
