import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CreateOrganizationDto } from '../dto/create-organization.dto';
import { Organization } from '../entities/organization.entity';

/**
 * The single construction point for `Organization` entities. The slug is
 * normalized here (not only in the DTO) so every persisted organization —
 * and any future factory variant — shares one code path. `createdAt` and
 * `updatedAt` are stamped with the same instant.
 */
@Injectable()
export class OrganizationFactory {
  create(dto: CreateOrganizationDto, actorUserId: string): Organization {
    const now = new Date();
    return new Organization({
      id: randomUUID(),
      name: dto.name,
      slug: dto.slug.trim().toLowerCase(),
      createdByUserId: actorUserId,
      createdAt: now,
      updatedAt: now,
    });
  }
}
