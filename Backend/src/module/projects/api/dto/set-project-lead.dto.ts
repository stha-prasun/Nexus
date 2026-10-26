import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class SetProjectLeadDto {
  @ApiProperty({
    example: true,
    description:
      'true → promote to team lead; false → demote (403 last_lead_required when they are the only one).',
  })
  @IsBoolean()
  isLead!: boolean;
}
