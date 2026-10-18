import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ROLES } from '../../../auth/api/constants/auth.constants';

export class ChangeMemberRoleDto {
  @ApiProperty({
    example: 'Dev',
    enum: [...ROLES],
    description:
      'New role. For an INVITED row this rewrites invitedRole only; for an ACTIVE member it rewrites users.role only.',
  })
  @IsIn(ROLES, { message: `Role must be one of: ${ROLES.join(', ')}` })
  role!: (typeof ROLES)[number];
}
