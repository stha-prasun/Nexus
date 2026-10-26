import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { AppLogger } from '../../../common/logger/logger';
import { SessionService } from '../../auth/api/session/session.service';
import type { SessionUser } from '../../auth/api/session/session.types';
import { MailQueue } from '../../mail/mail.queue';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import {
  INVITE_TOKEN_TTL_SECONDS,
  inviteMembershipKey,
  inviteTokenKey,
} from './constants/members.constants';
import type { ChangeMemberRoleDto } from './dto/change-member-role.dto';
import type { InviteMemberDto } from './dto/invite-member.dto';
import { InvitePreview, Member } from './entities/member.entity';
import { MemberFactory } from './factories/member.factory';
import { MembersService } from './members.service';
import { MembersPolicy } from './policies/members.policy';
import type {
  AcceptResult,
  ChangeRoleResult,
  RemoveMemberResult,
} from './repositories/members.repository';
import { MembersRepository } from './repositories/members.repository';

type ErrorShape = { status: number; response: { status: string } };

describe('MembersService', () => {
  let service: MembersService;

  const org = { id: 'org-1', name: 'Acme' };

  const actor: SessionUser = {
    userId: 'actor-1',
    role: 'Admin',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  };

  const repository = {
    findOrganization: jest.fn(),
    findActiveMembershipOrg: jest.fn(),
    listMembers: jest.fn(),
    findMembershipById: jest.fn(),
    findMembershipByEmail: jest.fn(),
    findMembershipDetailById: jest.fn(),
    findUserByEmail: jest.fn(),
    insertInvite: jest.fn(),
    updateInviteRole: jest.fn(),
    changeRole: jest.fn(),
    removeMember: jest.fn(),
    accept: jest.fn(),
    findInvitePreview: jest.fn(),
  };
  const sessions = {
    updateRoleForUser: jest.fn(),
    revokeAllForUser: jest.fn(),
  };
  const mailQueue = { enqueueInviteMember: jest.fn() };
  const pipeline = {
    set: jest.fn().mockReturnThis(),
    get: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };
  const redis = {
    get: jest.fn(),
    pipeline: jest.fn(() => pipeline),
  };
  const log = { error: jest.fn(), info: jest.fn() };

  const member = (
    overrides: Partial<ConstructorParameters<typeof Member>[0]> = {},
  ) =>
    new Member({
      id: 'mid-1',
      organizationId: org.id,
      userId: 'target-1',
      email: 'grace@example.com',
      status: 'ACTIVE',
      role: 'Dev',
      name: 'Grace Hopper',
      invitedAt: new Date('2026-01-01T00:00:00Z'),
      acceptedAt: new Date('2026-01-02T00:00:00Z'),
      invitedBy: actor.email,
      ...overrides,
    });

  const inviteDto = (
    overrides: Partial<InviteMemberDto> = {},
  ): InviteMemberDto =>
    ({
      email: 'grace@example.com',
      role: 'Dev',
      ...overrides,
    }) as InviteMemberDto;

  const expectStatus = async (
    promise: Promise<unknown>,
    status: string,
    httpStatus?: number,
  ): Promise<void> => {
    try {
      await promise;
      throw new Error(`expected an exception with status ${status}`);
    } catch (error) {
      expect(error).toBeInstanceOf(
        httpStatus === 404
          ? NotFoundException
          : httpStatus === 409
            ? ConflictException
            : ForbiddenException,
      );
      expect((error as ErrorShape).response.status).toBe(status);
      if (httpStatus !== undefined) {
        expect((error as ErrorShape).status).toBe(httpStatus);
      }
    }
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    pipeline.exec.mockResolvedValue([['OK'], ['OK']]);
    redis.get.mockResolvedValue(null);
    mailQueue.enqueueInviteMember.mockResolvedValue(undefined);

    repository.findOrganization.mockResolvedValue(org);
    repository.findActiveMembershipOrg.mockResolvedValue(org);
    repository.findMembershipById.mockResolvedValue(null);
    repository.findMembershipByEmail.mockResolvedValue(null);
    repository.findMembershipDetailById.mockResolvedValue(null);
    repository.findInvitePreview.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MembersService,
        MemberFactory,
        MembersPolicy,
        { provide: MembersRepository, useValue: repository },
        { provide: SessionService, useValue: sessions },
        { provide: MailQueue, useValue: mailQueue },
        { provide: REDIS_CLIENT, useValue: redis as unknown as Redis },
        { provide: AppLogger, useValue: { child: () => log } },
      ],
    }).compile();

    service = module.get<MembersService>(MembersService);
  });

  // ------------------------------------------------------------------ list
  describe('list', () => {
    it('returns an empty roster when no organization exists yet', async () => {
      repository.findOrganization.mockResolvedValue(null);

      await expect(service.list(actor)).resolves.toEqual({ members: [] });
      expect(repository.listMembers).not.toHaveBeenCalled();
    });

    it('403 not_active_member when the org exists but the caller has no ACTIVE membership', async () => {
      repository.findActiveMembershipOrg.mockResolvedValue(null);

      await expectStatus(service.list(actor), 'not_active_member', 403);
    });

    it('maps repository members into list entries (Dev included)', async () => {
      repository.listMembers.mockResolvedValue([member()]);

      const { members } = await service.list(actor);

      expect(repository.listMembers).toHaveBeenCalledWith(org.id);
      expect(members).toEqual([
        {
          id: 'mid-1',
          userId: 'target-1',
          name: 'Grace Hopper',
          email: 'grace@example.com',
          role: 'Dev',
          status: 'ACTIVE',
          invitedAt: expect.any(Date),
          acceptedAt: expect.any(Date),
          invitedBy: actor.email,
        },
      ]);
    });
  });

  // ----------------------------------------------------------------- invite
  describe('invite', () => {
    it('409 organization_required when no org row exists', async () => {
      repository.findOrganization.mockResolvedValue(null);

      await expectStatus(
        service.invite(inviteDto(), actor),
        'organization_required',
        409,
      );
    });

    it('403 self_invite_forbidden when inviting your own email', async () => {
      await expectStatus(
        service.invite(inviteDto({ email: actor.email }), actor),
        'self_invite_forbidden',
        403,
      );
      expect(repository.insertInvite).not.toHaveBeenCalled();
    });

    it('403 member_policy_forbidden when the matrix forbids the target role (PM → HR)', async () => {
      const pm: SessionUser = { ...actor, role: 'PM' };

      await expectStatus(
        service.invite(inviteDto({ role: 'HR' }), pm),
        'member_policy_forbidden',
        403,
      );
    });

    it('403 member_policy_forbidden for Dev (read-only role)', async () => {
      const dev: SessionUser = { ...actor, role: 'Dev' };

      await expectStatus(
        service.invite(inviteDto({ role: 'Dev' }), dev),
        'member_policy_forbidden',
        403,
      );
    });

    it('409 already_member when the email is an ACTIVE member', async () => {
      repository.findMembershipByEmail.mockResolvedValue(member());

      await expectStatus(
        service.invite(inviteDto(), actor),
        'already_member',
        409,
      );
      expect(repository.insertInvite).not.toHaveBeenCalled();
    });

    it('re-invite merges into the INVITED row: newest role wins and a fresh link goes out', async () => {
      const invited = member({ status: 'INVITED', role: 'Dev', userId: null });
      repository.findMembershipByEmail.mockResolvedValue(invited);

      const outcome = await service.invite(inviteDto({ role: 'PM' }), actor);

      expect(outcome.created).toBe(false);
      expect(repository.updateInviteRole).toHaveBeenCalledWith('mid-1', 'PM');
      expect(pipeline.set).toHaveBeenCalledWith(
        inviteMembershipKey('mid-1'),
        expect.any(String),
        'EX',
        INVITE_TOKEN_TTL_SECONDS,
      );
      expect(mailQueue.enqueueInviteMember).toHaveBeenCalledWith('mid-1');
    });

    it('creates an INVITED row for an unknown email (userId null) with the token written BEFORE the enqueue', async () => {
      repository.findMembershipByEmail.mockResolvedValue(null);
      repository.findUserByEmail.mockResolvedValue(null);
      repository.insertInvite.mockImplementation(
        async (row: { id: string; status: string }) => ({
          outcome: 'inserted' as const,
          member: member({ id: row.id, status: 'INVITED', userId: null }),
        }),
      );

      const outcome = await service.invite(inviteDto(), actor);

      expect(outcome).toEqual({ message: expect.any(String), created: true });
      expect(repository.insertInvite).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: org.id,
          email: 'grace@example.com',
          status: 'INVITED',
          invitedRole: 'Dev',
          userId: null,
          invitedByUserId: actor.userId,
        }),
      );
      // Keys first, queue second — otherwise the worker can read a miss.
      expect(pipeline.exec.mock.invocationCallOrder[0]).toBeLessThan(
        mailQueue.enqueueInviteMember.mock.invocationCallOrder[0],
      );
    });

    it('links an existing account at invite time (userId set immediately)', async () => {
      repository.findMembershipByEmail.mockResolvedValue(null);
      repository.findUserByEmail.mockResolvedValue({ id: 'user-9' });
      repository.insertInvite.mockResolvedValue({
        outcome: 'inserted',
        member: member({ status: 'INVITED' }),
      });

      await service.invite(inviteDto(), actor);

      expect(repository.insertInvite).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-9' }),
      );
    });

    it('races to the unique constraint and merges when the loser row is INVITED', async () => {
      repository.findMembershipByEmail
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(member({ status: 'INVITED', userId: null }));
      repository.findUserByEmail.mockResolvedValue(null);
      repository.insertInvite.mockResolvedValue({ outcome: 'conflict' });

      const outcome = await service.invite(inviteDto({ role: 'PM' }), actor);

      expect(outcome.created).toBe(false);
      expect(repository.updateInviteRole).toHaveBeenCalledWith('mid-1', 'PM');
    });

    it('races against an accept and answers already_member when the re-read row is ACTIVE', async () => {
      repository.findMembershipByEmail
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(member({ status: 'ACTIVE' }));
      repository.findUserByEmail.mockResolvedValue(null);
      repository.insertInvite.mockResolvedValue({ outcome: 'conflict' });

      await expectStatus(
        service.invite(inviteDto(), actor),
        'already_member',
        409,
      );
    });
  });

  // ----------------------------------------------------------- resendInvite
  describe('resendInvite', () => {
    it('404 member_not_found for an unknown id', async () => {
      repository.findMembershipById.mockResolvedValue(null);

      await expectStatus(
        service.resendInvite('mid-404', actor),
        'member_not_found',
        404,
      );
    });

    it('409 already_member when the row is already ACTIVE', async () => {
      repository.findMembershipById.mockResolvedValue(member());

      await expectStatus(
        service.resendInvite('mid-1', actor),
        'already_member',
        409,
      );
    });

    it('403 member_policy_forbidden when the actor cannot invite the target role', async () => {
      const hr: SessionUser = { ...actor, role: 'HR' };
      repository.findMembershipById.mockResolvedValue(
        member({
          status: 'INVITED',
          role: 'Admin',
          userId: null,
          email: 'other@example.com',
        }),
      );

      await expectStatus(
        service.resendInvite('mid-1', hr),
        'member_policy_forbidden',
        403,
      );
    });

    it('regenerates the token and requeues the mail for an INVITED row', async () => {
      repository.findMembershipByEmail.mockResolvedValue(null);
      repository.findMembershipById.mockResolvedValue(
        member({ status: 'INVITED', userId: null }),
      );

      const { message } = await service.resendInvite('mid-1', actor);

      expect(message).toEqual(expect.any(String));
      expect(pipeline.set).toHaveBeenCalledWith(
        expect.stringMatching(/^members:invite:[0-9a-f]{64}$/),
        'mid-1',
        'EX',
        INVITE_TOKEN_TTL_SECONDS,
      );
      expect(mailQueue.enqueueInviteMember).toHaveBeenCalledWith('mid-1');
    });
  });

  // ------------------------------------------------------------- changeRole
  describe('changeRole', () => {
    const dto = (role: string): ChangeMemberRoleDto =>
      ({ role }) as ChangeMemberRoleDto;

    it('404 member_not_found when no org exists (defensive singleton path)', async () => {
      repository.findOrganization.mockResolvedValue(null);

      await expectStatus(
        service.changeRole('mid-1', dto('PM'), actor),
        'member_not_found',
        404,
      );
    });

    it('403 self_manage_forbidden — no self-demotion for any actor', async () => {
      repository.findMembershipById.mockResolvedValue(
        member({ userId: actor.userId, email: actor.email, role: 'Admin' }),
      );

      await expectStatus(
        service.changeRole('mid-1', dto('Dev'), actor),
        'self_manage_forbidden',
        403,
      );
      expect(repository.changeRole).not.toHaveBeenCalled();
    });

    it('403 member_policy_forbidden — HR cannot demote another HR', async () => {
      const hrActor: SessionUser = { ...actor, role: 'HR' };
      repository.findMembershipById.mockResolvedValue(member({ role: 'HR' }));

      await expectStatus(
        service.changeRole('mid-1', dto('Dev'), hrActor),
        'member_policy_forbidden',
        403,
      );
    });

    it('Admin may demote a peer Admin — the matrix allows Admin → Admin management', async () => {
      repository.findMembershipById.mockResolvedValue(
        member({ role: 'Admin', userId: 'peer-admin' }),
      );
      repository.changeRole.mockResolvedValue({
        outcome: 'changed',
        member: member({ role: 'PM', userId: 'peer-admin' }),
      } satisfies ChangeRoleResult);

      await expect(
        service.changeRole('mid-1', dto('PM'), actor),
      ).resolves.toEqual({
        message: expect.any(String),
      });
      expect(repository.changeRole).toHaveBeenCalledWith('mid-1', 'PM');
      expect(sessions.updateRoleForUser).toHaveBeenCalledWith(
        'peer-admin',
        'PM',
      );
    });

    it('same-role is a 200 no-op: no transaction, no sessions, no lock', async () => {
      repository.findMembershipById.mockResolvedValue(member({ role: 'Dev' }));

      await service.changeRole('mid-1', dto('Dev'), actor);

      expect(repository.changeRole).not.toHaveBeenCalled();
      expect(sessions.updateRoleForUser).not.toHaveBeenCalled();
    });

    it('ACTIVE change patches the target sessions with the fresh role', async () => {
      repository.findMembershipById.mockResolvedValue(member({ role: 'Dev' }));
      repository.changeRole.mockResolvedValue({
        outcome: 'changed',
        member: member({ status: 'ACTIVE', role: 'PM', userId: 'target-1' }),
      } satisfies ChangeRoleResult);

      await service.changeRole('mid-1', dto('PM'), actor);

      expect(repository.changeRole).toHaveBeenCalledWith('mid-1', 'PM');
      expect(sessions.updateRoleForUser).toHaveBeenCalledWith('target-1', 'PM');
    });

    it('INVITED change writes invitedRole only — sessions are never touched', async () => {
      repository.findMembershipById.mockResolvedValue(
        member({
          status: 'INVITED',
          role: 'Dev',
          userId: null,
          email: 'new@example.com',
        }),
      );
      repository.changeRole.mockResolvedValue({
        outcome: 'changed',
        member: member({ status: 'INVITED', role: 'PM', userId: null }),
      } satisfies ChangeRoleResult);

      await service.changeRole('mid-1', dto('PM'), actor);

      expect(repository.changeRole).toHaveBeenCalledWith('mid-1', 'PM');
      expect(sessions.updateRoleForUser).not.toHaveBeenCalled();
    });

    it('403 last_admin_required when the rollback invariant trips', async () => {
      repository.findMembershipById.mockResolvedValue(
        member({ role: 'Admin', userId: 'other-admin' }),
      );
      repository.changeRole.mockResolvedValue({
        outcome: 'last_admin',
      } satisfies ChangeRoleResult);

      await expectStatus(
        service.changeRole('mid-1', dto('Dev'), actor),
        'last_admin_required',
        403,
      );
      expect(sessions.updateRoleForUser).not.toHaveBeenCalled();
    });

    it('404 member_not_found when the row vanished under the lock', async () => {
      repository.findMembershipById.mockResolvedValue(member());
      repository.changeRole.mockResolvedValue({
        outcome: 'not_found',
      } satisfies ChangeRoleResult);

      await expectStatus(
        service.changeRole('mid-1', dto('PM'), actor),
        'member_not_found',
        404,
      );
    });
  });

  // ----------------------------------------------------------------- remove
  describe('remove', () => {
    it('403 self_manage_forbidden — no self-removal', async () => {
      repository.findMembershipById.mockResolvedValue(
        member({ userId: actor.userId, email: actor.email }),
      );

      await expectStatus(
        service.remove('mid-1', actor),
        'self_manage_forbidden',
        403,
      );
      expect(repository.removeMember).not.toHaveBeenCalled();
    });

    it('403 member_policy_forbidden — PM cannot remove HR', async () => {
      const pm: SessionUser = { ...actor, role: 'PM' };
      repository.findMembershipById.mockResolvedValue(member({ role: 'HR' }));

      await expectStatus(
        service.remove('mid-1', pm),
        'member_policy_forbidden',
        403,
      );
    });

    it('ACTIVE removal revokes sessions and kills the invite token', async () => {
      repository.findMembershipById.mockResolvedValue(member());
      repository.removeMember.mockResolvedValue({
        outcome: 'removed',
        wasActive: true,
        userId: 'target-1',
      } satisfies RemoveMemberResult);
      redis.get.mockResolvedValueOnce('token-abc');

      await service.remove('mid-1', actor);

      expect(sessions.revokeAllForUser).toHaveBeenCalledWith('target-1');
      expect(pipeline.del).toHaveBeenCalledWith(inviteMembershipKey('mid-1'));
      expect(pipeline.del).toHaveBeenCalledWith(inviteTokenKey('token-abc'));
    });

    it('a failing session revoke still completes the removal (best-effort, logged)', async () => {
      repository.findMembershipById.mockResolvedValue(member());
      repository.removeMember.mockResolvedValue({
        outcome: 'removed',
        wasActive: true,
        userId: 'target-1',
      } satisfies RemoveMemberResult);
      sessions.revokeAllForUser.mockRejectedValue(new Error('redis down'));

      await expect(service.remove('mid-1', actor)).resolves.toEqual({
        message: expect.any(String),
      });
      expect(log.error).toHaveBeenCalledWith(
        'session revoke after removal failed',
        expect.objectContaining({ userId: 'target-1' }),
      );
    });

    it('INVITED removal skips session revocation but still burns the token', async () => {
      repository.findMembershipById.mockResolvedValue(
        member({ status: 'INVITED', userId: null, email: 'new@example.com' }),
      );
      repository.removeMember.mockResolvedValue({
        outcome: 'removed',
        wasActive: false,
        userId: null,
      } satisfies RemoveMemberResult);
      redis.get.mockResolvedValueOnce('token-abc');

      await service.remove('mid-1', actor);

      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
      expect(pipeline.del).toHaveBeenCalledWith(inviteTokenKey('token-abc'));
    });

    it('403 last_admin_required when removing the final ACTIVE Admin', async () => {
      repository.findMembershipById.mockResolvedValue(
        member({ role: 'Admin', userId: 'other-admin' }),
      );
      repository.removeMember.mockResolvedValue({
        outcome: 'last_admin',
      } satisfies RemoveMemberResult);

      await expectStatus(
        service.remove('mid-1', actor),
        'last_admin_required',
        403,
      );
    });

    it('403 project_last_lead_required when the target is the sole lead of a project', async () => {
      repository.findMembershipById.mockResolvedValue(member());
      repository.removeMember.mockResolvedValue({
        outcome: 'sole_lead',
      } satisfies RemoveMemberResult);

      await expectStatus(
        service.remove('mid-1', actor),
        'project_last_lead_required',
        403,
      );
      // Rolled back — no session side effects may leak.
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('INVITED rows are never blocked by the lead invariant (no ACTIVE projects)', async () => {
      repository.findMembershipById.mockResolvedValue(
        member({ status: 'INVITED', userId: null, email: 'new@example.com' }),
      );
      repository.removeMember.mockResolvedValue({
        outcome: 'removed',
        wasActive: false,
        userId: null,
      } satisfies RemoveMemberResult);

      await expect(service.remove('mid-1', actor)).resolves.toEqual({
        message: expect.any(String),
      });
    });
  });

  // -------------------------------------------------------- getInvitePreview
  describe('getInvitePreview', () => {
    it('404 for an unknown token (no Redis hit)', async () => {
      redis.get.mockResolvedValue(null);

      await expectStatus(
        service.getInvitePreview('bogus'),
        'invite_invalid_or_expired',
        404,
      );
      expect(repository.findInvitePreview).not.toHaveBeenCalled();
    });

    it('404 when the row behind the token vanished or is no longer INVITED', async () => {
      redis.get.mockResolvedValue('mid-1');
      repository.findInvitePreview.mockResolvedValue(null);

      await expectStatus(
        service.getInvitePreview('token'),
        'invite_invalid_or_expired',
        404,
      );
    });

    it('returns the preview (token is the capability)', async () => {
      const preview = new InvitePreview({
        email: 'grace@example.com',
        orgName: 'Acme',
        role: 'Dev',
        accountState: 'none',
      });
      redis.get.mockResolvedValue('mid-1');
      repository.findInvitePreview.mockResolvedValue(preview);

      await expect(service.getInvitePreview('token')).resolves.toBe(preview);
      expect(repository.findInvitePreview).toHaveBeenCalledWith('mid-1');
    });
  });

  // ------------------------------------------------------------ acceptInvite
  describe('acceptInvite', () => {
    const invitedDetail = (overrides: {
      emailVerifiedAt: Date | null;
      email?: string;
      status?: 'INVITED' | 'ACTIVE';
    }) => ({
      member: member({
        status: overrides.status ?? 'INVITED',
        role: 'Admin',
        userId: null,
        email: overrides.email ?? actor.email,
      }),
      emailVerifiedAt: overrides.emailVerifiedAt,
    });

    it('404 when the token does not resolve', async () => {
      redis.get.mockResolvedValue(null);

      await expectStatus(
        service.acceptInvite('bogus', actor),
        'invite_invalid_or_expired',
        404,
      );
      expect(repository.accept).not.toHaveBeenCalled();
    });

    it('403 invite_email_mismatch when the session email differs', async () => {
      redis.get.mockResolvedValue('mid-1');
      repository.findMembershipDetailById.mockResolvedValue(
        invitedDetail({
          emailVerifiedAt: new Date(),
          email: 'other@example.com',
        }),
      );

      await expectStatus(
        service.acceptInvite('token', actor),
        'invite_email_mismatch',
        403,
      );
      expect(repository.accept).not.toHaveBeenCalled();
    });

    it('403 email_unverified for an unconfirmed invitee', async () => {
      redis.get.mockResolvedValue('mid-1');
      repository.findMembershipDetailById.mockResolvedValue(
        invitedDetail({ emailVerifiedAt: null }),
      );

      await expectStatus(
        service.acceptInvite('token', actor),
        'email_unverified',
        403,
      );
    });

    it('409 already_member when the row flipped to ACTIVE (idempotent accept)', async () => {
      redis.get.mockResolvedValue('mid-1');
      repository.findMembershipDetailById.mockResolvedValue(
        invitedDetail({ emailVerifiedAt: new Date(), status: 'ACTIVE' }),
      );
      repository.accept.mockResolvedValue({
        outcome: 'already',
      } satisfies AcceptResult);

      await expectStatus(
        service.acceptInvite('token', actor),
        'already_member',
        409,
      );
    });

    it('404 when the row is deleted between the detail read and the locked tx', async () => {
      redis.get.mockResolvedValue('mid-1');
      repository.findMembershipDetailById.mockResolvedValue(
        invitedDetail({ emailVerifiedAt: new Date() }),
      );
      repository.accept.mockResolvedValue({
        outcome: 'gone',
      } satisfies AcceptResult);

      await expectStatus(
        service.acceptInvite('token', actor),
        'invite_invalid_or_expired',
        404,
      );
    });

    it('accepts: burns the token, patches every live session to the invited role', async () => {
      redis.get
        .mockResolvedValueOnce('mid-1') // membershipIdForToken
        .mockResolvedValueOnce('token-abc'); // consumeInviteToken: mid → token
      repository.findMembershipDetailById.mockResolvedValue(
        invitedDetail({ emailVerifiedAt: new Date() }),
      );
      repository.accept.mockResolvedValue({
        outcome: 'accepted',
        member: member({
          status: 'ACTIVE',
          role: 'Admin',
          userId: actor.userId,
          email: actor.email,
        }),
      } satisfies AcceptResult);

      const { message } = await service.acceptInvite('token', actor);

      expect(message).toEqual(expect.any(String));
      expect(repository.accept).toHaveBeenCalledWith('mid-1', actor.userId);
      expect(pipeline.del).toHaveBeenCalledWith(inviteMembershipKey('mid-1'));
      expect(sessions.updateRoleForUser).toHaveBeenCalledWith(
        actor.userId,
        'Admin',
      );
    });
  });
});
