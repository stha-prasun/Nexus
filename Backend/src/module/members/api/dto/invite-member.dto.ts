import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength } from 'class-validator';
import { NormalizeEmail, Trim } from '../../../../common/decorators';
import { ROLES } from '../../../auth/api/constants/auth.constants';

export class InviteMemberDto {
  @ApiProperty({ example: 'ada@example.com', maxLength: 254 })
  @Trim()
  @NormalizeEmail()
  @IsString()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    example: 'Dev',
    enum: [...ROLES],
    description:
      'Role applied when the invitee accepts. Policy-checked against the actor (Admin: any, HR: PM/Dev/HR, PM: PM/Dev).',
  })
  @IsIn(ROLES, { message: `Role must be one of: ${ROLES.join(', ')}` })
  role!: (typeof ROLES)[number];
}
