import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, ValidateIf } from 'class-validator';

/**
 * `POST /tasks/:id/assign` — `{ assigneeId: uuid | null }`.
 *
 * `null` is a first-class value (unassign — always allowed for actors with
 * assign rights, sends no notification). `undefined` (field absent) fails
 * validation, because "no opinion" is not expressible on this route: the
 * client either names a target or explicitly clears one.
 */
export class AssignTaskDto {
  @ApiProperty({
    example: '00000000-0000-4000-8000-000000000031',
    nullable: true,
    description:
      'New assignee: an ACTIVE project member allowed by the assignment matrix (400 assign_target_invalid otherwise), or `null` to unassign.',
  })
  @ValidateIf((_dto, value: unknown) => value !== null)
  @IsUUID()
  assigneeId!: string | null;
}
