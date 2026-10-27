import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DEFAULT_PROJECT_COLOR } from '../constants/projects.constants';
import type { CreateProjectDto } from '../dto/create-project.dto';
import { Project } from '../entities/project.entity';

/**
 * The single construction point for `Project` entities. The color default
 * is applied here (not only in the DTO/schema) so every persisted project —
 * including any future factory variant — shares one code path. `createdAt`
 * and `updatedAt` are stamped with the same instant.
 */
@Injectable()
export class ProjectFactory {
  create(
    dto: CreateProjectDto,
    organizationId: string,
    createdByUserId: string,
  ): Project {
    const now = new Date();
    return new Project({
      id: randomUUID(),
      organizationId,
      name: dto.name,
      // Blank → null so create and update agree on "no description".
      description: dto.description?.trim() || null,
      color: dto.color ?? DEFAULT_PROJECT_COLOR,
      createdByUserId,
      createdAt: now,
      updatedAt: now,
    });
  }
}
