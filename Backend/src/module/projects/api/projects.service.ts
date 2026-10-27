import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ROLE_FORBIDDEN_MESSAGE,
  ROLE_FORBIDDEN_STATUS,
} from '../../../common/constants/role.constants';
import type { SessionUser } from '../../auth/api/session/session.types';
import { MembersRepository } from '../../members/api/repositories/members.repository';
import {
  ALREADY_PROJECT_MEMBER_MESSAGE,
  ALREADY_PROJECT_MEMBER_STATUS,
  LAST_LEAD_REQUIRED_MESSAGE,
  LAST_LEAD_REQUIRED_STATUS,
  LEAD_NOT_MEMBER_MESSAGE,
  LEAD_NOT_MEMBER_STATUS,
  LEAD_ROLE_FORBIDDEN_MESSAGE,
  LEAD_ROLE_FORBIDDEN_STATUS,
  NOT_ORG_MEMBER_STATUS,
  notOrgMemberMessage,
  ORGANIZATION_REQUIRED_MESSAGE,
  ORGANIZATION_REQUIRED_STATUS,
  PROJECT_DELETED_MESSAGE,
  PROJECT_MEMBER_NOT_FOUND_MESSAGE,
  PROJECT_MEMBER_NOT_FOUND_STATUS,
  PROJECT_MEMBER_ROLE_FORBIDDEN_MESSAGE,
  PROJECT_MEMBER_ROLE_FORBIDDEN_STATUS,
  PROJECT_NOT_FOUND_MESSAGE,
  PROJECT_NOT_FOUND_STATUS,
  PROJECT_REMOVE_FORBIDDEN_MESSAGE,
  PROJECT_REMOVE_FORBIDDEN_STATUS,
  SELF_REMOVE_FORBIDDEN_MESSAGE,
  SELF_REMOVE_FORBIDDEN_STATUS,
} from './constants/projects.constants';
import type { AddProjectMemberDto } from './dto/add-project-member.dto';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { SetProjectLeadDto } from './dto/set-project-lead.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectFactory } from './factories/project.factory';
import { ProjectsPolicy } from './policies/projects.policy';
import type {
  ActiveOrgMembership,
  ProjectMembershipRow,
  ProjectView,
} from './repositories/projects.repository';
import { ProjectsRepository } from './repositories/projects.repository';

export interface ProjectsListResult {
  projects: ProjectView[];
}

export interface ProjectMessage {
  message: string;
}

