import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AppLogger } from '../../../common/logger/logger';
import type { Role } from '../../auth/api/constants/auth.constants';
import { SessionService } from '../../auth/api/session/session.service';
import type { SessionUser } from '../../auth/api/session/session.types';
import { MailQueue } from '../../mail/mail.queue';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import {
  ALREADY_MEMBER_MESSAGE,
  ALREADY_MEMBER_STATUS,
  EMAIL_UNVERIFIED_MESSAGE,
  EMAIL_UNVERIFIED_STATUS,
  INVITE_ACCEPTED_MESSAGE,
  INVITE_EMAIL_MISMATCH_MESSAGE,
  INVITE_EMAIL_MISMATCH_STATUS,
  INVITE_INVALID_MESSAGE,
  INVITE_INVALID_STATUS,
  INVITE_RESENT_MESSAGE,
  INVITE_SENT_MESSAGE,
  INVITE_TOKEN_TTL_SECONDS,
  inviteMembershipKey,
  inviteTokenKey,
  LAST_ADMIN_MESSAGE,
  LAST_ADMIN_STATUS,
  MEMBER_NOT_FOUND_MESSAGE,
  MEMBER_NOT_FOUND_STATUS,
  MEMBER_POLICY_MESSAGE,
  MEMBER_POLICY_STATUS,
  MEMBER_REMOVED_MESSAGE,
  MEMBER_ROLE_UPDATED_MESSAGE,
  NOT_ACTIVE_MEMBER_MESSAGE,
  NOT_ACTIVE_MEMBER_STATUS,
  ORGANIZATION_REQUIRED_MESSAGE,
  ORGANIZATION_REQUIRED_STATUS,
  PROJECT_LAST_LEAD_MESSAGE,
  PROJECT_LAST_LEAD_STATUS,
  SELF_INVITE_MESSAGE,
  SELF_INVITE_STATUS,
  SELF_MANAGE_MESSAGE,
  SELF_MANAGE_STATUS,
} from './constants/members.constants';
import type { ChangeMemberRoleDto } from './dto/change-member-role.dto';
import type { InviteMemberDto } from './dto/invite-member.dto';
import type { InvitePreview, Member } from './entities/member.entity';
import { MemberFactory } from './factories/member.factory';
import { MembersPolicy } from './policies/members.policy';
import type { OrgRef } from './repositories/members.repository';
import { MembersRepository } from './repositories/members.repository';

export interface MemberListEntry {
  id: string;
  userId: string | null;
  name: string | null;
  email: string;
  role: Role;
  status: 'INVITED' | 'ACTIVE';
  invitedAt: Date;
  acceptedAt: Date | null;
  invitedBy: string | null;
}

export interface MembersListResult {
  members: MemberListEntry[];
}

export interface InviteOutcome {
  message: string;
  created: boolean;
}

export interface MemberMessage {
  message: string;
}

/**
 * Membership orchestration for the singleton org. Every method re-checks
 * ACTIVE membership and the §1.1 policy behind its guards (defense in depth,
 * matching organization.service.ts); the target's role comes from the loaded
 * membership row, never the session snapshot. Row-mutating operations run in
 * the repository's advisory-locked transactions so the ≥1 ACTIVE Admin
 * invariant is race-safe; session/token side effects happen after the commit
 * (best-effort where they already are).
 */
@Injectable()
export class MembersService {
  private readonly log: ReturnType<AppLogger['child']>;

  constructor(
    private readonly factory: MemberFactory,
    private readonly policy: MembersPolicy,
    private readonly repository: MembersRepository,
    private readonly sessions: SessionService,
    private readonly mailQueue: MailQueue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    logger: AppLogger,
  ) {
    this.log = logger.child('members');
  }

  /** Any ACTIVE member (Dev included) may see the roster. */
  async list(actor: SessionUser): Promise<MembersListResult> {
    const org = await this.requireActiveMember(actor);
    if (org === null) return { members: [] };
    const members = await this.repository.listMembers(org.id);
    return { members: members.map(toListEntry) };
  }

