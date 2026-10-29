/** Shared board domain — statuses, task keys and due-chip copy (project-board.html). */

export type StatusKey =
  | 'todo'
  | 'progress'
  | 'review'
  | 'hold'
  | 'testing'
  | 'resolved'
  | 'done';

export interface StatusDef {
  k: StatusKey;
  label: string;
  color: string;
}

export const STATUSES: StatusDef[] = [
  { k: 'todo', label: 'To do', color: '#8A90AD' },
  { k: 'progress', label: 'In progress', color: '#1F2FE0' },
  { k: 'review', label: 'In review', color: '#FFD83D' },
  { k: 'hold', label: 'On hold', color: '#E5484D' },
  { k: 'testing', label: 'Testing', color: '#0EA5A5' },
  { k: 'resolved', label: 'Resolved', color: '#2FB67C' },
  { k: 'done', label: 'Done', color: '#14183A' },
];

export const statusLabel = (k: StatusKey): string =>
  STATUSES.find((status) => status.k === k)?.label ?? k;

/** Task-key prefix — first letters of up to three words of the project name (WR-4). */
export const keyPrefix = (name: string): string =>
  name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 3)
    .toUpperCase();

/** Local calendar date N days from today — the YYYY-MM-DD a date input wants. */
export const dayStr = (offset: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString('en-CA');
};

export interface DueChip {
  text: string;
  /** Overdue and unfinished — rendered bold red with the square marker. */
  late: boolean;
}

/** Due-chip copy: Today / Tomorrow / "3d overdue" / "Oct 22". */
export const dueChip = (due: string | null, status: StatusKey): DueChip => {
  if (!due) return { text: '', late: false };
  const n = Math.round(
    (new Date(`${due}T00:00:00`).getTime() -
      new Date(`${dayStr(0)}T00:00:00`).getTime()) /
      86_400_000,
  );
  const finished = status === 'done' || status === 'resolved';
  const text =
    n === 0
      ? 'Today'
      : n === 1
        ? 'Tomorrow'
        : n < 0
          ? `${-n}d overdue`
          : new Date(`${due}T00:00:00`).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            });
  return { text, late: n < 0 && !finished };
};
