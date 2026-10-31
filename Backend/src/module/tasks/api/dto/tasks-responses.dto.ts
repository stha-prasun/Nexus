import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TASK_PRIORITIES, TASK_STATUSES } from '../constants/tasks.constants';
import type { Task, TaskAssigneeSummary } from '../entities/task.entity';

export class TaskAssigneeResponseDto {
  @ApiProperty({ example: '00000000-0000-4000-8000-000000000031' })
  id!: string;

  @ApiProperty({ example: 'Grace' })
  name!: string;

  @ApiProperty({ example: 'grace@example.com' })
  email!: string;
}

export class TaskResponseDto {
  @ApiProperty({ example: '00000000-0000-4000-8000-000000000004' })
  id!: string;

  @ApiProperty({ example: '00000000-0000-4000-8000-000000000030' })
  projectId!: string;

  @ApiProperty({ example: 4, description: 'Per-project monotonic sequence.' })
  seq!: number;

  @ApiProperty({
    example: 'WR-4',
    maxLength: 20,
    description: 'Immutable key — stored at creation, survives renames.',
  })
  key!: string;

  @ApiProperty({ example: 'Wire up auth flow', maxLength: 200 })
  title!: string;

  @ApiProperty({ example: 'Sessions and guards.', maxLength: 5000 })
  description!: string;

  @ApiProperty({ enum: [...TASK_STATUSES], example: 'in_progress' })
  status!: (typeof TASK_STATUSES)[number];

  @ApiProperty({ enum: [...TASK_PRIORITIES], example: 'high' })
  priority!: (typeof TASK_PRIORITIES)[number];

  @ApiProperty({
    nullable: true,
    type: TaskAssigneeResponseDto,
    description: 'Board avatar payload — null when unassigned.',
  })
  assignee!: TaskAssigneeResponseDto | null;

  @ApiPropertyOptional({
    example: '2026-11-05',
    nullable: true,
    description: 'Date-only, UTC. Null = no due date.',
  })
  dueDate!: string | null;

  @ApiProperty({ example: '00000000-0000-4000-8000-000000000007' })
  createdByUserId!: string;

  @ApiProperty({ example: 'Maya' })
  createdByName!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-01-02T00:00:00.000Z' })
  updatedAt!: Date;
}

export class ListTasksResponseDto {
  @ApiProperty({ type: [TaskResponseDto] })
  tasks!: TaskResponseDto[];
}

/** GET/PATCH/create/assign wrapper — `{ task }` bodies (plan §3.1). */
export class GetTaskResponseDto {
  @ApiProperty({ type: TaskResponseDto })
  task!: TaskResponseDto;
}

/** DELETE wrapper — mirrors `ProjectMessageResponseDto`. */
export class TaskMessageResponseDto {
  @ApiProperty({ example: 'Task deleted successfully.' })
  message!: string;
}

const toAssigneeResponse = (
  assignee: TaskAssigneeSummary | null,
): TaskAssigneeResponseDto | null =>
  assignee === null
    ? null
    : { id: assignee.id, name: assignee.name, email: assignee.email };

/** Serialization seam — repository entities never leave the API directly. */
export const toTaskResponse = (task: Task): TaskResponseDto => ({
  id: task.id,
  projectId: task.projectId,
  seq: task.seq,
  key: task.key,
  title: task.title,
  description: task.description,
  status: task.status,
  priority: task.priority,
  assignee: toAssigneeResponse(task.assignee),
  dueDate: task.dueDate,
  createdByUserId: task.createdByUserId,
  createdByName: task.createdByName,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});
