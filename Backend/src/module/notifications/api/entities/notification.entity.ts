import type { NotificationType } from '../constants/notifications.constants';

export interface NotificationProps {
  id: string;
  userId: string;
  type: NotificationType;
  taskId: string | null;
  /** Snapshot — never re-read from the task after insert. */
  title: string;
  /** Snapshot message text — survives task rename/reassign. */
  body: string;
  dedupeKey: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * Domain entity for one notifications row. Never serialized directly —
 * controllers map it through `NotificationResponseDto` so only the intended
 * fields leave the API (mirrors Project/Task entities).
 */
export class Notification {
  constructor(private readonly props: NotificationProps) {}

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get type(): NotificationType {
    return this.props.type;
  }

  get taskId(): string | null {
    return this.props.taskId;
  }

  get title(): string {
    return this.props.title;
  }

  get body(): string {
    return this.props.body;
  }

  get dedupeKey(): string | null {
    return this.props.dedupeKey;
  }

  get readAt(): Date | null {
    return this.props.readAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
