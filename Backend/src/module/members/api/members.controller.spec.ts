import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../../common/decorators';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../auth/api/guards/session-auth.guard';
import { SessionAuthGuard } from '../../auth/api/guards/session-auth.guard';
import { SessionService } from '../../auth/api/session/session.service';
import { ChangeMemberRoleDto } from './dto/change-member-role.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ActiveMemberGuard } from './guards/active-member.guard';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { MembersRepository } from './repositories/members.repository';

describe('MembersController', () => {
  let controller: MembersController;

  // @nestjs/throttler v6: @Throttle stores under 'THROTTLER:{LIMIT|TTL}' + tracker.
  const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';
  const THROTTLER_TTL_DEFAULT = 'THROTTLER:TTLdefault';

  const membersService = {
    list: jest.fn(),
    invite: jest.fn(),
    resendInvite: jest.fn(),
    changeRole: jest.fn(),
    remove: jest.fn(),
    getInvitePreview: jest.fn(),
    acceptInvite: jest.fn(),
  };

  const request = (): AuthenticatedRequest =>
    ({
      user: {
        userId: 'actor-1',
        role: 'Admin',
        name: 'Ada',
        email: 'ada@example.com',
      },
    }) as unknown as AuthenticatedRequest;

  type Handler = (...args: never[]) => unknown;

  const handler = (name: keyof MembersController): Handler =>
    (MembersController.prototype as unknown as Record<string, Handler>)[name];

  const guardsOf = (target: Handler): unknown[] =>
    Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

  const rolesOf = (target: Handler): unknown =>
    Reflect.getMetadata(ROLES_KEY, target);

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MembersController],
      providers: [
        { provide: MembersService, useValue: membersService },
        // Guard dependencies must be resolvable on the controller module.
        { provide: SessionService, useValue: {} },
        { provide: MembersRepository, useValue: {} },
      ],
    }).compile();

    controller = module.get<MembersController>(MembersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('guard composition', () => {
    it('GET roster: session + ActiveMemberGuard, no role gate (Dev may read)', () => {
      expect(guardsOf(handler('list'))).toEqual([
        SessionAuthGuard,
        ActiveMemberGuard,
      ]);
      expect(rolesOf(handler('list'))).toBeUndefined();
    });

    it('mutations: session + roles (Admin/HR/PM) + ActiveMemberGuard', () => {
      for (const name of [
        'invite',
        'resend',
        'changeRole',
        'remove',
      ] as const) {
        expect(guardsOf(handler(name))).toEqual([
          SessionAuthGuard,
          RolesGuard,
          ActiveMemberGuard,
        ]);
        expect(rolesOf(handler(name))).toEqual(['Admin', 'HR', 'PM']);
      }
    });

    it('invite, resend and accept are mail-bomb throttled (10 / 10min)', () => {
      for (const name of ['invite', 'resend', 'accept'] as const) {
        expect(
          Reflect.getMetadata(THROTTLER_LIMIT_DEFAULT, handler(name)),
        ).toBe(10);
        expect(Reflect.getMetadata(THROTTLER_TTL_DEFAULT, handler(name))).toBe(
          600_000,
        );
      }
    });

    it('public preview: no guards at all (token is the capability)', () => {
      expect(guardsOf(handler('preview'))).toEqual([]);
    });

    it('accept: session only, public accept routes are not role-gated', () => {
      expect(guardsOf(handler('accept'))).toEqual([SessionAuthGuard]);
      expect(rolesOf(handler('accept'))).toBeUndefined();
    });

    it('POST invite answers 201, DELETE answers 200', () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('invite'))).toBe(
        201,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('remove'))).toBe(
        200,
      );
    });
  });

  describe('delegation', () => {
    it('list passes the session user and maps entries to responses', async () => {
      membersService.list.mockResolvedValue({
        members: [
          {
            id: 'mid-1',
            name: 'Grace',
            email: 'grace@example.com',
            role: 'Dev',
            status: 'ACTIVE',
            invitedAt: new Date('2026-01-01T00:00:00Z'),
            acceptedAt: new Date('2026-01-02T00:00:00Z'),
            invitedBy: 'ada@example.com',
          },
        ],
      });

      const result = await controller.list(request());

      expect(membersService.list).toHaveBeenCalledWith(request().user);
      expect(result.members).toEqual([
        expect.objectContaining({ id: 'mid-1', role: 'Dev' }),
      ]);
    });

    it('invite forwards dto + session user', async () => {
      membersService.invite.mockResolvedValue({
        message: 'sent',
        created: true,
      });
      const dto = {
        email: 'grace@example.com',
        role: 'Dev',
      } as InviteMemberDto;

      const result = await controller.invite(dto, request());

      expect(membersService.invite).toHaveBeenCalledWith(dto, request().user);
      expect(result).toEqual({ message: 'sent' });
    });

    it('changeRole forwards id + dto + session user', async () => {
      membersService.changeRole.mockResolvedValue({ message: 'updated' });
      const dto = { role: 'PM' } as ChangeMemberRoleDto;

      await controller.changeRole('mid-1', dto, request());

      expect(membersService.changeRole).toHaveBeenCalledWith(
        'mid-1',
        dto,
        request().user,
      );
    });

    it('preview maps the entity to the response DTO', async () => {
      membersService.getInvitePreview.mockResolvedValue({
        email: 'grace@example.com',
        orgName: 'Acme',
        role: 'Dev',
        accountState: 'none',
      });

      const result = await controller.preview('token');

      expect(membersService.getInvitePreview).toHaveBeenCalledWith('token');
      expect(result).toEqual({
        email: 'grace@example.com',
        orgName: 'Acme',
        role: 'Dev',
        accountState: 'none',
        status: 'valid',
      });
    });

    it('accept forwards the token and session user', async () => {
      membersService.acceptInvite.mockResolvedValue({ message: 'joined' });

      const result = await controller.accept('token', request());

      expect(membersService.acceptInvite).toHaveBeenCalledWith(
        'token',
        request().user,
      );
      expect(result).toEqual({ message: 'joined' });
    });
  });
});
