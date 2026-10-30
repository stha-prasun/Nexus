import { cn } from 'cn';
import { Link } from 'react-router';

/** Tab keys — which of the three project sections is showing. */
export type ProjectTabKey = 'overview' | 'board' | 'documents';

interface ProjectTabsProps {
  projectId: string;
  active: ProjectTabKey;
  /** Live task count when the caller holds one (the board); else the demo seed. */
  taskCount?: number;
  /** Live document count when the caller holds one (documents); else the demo seed. */
  docCount?: number;
}

/**
 * The section bar shared by Overview / Board / Documents (project.html).
 * `no-scrollbar` keeps the Windows scrollbar track off the row — the three
 * items always fit; the overflow only matters on very narrow screens.
 */
export function ProjectTabs({
  projectId,
  active,
  taskCount = 12,
  docCount = 4,
}: ProjectTabsProps) {
  const base = `/dashboard/projects/${projectId}`;
  const item = (
    key: ProjectTabKey,
    label: string,
    to: string,
    count?: number,
  ) => (
    <Link
      to={to}
      key={key}
      aria-current={active === key ? 'page' : undefined}
      className={cn(
        '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold',
        active === key
          ? 'border-cobalt text-ink'
          : 'border-transparent text-ink-soft hover:text-ink',
      )}
    >
      {label}
      {count != null ? (
        <span className="bg-paper px-1.5 text-xs font-bold text-ink-soft">
          {count}
        </span>
      ) : null}
    </Link>
  );

  return (
    <nav
      aria-label="Project sections"
      className="no-scrollbar mt-5 flex overflow-x-auto border-b border-ink-line"
    >
      {item('overview', 'Overview', base)}
      {item('board', 'Board', `${base}/board`, taskCount)}
      {item('documents', 'Documents', `${base}/documents`, docCount)}
    </nav>
  );
}
