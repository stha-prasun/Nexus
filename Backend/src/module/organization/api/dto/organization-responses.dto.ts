import { ApiProperty } from '@nestjs/swagger';
import type { Organization } from '../entities/organization.entity';

export class OrganizationResponseDto {
  @ApiProperty({ example: '00000000-0000-4000-8000-000000000010' })
  id!: string;

  @ApiProperty({ example: 'Acme Inc', minLength: 2, maxLength: 100 })
  name!: string;

  @ApiProperty({ example: 'acme-inc', minLength: 3, maxLength: 63 })
  slug!: string;

  @ApiProperty({
    example: '00000000-0000-4000-8000-000000000007',
    description: 'User id of the PM who created the organization (its owner)',
  })
  createdByUserId!: string;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: Date;
}

/** GET — `null` when no organization exists yet (a branch, not an error). */
export class GetOrganizationResponseDto {
  @ApiProperty({
    type: OrganizationResponseDto,
    nullable: true,
    example: null,
  })
  organization!: OrganizationResponseDto | null;
}

/** Serialization seam — entities never leave the API directly. */
export const toOrganizationResponse = (
  organization: Organization,
): OrganizationResponseDto => ({
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  createdByUserId: organization.createdByUserId,
  createdAt: organization.createdAt,
  updatedAt: organization.updatedAt,
});
