import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Trim } from '../../../../common/decorators';
import { Lowercase, SLUG_PATTERN } from './create-organization.dto';

/** Same rules as create, with every field optional; the service rejects an empty body (400 `empty_update`). */
export class UpdateOrganizationDto {
  @ApiPropertyOptional({ example: 'Acme Inc', minLength: 2, maxLength: 100 })
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'acme-inc',
    minLength: 3,
    maxLength: 63,
    description: 'Same normalization and pattern as create',
  })
  @IsOptional()
  @Trim()
  @Lowercase()
  @IsString()
  @Matches(SLUG_PATTERN, {
    message:
      'Slug may only contain lowercase letters, numbers and single hyphens, without leading or trailing hyphens',
  })
  @MinLength(3)
  @MaxLength(63)
  slug?: string;
}
