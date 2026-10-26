import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AddProjectMemberDto {
  @ApiProperty({
    example: '00000000-0000-4000-8000-000000000031',
    description:
      'User id of an ACTIVE org member (HR forbidden) who is not already on the project.',
  })
  @IsUUID('4')
  userId!: string;
}
