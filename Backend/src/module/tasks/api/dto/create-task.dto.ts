import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../../common/decorators';
import {
  DUE_DATE_PATTERN,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from '../constants/tasks.constants';

/**
 * `POST /projects/:projectId/tasks`.
 *
 * `dueDate` pairs `@IsISO8601({ strict: true })` (rejects impossible
 * calendar dates like `2026-13-40` / `2026-02-30` that a bare regex would
 * accept and Postgres would then reject as a 500) with a date-only regex
 * (rejects ISO datetimes, which strict mode allows). Past-date rejection
 * (`due_date_past`) is a service rule against today's UTC date — DTO
 * validation can't know the server clock day.
 *
 * `assigneeId` is optional here but heavily policy-checked by the service:
 * a Dev's create is forced to self, and every other target must satisfy the
 * §1.2 assignment matrix against the project roster.
 */
export class CreateTaskDto {
  @ApiProperty({ example: 'Wire up auth flow', maxLength: 200 })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({
    example: 'Sessions, guards, and the login form.',
    maxLength: 5000,
    description: 'Optional; defaults to an empty string.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    enum: [...TASK_STATUSES],
    description: 'One of the seven board columns; defaults to `todo`.',
  })
  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: (typeof TASK_STATUSES)[number];

  @ApiPropertyOptional({
    enum: [...TASK_PRIORITIES],
    description: 'Defaults to `medium`.',
  })
  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  @ApiPropertyOptional({
    example: '00000000-0000-4000-8000-000000000031',
    description:
      'Must be an ACTIVE project member allowed by the assignment matrix (400 assign_target_invalid otherwise). A Dev may only set their own id; omitting it as a Dev is also rejected (403 role_forbidden).',
  })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({
    example: '2026-11-05',
    pattern: DUE_DATE_PATTERN.source,
    description:
      'Date-only `YYYY-MM-DD` (UTC); must be today or later (400 due_date_past otherwise). Omit for no due date.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(DUE_DATE_PATTERN, {
    message: 'dueDate must be a date-only value like 2026-11-05.',
  })
  dueDate?: string;
}
