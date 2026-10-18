import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SessionUser } from '../../auth/api/session/session.types';
import {
  NOT_ACTIVE_MEMBER_MESSAGE,
  NOT_ACTIVE_MEMBER_STATUS,
} from '../../members/api/constants/members.constants';
import { MembersRepository } from '../../members/api/repositories/members.repository';
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
 *
 * Membership-aware (§members 5.3): create bootstraps the creator's ACTIVE
 * Admin membership in the same transaction as the org row; GET answers
 * `null` to any signed-in user without an ACTIVE membership (the removed-
 * member dashboard state); PATCH/DELETE re-check ACTIVE membership behind
 * ActiveMemberGuard (defense in depth) so a stale-Admin session can never
 * edit the org.
 */
@Injectable()
export class OrganizationService {
  constructor(
    private readonly factory: OrganizationFactory,
    private readonly policy: OrganizationPolicy,
    private readonly repository: OrganizationRepository,
    private readonly membersRepository: MembersRepository,
  ) {}

  /**
   * Defense in depth behind `@Roles('Admin')`: only Admins create the
   * organization (HR/PM/Dev never could; Admin accounts are seeded later).
   * The pre-check answers the sequential 409; the repository maps the
   * concurrent race (23505) to the same body. The creator's ACTIVE Admin
   * membership is inserted in the same transaction as the org row.
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
    return this.repository.insertWithMembership(
      this.factory.create(dto, actor.userId),
      actor.userId,
    );
  }

  /**
   * Any signed-in user — a null body, not a 404, so the UI can branch.
   * Membership-gated: a signed-in user without an ACTIVE membership (e.g.
   * just removed) gets `null`, which drops the dashboard into the existing
   * "Ask your Admin to add your email" state. Response shape unchanged.
   */
  async find(actor: SessionUser): Promise<Organization | null> {
    const organization = await this.repository.findSingleton();
    if (organization === null) return null;
    const membership = await this.membersRepository.findActiveMembershipOrg(
      actor.userId,
    );
    return membership === null ? null : organization;
  }

  async update(
    dto: UpdateOrganizationDto,
    actor: SessionUser,
  ): Promise<Organization> {
    const organization = await this.requireOrganization();
    await this.requireManage(actor);

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
    await this.requireManage(actor);
    await this.repository.remove(organization.id);
  }

  private async requireOrganization(): Promise<Organization> {
    const organization = await this.repository.findSingleton();
    if (organization === null) {
      throw this.notFound();
    }
    return organization;
  }

  /**
   * Admin-only half of the ABAC check; the role half is `RolesGuard`. The
   * ACTIVE-membership re-check is defense in depth behind ActiveMemberGuard
   * — a stale-`Admin`-role session of a removed member must not edit the org.
   */
  private async requireManage(actor: SessionUser): Promise<void> {
    if (!this.policy.canManage(actor)) {
      throw new ForbiddenException({
        status: NOT_ORGANIZATION_OWNER_STATUS,
        message: NOT_ORGANIZATION_OWNER_MESSAGE,
      });
    }
    const membership = await this.membersRepository.findActiveMembershipOrg(
      actor.userId,
    );
    if (membership === null) {
      throw new ForbiddenException({
        status: NOT_ACTIVE_MEMBER_STATUS,
        message: NOT_ACTIVE_MEMBER_MESSAGE,
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