/**
 * Orchestration for projects. Guard order on every route is Session →
 * Roles → ActiveMember; behind that, this service re-checks the §1.1
 * matrix on fresh DB reads (defense in depth, matching members/organization).
 * Visibility failures answer 404 (no existence leak); mutations that would
 * strip a project's last lead roll back in the repository's per-project
 * advisory-locked transactions and surface as 403 `last_lead_required`.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly factory: ProjectFactory,
    private readonly policy: ProjectsPolicy,
    private readonly repository: ProjectsRepository,
    private readonly membersRepository: MembersRepository,
  ) {}

  /**
   * Admin + PM (RolesGuard enforces; re-checked here). Every referenced
   * user must hold an ACTIVE org membership — HR targets and strangers are
   * rejected with 403 naming the offender. One transaction inserts the
   * project and all membership rows (creator first, leads flagged).
   */
  async create(
    dto: CreateProjectDto,
    actor: SessionUser,
  ): Promise<ProjectView> {
    this.requireCreatePolicy(actor.role);
    const org = await this.membersRepository.findOrganization();
    if (org === null) {
      throw new ConflictException({
        status: ORGANIZATION_REQUIRED_STATUS,
        message: ORGANIZATION_REQUIRED_MESSAGE,
      });
    }

    const creator = await this.requireActiveOrgMembership(
      org.id,
      actor.userId,
      actor.userId,
    );
    const extraIds = [...new Set(dto.memberUserIds ?? [])].filter(
      (userId) => userId !== actor.userId,
    );
    const leadIds = [...new Set(dto.leadUserIds)];

    // leadUserIds ⊆ members ∪ {creator} — checked before any roster lookups
    // so a malformed lead list fails fast with 400, not 403.
    const memberSet = new Set([actor.userId, ...extraIds]);
    for (const leadId of leadIds) {
      if (!memberSet.has(leadId)) {
        throw new BadRequestException({
          status: LEAD_NOT_MEMBER_STATUS,
          message: LEAD_NOT_MEMBER_MESSAGE,
        });
      }
    }

    const extras: ProjectMembershipRow[] = [];
    for (const userId of extraIds) {
      const membership = await this.requireActiveOrgMembership(
        org.id,
        userId,
        userId,
      );
      if (membership.role === 'HR') {
        throw new ForbiddenException({
          status: PROJECT_MEMBER_ROLE_FORBIDDEN_STATUS,
          message: PROJECT_MEMBER_ROLE_FORBIDDEN_MESSAGE,
        });
      }
      if (leadIds.includes(userId) && membership.role !== 'Dev') {
        throw new ForbiddenException({
          status: LEAD_ROLE_FORBIDDEN_STATUS,
          message: LEAD_ROLE_FORBIDDEN_MESSAGE,
        });
      }
      extras.push({
        organizationMemberId: membership.organizationMemberId,
        userId,
        isLead: leadIds.includes(userId),
        addedByUserId: actor.userId,
      });
    }

    // Creator is auto-added as a member — leads must be Devs, so a non-Dev
    // creator listed in leadUserIds is rejected.
    if (leadIds.includes(actor.userId) && creator.role !== 'Dev') {
      throw new ForbiddenException({
        status: LEAD_ROLE_FORBIDDEN_STATUS,
        message: LEAD_ROLE_FORBIDDEN_MESSAGE,
      });
    }
    const project = this.factory.create(dto, org.id, actor.userId);
    return this.repository.insertProjectWithMembers(project, [
      {
        organizationMemberId: creator.organizationMemberId,
        userId: actor.userId,
        isLead: leadIds.includes(actor.userId),
        addedByUserId: null,
      },
      ...extras,
    ]);
  }

  /** Admin/HR → all projects; PM/Dev → only projects they are a member of. */
  async list(actor: SessionUser): Promise<ProjectsListResult> {
    const org = await this.membersRepository.findOrganization();
    if (org === null) return { projects: [] };
    if (actor.role === 'Admin' || actor.role === 'HR') {
      return { projects: await this.repository.listProjects(org.id) };
    }
    return {
      projects: await this.repository.listProjectsForMember(
        org.id,
        actor.userId,
      ),
    };
  }

  /** Visible → full detail; missing or invisible → 404 (indistinguishable). */
  async findOne(id: string, actor: SessionUser): Promise<ProjectView> {
    const project = await this.repository.findProjectById(id);
    const isMember =
      project?.members.some((member) => member.userId === actor.userId) ??
      false;
    if (project === null || !this.policy.canSee(actor.role, isMember)) {
      throw this.notFound();
    }
    return project;
  }

  /** Rename/re-describe/recolor — Admin any; PM if member; empty body → 400. */
  async update(
    id: string,
    dto: UpdateProjectDto,
    actor: SessionUser,
  ): Promise<ProjectView> {
    const project = await this.requireManageable(id, actor);
    if (
      dto.name === undefined &&
      dto.description === undefined &&
      dto.color === undefined
    ) {
      throw new BadRequestException({
        status: 'empty_update',
        message: 'Provide at least one field to update.',
      });
    }
    const changes: {
      name?: string;
      description?: string | null;
      color?: string;
    } = {};
    if (dto.name !== undefined) changes.name = dto.name;
    // Blank clears it — the column is nullable, the UI shows "No description".
    if (dto.description !== undefined) {
      changes.description = dto.description?.trim() || null;
    }
    if (dto.color !== undefined) changes.color = dto.color;
    // `updatedAt` is stamped by the column's `$onUpdate`.
    const updated = await this.repository.update(project.id, changes);
    if (updated === null) throw this.notFound();
    return updated;
  }

  /** Delete the project (members cascade) — same pre-checks as update. */
  async remove(id: string, actor: SessionUser): Promise<ProjectMessage> {
    const project = await this.requireManageable(id, actor);
    await this.repository.remove(project.id);
    return { message: PROJECT_DELETED_MESSAGE };
  }

  /**
   * Add one org member to the project. The roster constraint is enforced
   * here even though the UI picker can't produce a violation: stranger →
   * 403 not_org_member; HR → 403 project_member_role_forbidden; already on
   * the project → 409 (also the 23505 race path).
   */
  async addMember(
    id: string,
    dto: AddProjectMemberDto,
    actor: SessionUser,
  ): Promise<ProjectView> {
    const project = await this.requireManageable(id, actor);
    const org = await this.membersRepository.findOrganization();
    if (org === null) throw this.notFound();
    const membership = await this.requireActiveOrgMembership(
      org.id,
      dto.userId,
      dto.userId,
    );
    if (membership.role === 'HR') {
      throw new ForbiddenException({
        status: PROJECT_MEMBER_ROLE_FORBIDDEN_STATUS,
        message: PROJECT_MEMBER_ROLE_FORBIDDEN_MESSAGE,
      });
    }
    const result = await this.repository.addMember(project.id, {
      organizationMemberId: membership.organizationMemberId,
      userId: dto.userId,
      isLead: false,
      addedByUserId: actor.userId,
    });
    if (result.outcome === 'conflict') {
      throw new ConflictException({
        status: ALREADY_PROJECT_MEMBER_STATUS,
        message: ALREADY_PROJECT_MEMBER_MESSAGE,
      });
    }
    return result.project;
  }

  /**
   * Remove a project member. Order mirrors the §1.1 matrix: self → 403
   * (every role), missing row → 404, PM removing a non-Dev → 403; the
   * ≥1-lead invariant is enforced in the repository under the project lock
   * (403 last_lead_required, Admin included).
   */
  async removeMember(
    id: string,
    userId: string,
    actor: SessionUser,
  ): Promise<ProjectView> {
    const project = await this.requireManageable(id, actor);
    if (userId === actor.userId) {
      throw new ForbiddenException({
        status: SELF_REMOVE_FORBIDDEN_STATUS,
        message: SELF_REMOVE_FORBIDDEN_MESSAGE,
      });
    }
    const target = project.members.find((member) => member.userId === userId);
    if (target === undefined) throw this.memberNotFound();
    if (!this.policy.canRemoveTarget(actor.role, target.role)) {
      throw new ForbiddenException({
        status: PROJECT_REMOVE_FORBIDDEN_STATUS,
        message: PROJECT_REMOVE_FORBIDDEN_MESSAGE,
      });
    }

    const result = await this.repository.removeMember(project.id, userId);
    if (result.outcome === 'not_found') throw this.memberNotFound();
    if (result.outcome === 'last_lead') throw this.lastLead();
    return this.requireProject(project.id);
  }

  /**
   * Promote/demote a member's lead flag — promotion is Dev-only (403
   * lead_role_forbidden). Same-value is a 200 no-op with no transaction
   * (mirror of same-role PATCH in members); demotion runs under the
   * per-project lock so the last lead can never be stripped.
   */
  async setLead(
    id: string,
    userId: string,
    dto: SetProjectLeadDto,
    actor: SessionUser,
  ): Promise<ProjectView> {
    const project = await this.requireManageable(id, actor);
    const target = project.members.find((member) => member.userId === userId);
    if (target === undefined) throw this.memberNotFound();
    if (dto.isLead && target.role !== 'Dev') {
      throw new ForbiddenException({
        status: LEAD_ROLE_FORBIDDEN_STATUS,
        message: LEAD_ROLE_FORBIDDEN_MESSAGE,
      });
    }
    if (target.isLead === dto.isLead) return project;

    const result = await this.repository.setLead(
      project.id,
      userId,
      dto.isLead,
    );
    if (result.outcome === 'not_found') throw this.memberNotFound();
    if (result.outcome === 'last_lead') throw this.lastLead();
    return this.requireProject(project.id);
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Load + authorize a mutation target in one place. Missing and invisible
   * are indistinguishable (404, no existence leak — PM/Dev asking about a
   * project they are not in gets 404, plan edge 14); a project the actor
   * can see but not manage (HR/Dev) gets 403 role_forbidden (edge 15).
   */
  private async requireManageable(
    id: string,
    actor: SessionUser,
  ): Promise<ProjectView> {
    const project = await this.repository.findProjectById(id);
    const isMember =
      project?.members.some((member) => member.userId === actor.userId) ??
      false;
    if (project === null || !this.policy.canSee(actor.role, isMember)) {
      throw this.notFound();
    }
    if (!this.policy.canManage(actor.role, isMember)) {
      throw this.roleForbidden();
    }
    return project;
  }

  /** Fresh ACTIVE-membership read — the "only org members" checkpoint. */
  private async requireActiveOrgMembership(
    organizationId: string,
    userId: string,
    offenderId: string,
  ): Promise<ActiveOrgMembership> {
    const [membership] = await this.repository.findActiveOrgMemberships(
      organizationId,
      [userId],
    );
    if (membership !== undefined) return membership;
    // Name the offender (email when the account exists, raw id otherwise).
    const user = await this.membersRepository.findUserById(offenderId);
    throw new ForbiddenException({
      status: NOT_ORG_MEMBER_STATUS,
      message: notOrgMemberMessage(user?.email ?? offenderId),
    });
  }

  private async requireProject(id: string): Promise<ProjectView> {
    const project = await this.repository.findProjectById(id);
    if (project === null) throw this.notFound();
    return project;
  }

  private requireCreatePolicy(actorRole: SessionUser['role']): void {
    if (!this.policy.canCreate(actorRole)) throw this.roleForbidden();
  }

  private roleForbidden(): ForbiddenException {
    return new ForbiddenException({
      status: ROLE_FORBIDDEN_STATUS,
      message: ROLE_FORBIDDEN_MESSAGE,
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      status: PROJECT_NOT_FOUND_STATUS,
      message: PROJECT_NOT_FOUND_MESSAGE,
    });
  }

  private memberNotFound(): NotFoundException {
    return new NotFoundException({
      status: PROJECT_MEMBER_NOT_FOUND_STATUS,
      message: PROJECT_MEMBER_NOT_FOUND_MESSAGE,
    });
  }

  private lastLead(): ForbiddenException {
    return new ForbiddenException({
      status: LAST_LEAD_REQUIRED_STATUS,
      message: LAST_LEAD_REQUIRED_MESSAGE,
    });
  }
}
