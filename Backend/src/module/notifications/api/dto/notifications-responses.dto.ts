import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  NOTIFICATION_CURSOR_PATTERN,
  NOTIFICATION_DEFAULT_LIMIT,
  NOTIFICATION_MAX_LIMIT,
  NOTIFICATION_TYPES,
} from '../constants/notifications.constants';

/**
 * Query for `GET /notifications`. The cursor ships as a **pair** — a
 * fixed-width UTC timestamp (`YYYY-MM-DDTHH:MM:SS.USZ`, full microsecond
 * precision) plus the tie-break uuid — and the service rejects half a pair
 * (400 `invalid_cursor`).
 */
export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    example: NOTIFICATION_DEFAULT_LIMIT,
    minimum: 1,
    maximum: NOTIFICATION_MAX_LIMIT,
    description: 'Page size; clamped to the max server-side.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATION_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    example: '2026-01-01T00:00:00.000000Z',
    pattern: NOTIFICATION_CURSOR_PATTERN.source,
    description:
      'createdAt of the last row of the previous page (fixed-width, six fraction digits). Requires cursorId.',
  })
  @IsOptional()
  @IsString()
  @Matches(NOTIFICATION_CURSOR_PATTERN, {
    message: 'cursorCreatedAt must look like 2026-01-01T00:00:00.000000Z.',
  })
  cursorCreatedAt?: string;

  @ApiPropertyOptional({
    example: '00000000-0000-4000-8000-000000000042',
    description: 'id tie-break of the last row of the previous page.',
  })
  @IsOptional()
  @IsUUID()
  cursorId?: string;
}

export class NotificationCursorDto {
  @ApiProperty({ example: '2026-01-01T00:00:00.000000Z' })
  createdAt!: string;

  @ApiProperty({ example: '00000000-0000-4000-8000-000000000042' })
  id!: string;
}

export class NotificationResponseDto {
  @ApiProperty({ example: '00000000-0000-4000-8000-000000000050' })
  id!: string;

  @ApiProperty({
    enum: [...NOTIFICATION_TYPES],
    description: '`task_assigned` | `due_reminder` (varchar — extensible).',
  })
  type!: (typeof NOTIFICATION_TYPES)[number];

  @ApiProperty({
    nullable: true,
    example: '00000000-0000-4000-8000-000000000004',
    description: 'Deep-link target; null only for future non-task types.',
  })
  taskId!: string | null;

  @ApiProperty({ example: 'Task assigned to you', maxLength: 200 })
  title!: string;

  @ApiProperty({
    example: 'WR-4 "Wire up auth flow" — Website relaunch',
    maxLength: 500,
    description: 'Snapshot text — survives task rename/reassign.',
  })
  body!: string;

  @ApiProperty({
    nullable: true,
    example: '2026-01-01T00:00:00.000Z',
    description: 'Read timestamp; null = unread.',
  })
  readAt!: Date | null;

  @ApiProperty({
    example: '2026-01-01T00:00:00.000000Z',
    description:
      'Fixed-width UTC string (six fraction digits) — doubles as the pagination cursor value.',
  })
  createdAt!: string;
}

export class ListNotificationsResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  notifications!: NotificationResponseDto[];

  @ApiProperty({
    example: 3,
    description: 'Always derived from the DB (`readAt IS NULL`).',
  })
  unreadCount!: number;

  @ApiProperty({
    nullable: true,
    type: NotificationCursorDto,
    description: 'Pass back as cursorCreatedAt/cursorId; null = last page.',
  })
  nextCursor!: NotificationCursorDto | null;
}

/** 204 bodies — `read` and `read-all` answer with no content. */
export class NotificationNoContentResponseDto {}
