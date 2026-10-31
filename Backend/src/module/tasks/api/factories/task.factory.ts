import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_TASK_PRIORITY,
  DEFAULT_TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
  taskKeyPrefix,
} from '../constants/tasks.constants';
import type { CreateTaskDto } from '../dto/create-task.dto';

/** Row material handed to the repository's create transaction. */
export interface TaskCreateInput {
  id: string;
  projectId: string;
  /**
   * Key material only (`WR`) — the repository appends the seq it allocated
   * under the advisory lock, so factory and DB can never disagree about
   * which seq the key belongs to (plan §8.2).
   */
  keyPrefix: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string | null;
  dueDate: string | null;
  createdByUserId: string;
  createdAt: Date;
}

/**
 * The single construction point for `Task` rows. `seq` and the final `key`
 * are allocated by the repository (advisory-locked `projects.taskCounter`
 * increment — plan §8.2); this factory derives the key *prefix* from the
 * project name and stamps `createdAt`. Defaults for status/priority live
 * here so every persisted task shares one code path with the DTO/schema
 * defaults.
 */
@Injectable()
export class TaskFactory {
  create(
    dto: CreateTaskDto,
    context: {
      projectId: string;
      projectName: string;
      assigneeId: string | null;
      createdByUserId: string;
    },
  ): TaskCreateInput {
    const now = new Date();
    return {
      id: randomUUID(),
      projectId: context.projectId,
      keyPrefix: taskKeyPrefix(context.projectName),
      title: dto.title,
      description: dto.description ?? '',
      status: dto.status ?? DEFAULT_TASK_STATUS,
      priority: dto.priority ?? DEFAULT_TASK_PRIORITY,
      assigneeId: context.assigneeId,
      dueDate: dto.dueDate ?? null,
      createdByUserId: context.createdByUserId,
      createdAt: now,
    };
  }
}