  /** Invite by email (Admin/HR/PM per §1.1); re-invite merges into the row. */
  async invite(
    dto: InviteMemberDto,
    actor: SessionUser,
  ): Promise<InviteOutcome> {
    const org = await this.requireActiveMember(actor);
    if (org === null) {
      throw new ConflictException({
        status: ORGANIZATION_REQUIRED_STATUS,
        message: ORGANIZATION_REQUIRED_MESSAGE,
      });
    }
    if (dto.email === actor.email) {
      throw new ForbiddenException({
        status: SELF_INVITE_STATUS,
        message: SELF_INVITE_MESSAGE,
      });
    }
    this.requireInvitePolicy(actor.role, dto.role);

    const existing = await this.repository.findMembershipByEmail(
      org.id,
      dto.email,
    );
    if (existing !== null) {
      if (existing.status === 'ACTIVE') {
        throw new ConflictException({
          status: ALREADY_MEMBER_STATUS,
          message: ALREADY_MEMBER_MESSAGE,
        });
      }
      // Re-invite: newest role wins, old link dies, mail goes again (200).
      await this.repository.updateInviteRole(existing.id, dto.role);
      await this.issueInviteToken(existing.id);
      return { message: INVITE_RESENT_MESSAGE, created: false };
    }

    const invitee = await this.repository.findUserByEmail(dto.email);
    const row = this.factory.createInvite({
      organizationId: org.id,
      email: dto.email,
      role: dto.role,
      userId: invitee?.id ?? null,
      invitedByUserId: actor.userId,
    });
    const inserted = await this.repository.insertInvite(row);
    if (inserted.outcome === 'conflict') {
      // Concurrent invite/accept for the same email — re-read and merge.
      const raced = await this.repository.findMembershipByEmail(
        org.id,
        dto.email,
      );
      if (raced === null || raced.status === 'ACTIVE') {
        throw new ConflictException({
          status: ALREADY_MEMBER_STATUS,
          message: ALREADY_MEMBER_MESSAGE,
        });
      }
      await this.repository.updateInviteRole(raced.id, dto.role);
      await this.issueInviteToken(raced.id);
      return { message: INVITE_RESENT_MESSAGE, created: false };
    }

    await this.issueInviteToken(inserted.member.id);
    return { message: INVITE_SENT_MESSAGE, created: true };
  }

  /** Regenerate + resend an INVITED row's link (lost mail, Redis flush). */
  async resendInvite(id: string, actor: SessionUser): Promise<MemberMessage> {
    const org = await this.requireActiveMember(actor);
    if (org === null) {
      throw new ConflictException({
        status: ORGANIZATION_REQUIRED_STATUS,
        message: ORGANIZATION_REQUIRED_MESSAGE,
      });
    }
    const member = await this.requireMembership(org, id);
    if (member.status === 'ACTIVE') {
      throw new ConflictException({
        status: ALREADY_MEMBER_STATUS,
        message: ALREADY_MEMBER_MESSAGE,
      });
    }
    if (member.email === actor.email) {
      throw new ForbiddenException({
        status: SELF_INVITE_STATUS,
        message: SELF_INVITE_MESSAGE,
      });
    }
    this.requireInvitePolicy(actor.role, member.role);

    await this.issueInviteToken(member.id);
    return { message: INVITE_RESENT_MESSAGE };
  }

  /**
   * Role change — the repository writes exactly one column per the row's
   * state (ACTIVE → users.role, INVITED → invitedRole); same-role is a 200
   * no-op without writes or the advisory lock.
   */
  async changeRole(
    id: string,
    dto: ChangeMemberRoleDto,
    actor: SessionUser,
  ): Promise<MemberMessage> {
    const org = await this.requireActiveMember(actor);
    if (org === null) throw this.notFound();
    const member = await this.requireMembership(org, id);
    this.requireNotSelf(member, actor);
    this.requireManagePolicy(actor.role, member.role);

    if (member.role === dto.role) {
      return { message: MEMBER_ROLE_UPDATED_MESSAGE };
    }

    const result = await this.repository.changeRole(member.id, dto.role);
    if (result.outcome === 'not_found') throw this.notFound();
    if (result.outcome === 'last_admin') throw this.lastAdmin();

    // Target's live sessions must never serve a stale role to RolesGuard.
    if (result.member.status === 'ACTIVE' && result.member.userId !== null) {
      await this.sessions.updateRoleForUser(result.member.userId, dto.role);
    }
    return { message: MEMBER_ROLE_UPDATED_MESSAGE };
  }

