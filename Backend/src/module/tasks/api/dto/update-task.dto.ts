import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../../common/decorators';
import {
  DUE_DATE_PATTERN,
  TASK_PRIORITIES,
} from '../constants/tasks.constants';

/**
 * `PATCH /tasks/:id` — hand-written optional fields (not `PartialType`):
 * `status` and `assignee` are deliberately **not** editable here (status has
 * its own route, assignment its own route), and the Swagger docs stay
 * explicit about that (mirrors update-project.dto.ts).
 *
 * Due-date rule (plan §3.1): reject only when `dueDate` is provided **and
 * differs from the stored value** and is before today — the no-change
 * exemption lets a title edit on an already-overdue task succeed while
 * resubmitting a *changed* past date still fails.
 */
export class UpdateTaskDto {
  @ApiPropertyOptional({
    example: 'Wire up auth flow (revised)',
    maxLength: 200,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({
    example: 'Sessions, guards, and the login form.',
    maxLength: 5000,
    description: 'Blank clears the description.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ enum: [...TASK_PRIORITIES] })
  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  @ApiPropertyOptional({
    example: '2026-11-05',
    pattern: DUE_DATE_PATTERN.source,
    nullable: true,
    description:
      'Date-only `YYYY-MM-DD` (UTC); a *changed* past date is rejected (400 due_date_past), resubmitting the stored value unchanged is allowed. `null` clears the due date (edge 4).',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DUE_DATE_PATTERN, {
    message: 'dueDate must be a date-only value like 2026-11-05.',
  })
  dueDate?: string | null;
}
