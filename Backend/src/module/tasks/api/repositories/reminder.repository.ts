import { Inject, Injectable } from '@nestjs/common';
import { and, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import { tasks } from '../../../database/schema';
import { FINISHED_TASK_STATUSES } from '../constants/tasks.constants';

/** One task the sweep may remind about (window decided by the scheduler). */
export interface ReminderCandidate {
  taskId: string;
  assigneeId: string;
  key: string;
  title: string;
  dueDate: string;
}

/**
 * Sweep query for the due-date reminders (plan §7). Eligibility is decided
 * here in one indexed read:
 *
 * - assigned + dated + unfinished (`status NOT IN done/resolved` — uses the
 *   partial `(status, dueDate)` index), and
 * - `dueDate IN (today, tomorrow)` — the only two dates either window can
 *   ever open on, so the scan stays bounded regardless of table size;
 * - **the assignee is still an ACTIVE project member** (review fix #9
 *   backstop): even if some removal path ever missed the unassign hooks
 *   (§8.3), nobody without a live membership receives a stray reminder.
 *
 * Window timing (day-before vs 09:00-on-due-day) is a pure function in the
 * scheduler — here we only narrow the candidate set.
 */
@Injectable()
export class ReminderRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findDueCandidates(
    today: string,
    tomorrow: string,
  ): Promise<ReminderCandidate[]> {
    const rows = (await this.db
      .select({
        taskId: tasks.id,
        assigneeId: tasks.assigneeId,
        key: tasks.key,
        title: tasks.title,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .where(
        and(
          isNotNull(tasks.assigneeId),
          isNotNull(tasks.dueDate),
          notInArray(tasks.status, [...FINISHED_TASK_STATUSES]),
          inArray(tasks.dueDate, [today, tomorrow]),
          // Correlated EXISTS: same join the plan spells out — org
          // membership must still be ACTIVE for this project.
          sql`EXISTS (SELECT 1 FROM project_members pm
              JOIN organization_members om
                ON om.id = pm.organization_member_id AND om.status = 'ACTIVE'
              WHERE pm.project_id = ${tasks.projectId}
                AND pm.user_id = ${tasks.assigneeId})`,
        ),
      )) as ReminderCandidate[];
    // isNotNull narrows at runtime; Drizzle keeps the nullable type.
    return rows;
  }
}