  /** Remove membership (INVITED rows also kill their invite token). */
  async remove(id: string, actor: SessionUser): Promise<MemberMessage> {
    const org = await this.requireActiveMember(actor);
    if (org === null) throw this.notFound();
    const member = await this.requireMembership(org, id);
    this.requireNotSelf(member, actor);
    this.requireManagePolicy(actor.role, member.role);

    const result = await this.repository.removeMember(member.id);
    if (result.outcome === 'not_found') throw this.notFound();
    if (result.outcome === 'last_admin') throw this.lastAdmin();
    // Removal blocked: the target is the last lead of ≥1 project (the
    // repository rolled back under the sorted project locks).
    if (result.outcome === 'sole_lead') throw this.projectLastLead();

    // Post-commit, best-effort: access ends immediately; link dies.
    if (result.wasActive && result.userId !== null) {
      try {
        await this.sessions.revokeAllForUser(result.userId);
      } catch (error) {
        this.log.error('session revoke after removal failed', {
          userId: result.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await this.consumeInviteToken(member.id);
    return { message: MEMBER_REMOVED_MESSAGE };
  }

  /** Public: the token IS the capability — revealing its email is safe. */
  async getInvitePreview(token: string): Promise<InvitePreview> {
    const membershipId = await this.membershipIdForToken(token);
    const preview =
      membershipId === null
        ? null
        : await this.repository.findInvitePreview(membershipId);
    if (preview === null) {
      throw new NotFoundException({
        status: INVITE_INVALID_STATUS,
        message: INVITE_INVALID_MESSAGE,
      });
    }
    return preview;
  }

  /** Accept the invitation as the signed-in invitee (one locked tx in the repo). */
  async acceptInvite(
    token: string,
    actor: SessionUser,
  ): Promise<MemberMessage> {
    const membershipId = await this.membershipIdForToken(token);
    if (membershipId === null) throw this.inviteInvalid();
    const detail = await this.repository.findMembershipDetailById(membershipId);
    if (detail === null) throw this.inviteInvalid();
    if (detail.member.email !== actor.email) {
      throw new ForbiddenException({
        status: INVITE_EMAIL_MISMATCH_STATUS,
        message: INVITE_EMAIL_MISMATCH_MESSAGE,
      });
    }
    if (detail.emailVerifiedAt === null) {
      throw new ForbiddenException({
        status: EMAIL_UNVERIFIED_STATUS,
        message: EMAIL_UNVERIFIED_MESSAGE,
      });
    }

    const result = await this.repository.accept(membershipId, actor.userId);
    if (result.outcome === 'gone') throw this.inviteInvalid();
    if (result.outcome === 'already') {
      throw new ConflictException({
        status: ALREADY_MEMBER_STATUS,
        message: ALREADY_MEMBER_MESSAGE,
      });
    }

    // DB commits first; the token consume is best-effort — a leftover token
    // still resolves, but the row is ACTIVE so a second accept gets 409.
    await this.consumeInviteToken(membershipId);
    // The caller's session still carries the register-default role (possibly
    // all the way up to Admin now) — patch every live session.
    await this.sessions.updateRoleForUser(actor.userId, result.member.role);
    return { message: INVITE_ACCEPTED_MESSAGE };
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Fresh DB read behind every guard (defense in depth): lenient when no org
   * exists (creation path), 403 when the org exists and the caller holds no
   * ACTIVE membership. Returns the org ref for downstream lookups.
   */
  private async requireActiveMember(
    actor: SessionUser,
  ): Promise<OrgRef | null> {
    const org = await this.repository.findOrganization();
    if (org === null) return null;
    const membership = await this.repository.findActiveMembershipOrg(
      actor.userId,
    );
    if (membership === null) {
      throw new ForbiddenException({
        status: NOT_ACTIVE_MEMBER_STATUS,
        message: NOT_ACTIVE_MEMBER_MESSAGE,
      });
    }
    return org;
  }

  private async requireMembership(org: OrgRef, id: string): Promise<Member> {
    const member = await this.repository.findMembershipById(id);
    // Membership from another org (impossible with the singleton, defensive).
    if (member === null || member.organizationId !== org.id) {
      throw this.notFound();
    }
    return member;
  }

  /** No self-demotion and no self-removal — for every actor, every op. */
  private requireNotSelf(member: Member, actor: SessionUser): void {
    if (member.userId === actor.userId || member.email === actor.email) {
      throw new ForbiddenException({
        status: SELF_MANAGE_STATUS,
        message: SELF_MANAGE_MESSAGE,
      });
    }
  }

  private requireInvitePolicy(actorRole: Role, role: Role): void {
    if (!this.policy.canInviteRole(actorRole, role)) {
      throw new ForbiddenException({
        status: MEMBER_POLICY_STATUS,
        message: MEMBER_POLICY_MESSAGE,
      });
    }
  }

  private requireManagePolicy(actorRole: Role, targetRole: Role): void {
    if (!this.policy.canManageRole(actorRole, targetRole)) {
      throw new ForbiddenException({
        status: MEMBER_POLICY_STATUS,
        message: MEMBER_POLICY_MESSAGE,
      });
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      status: MEMBER_NOT_FOUND_STATUS,
      message: MEMBER_NOT_FOUND_MESSAGE,
    });
  }

  private inviteInvalid(): NotFoundException {
    return new NotFoundException({
      status: INVITE_INVALID_STATUS,
      message: INVITE_INVALID_MESSAGE,
    });
  }

  private lastAdmin(): ForbiddenException {
    return new ForbiddenException({
      status: LAST_ADMIN_STATUS,
      message: LAST_ADMIN_MESSAGE,
    });
  }

  private projectLastLead(): ForbiddenException {
    return new ForbiddenException({
      status: PROJECT_LAST_LEAD_STATUS,
      message: PROJECT_LAST_LEAD_MESSAGE,
    });
  }

  private async membershipIdForToken(token: string): Promise<string | null> {
    return this.redis.get(inviteTokenKey(token));
  }

  /**
   * Mint a fresh token for the membership (one active token per membership —
   * the old link dies) and enqueue the mail. Keys are written BEFORE the
   * enqueue: enqueue-first would race the worker (same rule as verification).
   */
  private async issueInviteToken(membershipId: string): Promise<void> {
    const token = randomBytes(32).toString('hex');
    const pipeline = this.redis.pipeline();
    pipeline.set(
      inviteTokenKey(token),
      membershipId,
      'EX',
      INVITE_TOKEN_TTL_SECONDS,
    );
    pipeline.set(
      inviteMembershipKey(membershipId),
      token,
      'EX',
      INVITE_TOKEN_TTL_SECONDS,
    );
    await pipeline.exec();

    await this.safeEnqueue(() =>
      this.mailQueue.enqueueInviteMember(membershipId),
    );
  }

  /** Delete both token keys for a membership (accept/remove). Best-effort. */
  private async consumeInviteToken(membershipId: string): Promise<void> {
    try {
      const token = await this.redis.get(inviteMembershipKey(membershipId));
      const pipeline = this.redis.pipeline();
      pipeline.del(inviteMembershipKey(membershipId));
      if (token !== null) pipeline.del(inviteTokenKey(token));
      await pipeline.exec();
    } catch (error) {
      this.log.error('invite token consume failed', {
        membershipId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Enqueue failures are logged loudly but never leak into the response. */
  private async safeEnqueue(operation: () => Promise<void>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.log.error('invite email enqueue failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const toListEntry = (member: Member): MemberListEntry => ({
  id: member.id,
  userId: member.userId,
  name: member.name,
  email: member.email,
  role: member.role,
  status: member.status,
  invitedAt: member.invitedAt,
  acceptedAt: member.acceptedAt,
  invitedBy: member.invitedBy,
});
