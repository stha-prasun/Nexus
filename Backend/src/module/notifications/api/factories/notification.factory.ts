import { Injectable } from '@nestjs/common';
import {
  DUE_REMINDER_TYPE,
  DUE_SOON_TITLE,
  DUE_TODAY_TITLE,
  dueSoonDedupeKey,
  dueTodayDedupeKey,
  TASK_ASSIGNED_TITLE,
  TASK_ASSIGNED_TYPE,
} from '../constants/notifications.constants';
import type { NotificationInsert } from '../repositories/notifications.repository';

/**
 * Which reminder window a candidate is inside — owned here because the
 * window is what selects the title and dedupe key (the tasks scheduler
 * imports this type for `reminderWindowFor`; direction Tasks →
 * Notifications only, plan §4).
 */
export type ReminderWindow = 'due_soon' | 'due_today';

/**
 * Structural snapshots instead of the tasks module's `Task` /
 * `ReminderCandidate` types: this module must never import TasksModule's
 * code (one-way dependency, §4), and TypeScript's structural typing lets
 * those entities satisfy these shapes without an import.
 */
export interface AssignedTaskSnapshot {
  id: string;
  key: string;
  title: string;
}

export interface ReminderTaskSnapshot {
  assigneeId: string;
  taskId: string;
  key: string;
  title: string;
  dueDate: string;
}

/**
 * The single construction point for notification rows (the same role
 * `TaskFactory` plays for tasks and `UserFactory` for users). Every
 * `task_assigned` / `due_reminder` insert — assignment writes inside the
 * tasks mutation transaction and the 15-minute reminder sweep — is built
 * here so titles, body snapshots and dedupe keys can never drift between
 * callers (plan §5/§7).
 *
 * Bodies and titles are **snapshots**: later task edits must not rewrite
 * notification history.
 */
@Injectable()
export class NotificationFactory {
  /**
   * `task_assigned` row for a fresh assignment. `dedupeKey: null` —
   * assignment rows never conflict on the (task, user, dedupe) unique
   * (PG treats NULLs as distinct), so reassignment always inserts.
   */
  createTaskAssigned(
    assigneeId: string,
    task: AssignedTaskSnapshot,
    projectName: string,
  ): NotificationInsert {
    return {
      userId: assigneeId,
      type: TASK_ASSIGNED_TYPE,
      taskId: task.id,
      title: TASK_ASSIGNED_TITLE,
      body: `${task.key} "${task.title}" — ${projectName}`,
      dedupeKey: null,
    };
  }

  /**
   * `due_reminder` row for one open window. The dedupe key embeds the due
   * date (`due_soon:2026-06-16`): re-running the sweep for the same date
   * is a no-op (`ON CONFLICT DO NOTHING`), while *changing* a task's due
   * date re-arms both windows for the new date and leaves old rows as
   * history (plan §7).
   */
  createDueReminder(
    candidate: ReminderTaskSnapshot,
    window: ReminderWindow,
  ): NotificationInsert {
    return {
      userId: candidate.assigneeId,
      type: DUE_REMINDER_TYPE,
      taskId: candidate.taskId,
      title: window === 'due_soon' ? DUE_SOON_TITLE : DUE_TODAY_TITLE,
      body: `${candidate.key} "${candidate.title}" — due ${candidate.dueDate}.`,
      dedupeKey:
        window === 'due_soon'
          ? dueSoonDedupeKey(candidate.dueDate)
          : dueTodayDedupeKey(candidate.dueDate),
    };
  }
}
