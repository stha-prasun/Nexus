import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Trim } from '../../../../common/decorators';
import { PROJECT_COLOR_PATTERN } from '../constants/projects.constants';

export class CreateProjectDto {
  @ApiProperty({ example: 'Website relaunch', minLength: 2, maxLength: 100 })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    example: '#1F2FE0',
    pattern: PROJECT_COLOR_PATTERN.source,
    description: 'Hex `#rrggbb`; defaults to #1F2FE0 when omitted (plan §1).',
  })
  @IsOptional()
  @IsString()
  @Matches(PROJECT_COLOR_PATTERN, {
    message: 'Color must be a hex value like #1F2FE0.',
  })
  color?: string;

  @ApiPropertyOptional({
    type: [String],
    example: [
      '00000000-0000-4000-8000-000000000031',
      '00000000-0000-4000-8000-000000000032',
    ],
    description:
      'Extra members beyond the creator (who is always added). Each id must belong to an ACTIVE org member; HR targets are rejected server-side.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  memberUserIds?: string[];

  @ApiProperty({
    type: [String],
    example: ['00000000-0000-4000-8000-000000000031'],
    description:
      'Required, non-empty. Every id must be in memberUserIds or the creator — creation needs at least one explicit lead (plan §1).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  leadUserIds!: string[];
}
