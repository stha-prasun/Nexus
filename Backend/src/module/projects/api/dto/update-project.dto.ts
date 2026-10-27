import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Trim } from '../../../../common/decorators';
import { PROJECT_COLOR_PATTERN } from '../constants/projects.constants';

/**
 * Same rules as create, with every field optional; the service rejects an
 * empty body (400 `empty_update`) — hand-written rather than PartialType so
 * the Swagger docs stay explicit (mirrors update-organization.dto.ts).
 */
export class UpdateProjectDto {
  @ApiPropertyOptional({
    example: 'Website relaunch v2',
    minLength: 2,
    maxLength: 100,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'Rebuild the marketing site on the new CMS.',
    maxLength: 500,
    description: 'Blank or null clears the description.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({
    example: '#2FB67C',
    pattern: PROJECT_COLOR_PATTERN.source,
    description: 'Same pattern as create.',
  })
  @IsOptional()
  @IsString()
  @Matches(PROJECT_COLOR_PATTERN, {
    message: 'Color must be a hex value like #1F2FE0.',
  })
  color?: string;
}
