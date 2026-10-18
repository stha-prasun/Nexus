import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { SessionUser } from '../../../auth/api/session/session.types';
import { MembersRepository } from '../repositories/members.repository';
import { ActiveMemberGuard } from './active-member.guard';

describe('ActiveMemberGuard', () => {
  let guard: ActiveMemberGuard;

  const repository = {
    findOrganization: jest.fn<
      Promise<{ id: string; name: string } | null>,
      []
    >(),
    findActiveMembershipOrg: jest.fn<
      Promise<{ id: string; name: string } | null>,
      [string]
    >(),
  };

  const actor: SessionUser = {
    userId: 'user-1',
    role: 'Admin',
    name: 'Ada',
    email: 'ada@example.com',
  };

  const contextWith = (user: SessionUser | undefined): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => (user === undefined ? {} : { user }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActiveMemberGuard,
        { provide: MembersRepository, useValue: repository },
      ],
    }).compile();

    guard = module.get<ActiveMemberGuard>(ActiveMemberGuard);
  });

  it('passes when no organization exists yet (the org-creation path)', async () => {
    repository.findOrganization.mockResolvedValue(null);

    await expect(guard.canActivate(contextWith(actor))).resolves.toBe(true);
    expect(repository.findActiveMembershipOrg).not.toHaveBeenCalled();
  });

  it('passes when the caller holds an ACTIVE membership', async () => {
    repository.findOrganization.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
    });
    repository.findActiveMembershipOrg.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
    });

    await expect(guard.canActivate(contextWith(actor))).resolves.toBe(true);
    expect(repository.findActiveMembershipOrg).toHaveBeenCalledWith(
      actor.userId,
    );
  });

  it('403 not_active_member when the org exists and the caller has no ACTIVE membership', async () => {
    repository.findOrganization.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
    });
    repository.findActiveMembershipOrg.mockResolvedValue(null);

    await expect(guard.canActivate(contextWith(actor))).rejects.toMatchObject({
      status: 403,
      response: {
        status: 'not_active_member',
        message: 'You are not an active member of this organization.',
      },
    });
  });

  it('fails closed when SessionAuthGuard did not attach a user', async () => {
    await expect(guard.canActivate(contextWith(undefined))).resolves.toBe(
      false,
    );
    expect(repository.findOrganization).not.toHaveBeenCalled();
  });

  it('fails closed (propagates 500) on a repository error — never silently passes', async () => {
    repository.findOrganization.mockRejectedValue(new Error('db down'));

    await expect(guard.canActivate(contextWith(actor))).rejects.toThrow(
      'db down',
    );
  });

  it('propagates membership-lookup failures too', async () => {
    repository.findOrganization.mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
    });
    repository.findActiveMembershipOrg.mockRejectedValue(new Error('db down'));

    await expect(guard.canActivate(contextWith(actor))).rejects.toThrow(
      'db down',
    );
    // Guard never turned an outage into a pass.
    expect(ForbiddenException).toBeDefined();
  });
});
