import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../../../../common/decorators';

/** Mirrors the frontend `SLUG_PATTERN` (Frontend/src/lib/dashboard.ts). */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Lowercase a slug; non-strings pass through so `@IsString` reports the
 * failure instead of a transform crash.
 */
export const Lowercase = (): PropertyDecorator =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  );

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Acme Inc', minLength: 2, maxLength: 100 })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: 'acme-inc',
    minLength: 3,
    maxLength: 63,
    description:
      'URL-safe identifier — 3–63 chars, letters/digits/hyphens, no leading or trailing hyphen. Normalized to lowercase.',
  })
  @Trim()
  @Lowercase()
  @IsString()
  @Matches(SLUG_PATTERN, {
    message:
      'Slug may only contain lowercase letters, numbers and single hyphens, without leading or trailing hyphens',
  })
  @MinLength(3)
  @MaxLength(63)
  slug!: string;
}
