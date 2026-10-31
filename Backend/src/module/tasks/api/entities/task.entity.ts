import type { TaskPriority, TaskStatus } from '../constants/tasks.constants';

/** Assignee summary rendered as a board avatar — or null when unassigned. */
export interface TaskAssigneeSummary {
  id: string;
  name: string;
  email: string;
}

export interface TaskProps {
  id: string;
  projectId: string;
  seq: number;
  /** Immutable `WR-4` — stored at creation, never recomputed. */
  key: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: TaskAssigneeSummary | null;
  /** Date-only `YYYY-MM-DD` in UTC, or null (no due date). */
  dueDate: string | null;
  createdByUserId: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Domain entity for one tasks row (the hydrated view — assignee summary
 * included so the board renders avatars without a second fetch). Never
 * serialized directly: controllers map through `TaskResponseDto`.
 */
export class Task {
  constructor(private readonly props: TaskProps) {}

  get id(): string {
    return this.props.id;
  }

  get projectId(): string {
    return this.props.projectId;
  }

  get seq(): number {
    return this.props.seq;
  }

  get key(): string {
    return this.props.key;
  }

  get title(): string {
    return this.props.title;
  }

  get description(): string {
    return this.props.description;
  }

  get status(): TaskStatus {
    return this.props.status;
  }

  get priority(): TaskPriority {
    return this.props.priority;
  }

  get assignee(): TaskAssigneeSummary | null {
    return this.props.assignee;
  }

  get dueDate(): string | null {
    return this.props.dueDate;
  }

  get createdByUserId(): string {
    return this.props.createdByUserId;
  }

  get createdByName(): string {
    return this.props.createdByName;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
