import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SessionUser } from '../../auth/api/session/session.types';
import {
  ADMIN_REQUIRED_MESSAGE,
  ADMIN_REQUIRED_STATUS,
  EMPTY_UPDATE_MESSAGE,
  EMPTY_UPDATE_STATUS,
  NOT_ORGANIZATION_OWNER_MESSAGE,
  NOT_ORGANIZATION_OWNER_STATUS,
  ORGANIZATION_EXISTS_MESSAGE,
  ORGANIZATION_EXISTS_STATUS,
  ORGANIZATION_NOT_FOUND_MESSAGE,
  ORGANIZATION_NOT_FOUND_STATUS,
} from './constants/organization.constants';
import type { CreateOrganizationDto } from './dto/create-organization.dto';
import type { UpdateOrganizationDto } from './dto/update-organization.dto';
import type { Organization } from './entities/organization.entity';
import { OrganizationFactory } from './factories/organization.factory';
import { OrganizationPolicy } from './policies/organization.policy';
import { OrganizationRepository } from './repositories/organization.repository';

/**
 * Orchestration for the singleton organization. Role gating lives in
 * `RolesGuard` (create keeps a defensive Admin-only check here); the
 * manage check is decided by the policy after the single load, so the row
 * is never fetched twice. All role attributes come from the session
 * snapshot.
 */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly factory: OrganizationFactory,
    private readonly policy: OrganizationPolicy,
    private readonly repository: OrganizationRepository,
  ) {}

  /**
   * Defense in depth behind `@Roles('Admin')`: only Admins create the
   * organization (HR/PM/Dev never could; Admin accounts are seeded later).
   * The pre-check answers the sequential 409; the repository maps the
   * concurrent race (23505) to the same body.
   */
  async create(
    dto: CreateOrganizationDto,
    actor: SessionUser,
  ): Promise<Organization> {
    if (actor.role !== 'Admin') {
      throw new ForbiddenException({
        status: ADMIN_REQUIRED_STATUS,
        message: ADMIN_REQUIRED_MESSAGE,
      });
    }
    const existing = await this.repository.findSingleton();
    if (existing !== null) {
      throw new ConflictException({
        status: ORGANIZATION_EXISTS_STATUS,
        message: ORGANIZATION_EXISTS_MESSAGE,
      });
    }
    return this.repository.insert(this.factory.create(dto, actor.userId));
  }

  /** Any signed-in user — a null body, not a 404, so the UI can branch. */
  async find(): Promise<Organization | null> {
    return this.repository.findSingleton();
  }

  async update(
    dto: UpdateOrganizationDto,
    actor: SessionUser,
  ): Promise<Organization> {
    const organization = await this.requireOrganization();
    this.requireManage(actor);

    // class-validator can't express "at least one field"; the whitelist
    // already stripped unknown keys, and TS class fields keep absent
    // optional properties as own `undefined` keys — so a real field must
    // carry a value for this to pass.
    if (dto.name === undefined && dto.slug === undefined) {
      throw new BadRequestException({
        status: EMPTY_UPDATE_STATUS,
        message: EMPTY_UPDATE_MESSAGE,
      });
    }

    const changes: { name?: string; slug?: string } = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.slug !== undefined) changes.slug = dto.slug;
    // `updatedAt` is stamped by the column's `$onUpdate`.
    const updated = await this.repository.update(organization.id, changes);
    if (updated === null) {
      throw this.notFound();
    }
    return updated;
  }

  /** Hard delete; the singleton slot is freed for any Admin to re-create. */
  async remove(actor: SessionUser): Promise<void> {
    const organization = await this.requireOrganization();
    this.requireManage(actor);
    await this.repository.remove(organization.id);
  }

  private async requireOrganization(): Promise<Organization> {
    const organization = await this.repository.findSingleton();
    if (organization === null) {
      throw this.notFound();
    }
    return organization;
  }

  /** Admin-only half of the ABAC check; the role half is `RolesGuard`. */
  private requireManage(actor: SessionUser): void {
    if (!this.policy.canManage(actor)) {
      throw new ForbiddenException({
        status: NOT_ORGANIZATION_OWNER_STATUS,
        message: NOT_ORGANIZATION_OWNER_MESSAGE,
      });
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      status: ORGANIZATION_NOT_FOUND_STATUS,
      message: ORGANIZATION_NOT_FOUND_MESSAGE,
    });
  }
}
