import {
  listProjectTasks,
  type Project,
  type Task,
  type TaskPriority,
} from '@/lib/api';
import { dayStr, fromApiStatus, type StatusKey } from '@/lib/board';

/** My-tasks domain — task shapes, the API mapping and grouping. */

/** A project the tasks hang off — always a real store project now. */
export interface TaskProject {
  id: string;
  name: string;
  color: string;
}

export interface MyTask {
  id: string;
  key: string;
  title: string;
  status: StatusKey;
  priority: TaskPriority;
  /** YYYY-MM-DD — '' when the API task has no due date. */
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

/** API task → MyTask — the due date is optional (`''` = none). */
export const fromApiMyTask = (task: Task): MyTask => ({
  id: task.id,
  key: task.key,
  title: task.title,
  status: fromApiStatus(task.status),
  priority: task.priority,
  due: task.dueDate ?? '',
  project: task.projectId,
  prev: null,
});

/**
 * "My tasks" as one list: the API only serves tasks per project, so this
 * fans out one board fetch per visible project (Admin sees every project,
 * PM/Dev only their memberships — the server already decided that list),
 * then keeps the rows assigned to `userId`. Small-roster scale (plan §1):
 * no pagination, `Promise.all` fails the whole load into one error state.
 */
export async function fetchMyTasks(
  projects: Project[],
  userId: string,
): Promise<MyTask[]> {
  const lists = await Promise.all(
    projects.map((project) => listProjectTasks(project.id)),
  );
  return lists
    .flatMap(({ tasks }) => tasks)
    .filter((task) => task.assignee?.id === userId)
    .map(fromApiMyTask);
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
 * Undated tasks sort last and land in "Later" (their `daysTo` is NaN).
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
 * Live open-count shared with the sidebar badge: the My-tasks page
 * publishes after every load and local change, and the sidebar fetches it
 * once itself when nothing has published for the signed-in user yet. Keyed
 * by user so a re-login as someone else never shows the previous user's
 * number — `null` means "unknown", and the badge simply stays hidden.
 */
export interface OpenCount {
  count: number;
  userId: string;
}

let published: OpenCount | null = null;
const openListeners = new Set<() => void>();

export const subscribeOpenCount = (listener: () => void): (() => void) => {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
};

export const getOpenCount = (): OpenCount | null => published;

export const publishOpenCount = (count: number, userId: string): void => {
  if (published && published.count === count && published.userId === userId) {
    return;
  }
  published = { count, userId };
  openListeners.forEach((listener) => {
    listener();
  });
};
