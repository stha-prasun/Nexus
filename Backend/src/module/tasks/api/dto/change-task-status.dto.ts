import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty } from 'class-validator';
import { TASK_STATUSES } from '../constants/tasks.constants';

/**
 * `PATCH /tasks/:id/status` — one of the seven columns. Free transition
 * (any status from any status, plan §1); permission (full actor **or the
 * task's assignee**) is a service rule.
 */
export class ChangeTaskStatusDto {
  @ApiProperty({
    enum: [...TASK_STATUSES],
    example: 'in_progress',
    description: 'Target column; last-write-wins on rapid drags.',
  })
  @IsIn(TASK_STATUSES)
  @IsNotEmpty()
  status!: (typeof TASK_STATUSES)[number];
}
