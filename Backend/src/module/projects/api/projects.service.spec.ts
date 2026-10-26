import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { SessionUser } from '../../auth/api/session/session.types';
import { MembersRepository } from '../../members/api/repositories/members.repository';
import type { CreateProjectDto } from './dto/create-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectFactory } from './factories/project.factory';
import { ProjectsPolicy } from './policies/projects.policy';
import { ProjectsService } from './projects.service';
import type { ProjectView } from './repositories/projects.repository';
import { ProjectsRepository } from './repositories/projects.repository';

type ErrorShape = {
  status: number;
  response: { status: string; message?: string };
};

describe('ProjectsService', () => {
  let service: ProjectsService;

  const org = { id: 'org-1', name: 'Acme' };
  const T0 = new Date('2026-01-01T00:00:00Z');
  const T1 = new Date('2026-01-02T00:00:00Z');

  const admin: SessionUser = {
    userId: 'actor-1',
    role: 'Admin',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  };
  const pm: SessionUser = {
    userId: 'pm-1',
    role: 'PM',
    name: 'Maya Kim',
    email: 'maya@example.com',
  };
  const dev: SessionUser = {
    userId: 'dev-1',
    role: 'Dev',
    name: 'Grace Hopper',
    email: 'grace@example.com',
  };
  const hr: SessionUser = {
    userId: 'hr-1',
    role: 'HR',
    name: 'Helen Admin',
    email: 'hr@example.com',
  };

  const repository = {
    listProjects: jest.fn(),
    listProjectsForMember: jest.fn(),
    findProjectById: jest.fn(),
    findActiveOrgMemberships: jest.fn(),
    insertProjectWithMembers: jest.fn(),
    addMember: jest.fn(),
    removeMember: jest.fn(),
    setLead: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const membersRepository = {
    findOrganization: jest.fn(),
    findUserById: jest.fn(),
  };

  const projectView = (overrides: Partial<ProjectView> = {}): ProjectView => ({
    id: 'proj-1',
    organizationId: org.id,
    name: 'Website relaunch',
    color: '#1F2FE0',
    createdByUserId: admin.userId,
    createdByName: admin.name,
    createdAt: T0,
    updatedAt: T0,
    members: [
      {
        userId: admin.userId,
        name: admin.name,
        email: admin.email,
        role: 'Admin',
        isLead: true,
        addedAt: T0,
      },
      {
        userId: pm.userId,
        name: pm.name,
        email: pm.email,
        role: 'PM',
        isLead: false,
        addedAt: T1,
      },
      {
        userId: dev.userId,
        name: dev.name,
        email: dev.email,
        role: 'Dev',
        isLead: false,
        addedAt: T1,
      },
    ],
    ...overrides,
  });

  const createDto = (
    overrides: Partial<CreateProjectDto> = {},
  ): CreateProjectDto =>
    ({
      name: 'Website relaunch',
      leadUserIds: [admin.userId],
      ...overrides,
    }) as CreateProjectDto;

  const membershipFor = (user: SessionUser, role = user.role) => ({
    organizationMemberId: `om-${user.userId}`,
    userId: user.userId,
    role,
  });

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
            : httpStatus === 400
              ? BadRequestException
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
    membersRepository.findOrganization.mockResolvedValue(org);
    membersRepository.findUserById.mockResolvedValue(null);
    repository.listProjects.mockResolvedValue([]);
    repository.listProjectsForMember.mockResolvedValue([]);
    repository.findProjectById.mockResolvedValue(null);
    repository.findActiveOrgMemberships.mockResolvedValue([]);
    repository.insertProjectWithMembers.mockResolvedValue(projectView());
    repository.addMember.mockResolvedValue({
      outcome: 'inserted',
      project: projectView(),
    });
    repository.removeMember.mockResolvedValue({ outcome: 'removed' });
    repository.setLead.mockResolvedValue({ outcome: 'updated' });
    repository.update.mockResolvedValue(projectView());
    repository.remove.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        ProjectFactory,
        ProjectsPolicy,
        { provide: ProjectsRepository, useValue: repository },
        { provide: MembersRepository, useValue: membersRepository },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  // ---------------------------------------------------------------- create
  describe('create', () => {
    it('403 role_forbidden for HR and Dev (defense in depth behind RolesGuard)', async () => {
      for (const actor of [hr, dev]) {
        await expectStatus(
          service.create(createDto(), actor),
          'role_forbidden',
          403,
        );
      }
      expect(repository.insertProjectWithMembers).not.toHaveBeenCalled();
    });

    it('409 organization_required when no org row exists', async () => {
      membersRepository.findOrganization.mockResolvedValue(null);

      await expectStatus(
        service.create(createDto(), admin),
        'organization_required',
        409,
      );
    });

    it('400 lead_not_member when a lead is outside members ∪ {creator}', async () => {
      repository.findActiveOrgMemberships.mockResolvedValue([
        membershipFor(admin),
      ]);

      await expectStatus(
        service.create(createDto({ leadUserIds: ['stranger-9'] }), admin),
        'lead_not_member',
        400,
      );
      expect(repository.insertProjectWithMembers).not.toHaveBeenCalled();
    });

    it('400 lead_not_member when a lead is listed but is neither creator nor extra member', async () => {
      repository.findActiveOrgMemberships.mockResolvedValue([
        membershipFor(admin),
      ]);

      await expectStatus(
        service.create(
          createDto({ memberUserIds: [], leadUserIds: [dev.userId] }),
          admin,
        ),
        'lead_not_member',
        400,
      );
    });

    it('403 not_org_member naming the offender (email) for a user with no ACTIVE membership', async () => {
      repository.findActiveOrgMemberships.mockImplementation(
        async (_orgId: string, userIds: string[]) =>
          userIds
            .filter((userId) => userId === admin.userId)
            .map((userId) => membershipFor({ userId } as SessionUser)),
      );
      membersRepository.findUserById.mockResolvedValue({
        email: 'ghost@example.com',
      });

      try {
        await service.create(createDto({ memberUserIds: ['ghost-1'] }), admin);
        throw new Error('expected not_org_member');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ErrorShape).response.status).toBe('not_org_member');
        expect((error as ErrorShape).response.message).toContain(
          'ghost@example.com',
        );
      }
    });

    it('403 not_org_member falls back to the raw id when no account exists', async () => {
      repository.findActiveOrgMemberships.mockImplementation(
        async (_orgId: string, userIds: string[]) =>
          userIds
            .filter((userId) => userId === admin.userId)
            .map((userId) => membershipFor({ userId } as SessionUser)),
      );

      try {
        await service.create(createDto({ memberUserIds: ['ghost-1'] }), admin);
        throw new Error('expected not_org_member');
      } catch (error) {
        expect((error as ErrorShape).response.message).toContain('ghost-1');
      }
    });

    it('403 project_member_role_forbidden when a member target is HR', async () => {
      repository.findActiveOrgMemberships.mockImplementation(
        async (_orgId: string, userIds: string[]) =>
          userIds.map((userId) =>
            membershipFor({ userId } as SessionUser, 'HR'),
          ),
      );

      await expectStatus(
        service.create(createDto({ memberUserIds: ['hr-2'] }), admin),
        'project_member_role_forbidden',
        403,
      );
    });

    it('creates with the creator auto-added (not auto-lead), deduped members, flagged leads', async () => {
      repository.findActiveOrgMemberships.mockImplementation(
        async (_orgId: string, userIds: string[]) =>
          userIds.map((userId) =>
            membershipFor({ userId } as SessionUser, 'Dev'),
          ),
      );

      const result = await service.create(
        createDto({
          // Dupes + the creator — creator is filtered out of the extras.
          memberUserIds: [dev.userId, dev.userId, admin.userId],
          leadUserIds: [dev.userId],
        }),
        admin,
      );

      expect(result).toEqual(projectView());
      expect(repository.insertProjectWithMembers).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: org.id,
          name: 'Website relaunch',
          createdByUserId: admin.userId,
        }),
        [
          {
            organizationMemberId: `om-${admin.userId}`,
            userId: admin.userId,
            isLead: false,
            addedByUserId: null,
          },
          {
            organizationMemberId: `om-${dev.userId}`,
            userId: dev.userId,
            isLead: true,
            addedByUserId: admin.userId,
          },
        ],
      );
    });

    it('403 lead_role_forbidden when the creator (non-Dev) is listed as a lead', async () => {
      repository.findActiveOrgMemberships.mockResolvedValue([
        membershipFor(admin),
      ]);

      await expectStatus(
        service.create(createDto({ leadUserIds: [admin.userId] }), admin),
        'lead_role_forbidden',
        403,
      );
      expect(repository.insertProjectWithMembers).not.toHaveBeenCalled();
    });

    it('PM may create with a Dev lead', async () => {
      repository.findActiveOrgMemberships.mockImplementation(
        async (_orgId: string, userIds: string[]) =>
          userIds.map((userId) =>
            membershipFor(userId === pm.userId ? pm : dev),
          ),
      );

      await service.create(
        createDto({
          memberUserIds: [dev.userId],
          leadUserIds: [dev.userId],
        }),
        pm,
      );

      expect(repository.insertProjectWithMembers).toHaveBeenCalled();
    });

    it('403 lead_role_forbidden when a member lead is not a Dev', async () => {
      repository.findActiveOrgMemberships.mockImplementation(
        async (_orgId: string, userIds: string[]) =>
          userIds.map((userId) =>
            membershipFor(userId === pm.userId ? pm : admin),
          ),
      );

      await expectStatus(
        service.create(
          createDto({ memberUserIds: [pm.userId], leadUserIds: [pm.userId] }),
          admin,
        ),
        'lead_role_forbidden',
        403,
      );
      expect(repository.insertProjectWithMembers).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------ list
  describe('list', () => {
    it('Admin sees every project (no member filter)', async () => {
      repository.listProjects.mockResolvedValue([projectView()]);

      const { projects } = await service.list(admin);

      expect(repository.listProjects).toHaveBeenCalledWith(org.id);
      expect(repository.listProjectsForMember).not.toHaveBeenCalled();
      expect(projects).toHaveLength(1);
    });

    it('HR sees every project despite never being a member (role-based branch)', async () => {
      repository.listProjects.mockResolvedValue([projectView()]);

      const { projects } = await service.list(hr);

      expect(repository.listProjects).toHaveBeenCalledWith(org.id);
      expect(projects).toHaveLength(1);
    });

    it('PM and Dev only see projects they belong to', async () => {
      repository.listProjectsForMember.mockResolvedValue([]);

      await service.list(pm);
      expect(repository.listProjectsForMember).toHaveBeenCalledWith(
        org.id,
        pm.userId,
      );

      await service.list(dev);
      expect(repository.listProjectsForMember).toHaveBeenCalledWith(
        org.id,
        dev.userId,
      );
      expect(repository.listProjects).not.toHaveBeenCalled();
    });

    it('Dev with zero memberships gets an empty list (never 403/404)', async () => {
      await expect(service.list(dev)).resolves.toEqual({ projects: [] });
    });

    it('no organization → empty list', async () => {
      membersRepository.findOrganization.mockResolvedValue(null);

      await expect(service.list(admin)).resolves.toEqual({ projects: [] });
      expect(repository.listProjects).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------- findOne
  describe('findOne', () => {
    it('Admin sees a project they are not a member of', async () => {
      repository.findProjectById.mockResolvedValue(
        projectView({ members: [] }),
      );

      await expect(service.findOne('proj-1', admin)).resolves.toEqual(
        projectView({ members: [] }),
      );
    });

    it('PM sees a project they belong to', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expect(service.findOne('proj-1', pm)).resolves.toEqual(
        projectView(),
      );
    });

    it('404 project_not_found for a PM on a project they are not in (invisible before policy)', async () => {
      repository.findProjectById.mockResolvedValue(
        projectView({
          members: [
            {
              userId: admin.userId,
              name: admin.name,
              email: admin.email,
              role: 'Admin',
              isLead: true,
              addedAt: T0,
            },
          ],
        }),
      );

      await expectStatus(
        service.findOne('proj-1', pm),
        'project_not_found',
        404,
      );
    });

    it('404 for a missing id — indistinguishable from invisible', async () => {
      repository.findProjectById.mockResolvedValue(null);

      await expectStatus(
        service.findOne('proj-404', admin),
        'project_not_found',
        404,
      );
    });
  });

  // ---------------------------------------------------------------- update
  describe('update', () => {
    it('400 empty_update when neither name nor color is present', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expectStatus(
        service.update('proj-1', {} as UpdateProjectDto, admin),
        'empty_update',
        400,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('403 role_forbidden for HR (can see, cannot manage)', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expectStatus(
        service.update('proj-1', { name: 'New' } as UpdateProjectDto, hr),
        'role_forbidden',
        403,
      );
    });

    it('403 role_forbidden for a Dev who is a member', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expectStatus(
        service.update('proj-1', { name: 'New' } as UpdateProjectDto, dev),
        'role_forbidden',
        403,
      );
    });

    it('404 for a PM on a project they are not in', async () => {
      repository.findProjectById.mockResolvedValue(
        projectView({
          members: [
            {
              userId: admin.userId,
              name: admin.name,
              email: admin.email,
              role: 'Admin',
              isLead: true,
              addedAt: T0,
            },
          ],
        }),
      );

      await expectStatus(
        service.update('proj-1', { name: 'New' } as UpdateProjectDto, pm),
        'project_not_found',
        404,
      );
    });

    it('Admin may rename/recolor any project', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await service.update(
        'proj-1',
        { name: 'Relaunch v2', color: '#2FB67C' } as UpdateProjectDto,
        admin,
      );

      expect(repository.update).toHaveBeenCalledWith('proj-1', {
        name: 'Relaunch v2',
        color: '#2FB67C',
      });
    });

    it('PM may update a project they belong to', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await service.update(
        'proj-1',
        { color: '#2FB67C' } as UpdateProjectDto,
        pm,
      );

      expect(repository.update).toHaveBeenCalledWith('proj-1', {
        color: '#2FB67C',
      });
    });
  });

  // ---------------------------------------------------------------- remove
  describe('remove', () => {
    it('Admin deletes any project', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expect(service.remove('proj-1', admin)).resolves.toEqual({
        message: expect.any(String),
      });
      expect(repository.remove).toHaveBeenCalledWith('proj-1');
    });

    it('404 for a PM on a project they are not in', async () => {
      repository.findProjectById.mockResolvedValue(
        projectView({ members: [] }),
      );

      await expectStatus(
        service.remove('proj-1', pm),
        'project_not_found',
        404,
      );
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('403 role_forbidden for HR', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expectStatus(service.remove('proj-1', hr), 'role_forbidden', 403);
    });
  });

  // ------------------------------------------------------------- addMember
  describe('addMember', () => {
    const dto = (userId: string) => ({ userId });

    it('403 not_org_member for a user with no ACTIVE org membership', async () => {
      repository.findProjectById.mockResolvedValue(projectView());
      repository.findActiveOrgMemberships.mockResolvedValue([]);
      membersRepository.findUserById.mockResolvedValue({
        email: 'ghost@example.com',
      });

      await expectStatus(
        service.addMember('proj-1', dto('ghost-1'), admin),
        'not_org_member',
        403,
      );
      expect(repository.addMember).not.toHaveBeenCalled();
    });

    it('403 project_member_role_forbidden for an HR target', async () => {
      repository.findProjectById.mockResolvedValue(projectView());
      repository.findActiveOrgMemberships.mockResolvedValue([
        membershipFor({ userId: 'hr-2' } as SessionUser, 'HR'),
      ]);

      await expectStatus(
        service.addMember('proj-1', dto('hr-2'), admin),
        'project_member_role_forbidden',
        403,
      );
    });

    it('409 already_project_member when the insert races to 23505', async () => {
      repository.findProjectById.mockResolvedValue(projectView());
      repository.findActiveOrgMemberships.mockResolvedValue([
        membershipFor({ userId: 'dev-9' } as SessionUser, 'Dev'),
      ]);
      repository.addMember.mockResolvedValue({ outcome: 'conflict' });

      await expectStatus(
        service.addMember('proj-1', dto('dev-9'), admin),
        'already_project_member',
        409,
      );
    });

    it('inserts a non-lead row with the actor as adder and returns the refreshed project', async () => {
      repository.findProjectById.mockResolvedValue(projectView());
      repository.findActiveOrgMemberships.mockResolvedValue([
        membershipFor({ userId: 'dev-9' } as SessionUser, 'Dev'),
      ]);

      const result = await service.addMember('proj-1', dto('dev-9'), pm);

      expect(result).toEqual(projectView());
      expect(repository.addMember).toHaveBeenCalledWith('proj-1', {
        organizationMemberId: 'om-dev-9',
        userId: 'dev-9',
        isLead: false,
        addedByUserId: pm.userId,
      });
    });
  });

  // ----------------------------------------------------------- removeMember
  describe('removeMember', () => {
    it('403 self_remove_forbidden — no self-service, Admin included', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expectStatus(
        service.removeMember('proj-1', admin.userId, admin),
        'self_remove_forbidden',
        403,
      );
      expect(repository.removeMember).not.toHaveBeenCalled();
    });

    it('404 project_member_not_found when the user is not on the project', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expectStatus(
        service.removeMember('proj-1', 'ghost-1', admin),
        'project_member_not_found',
        404,
      );
    });

    it('403 project_remove_forbidden when a PM targets an Admin', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expectStatus(
        service.removeMember('proj-1', admin.userId, pm),
        'project_remove_forbidden',
        403,
      );
    });

    it('403 project_remove_forbidden when a PM targets a peer PM', async () => {
      repository.findProjectById.mockResolvedValue(
        projectView({
          members: [
            ...projectView().members,
            {
              userId: 'pm-2',
              name: 'Peer PM',
              email: 'peer@example.com',
              role: 'PM',
              isLead: false,
              addedAt: T1,
            },
          ],
        }),
      );
      const otherPm: SessionUser = { ...pm, userId: 'pm-2' };

      await expectStatus(
        service.removeMember('proj-1', pm.userId, otherPm),
        'project_remove_forbidden',
        403,
      );
    });

    it('PM may remove a Dev target', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await service.removeMember('proj-1', dev.userId, pm);

      expect(repository.removeMember).toHaveBeenCalledWith(
        'proj-1',
        dev.userId,
      );
    });

    it('Admin may remove any non-self member', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await service.removeMember('proj-1', pm.userId, admin);

      expect(repository.removeMember).toHaveBeenCalledWith('proj-1', pm.userId);
    });

    it('403 last_lead_required when the repository rolls back the invariant', async () => {
      repository.findProjectById.mockResolvedValue(projectView());
      repository.removeMember.mockResolvedValue({ outcome: 'last_lead' });

      await expectStatus(
        service.removeMember('proj-1', pm.userId, admin),
        'last_lead_required',
        403,
      );
    });

    it('404 when the row vanished under the lock', async () => {
      repository.findProjectById.mockResolvedValue(projectView());
      repository.removeMember.mockResolvedValue({ outcome: 'not_found' });

      await expectStatus(
        service.removeMember('proj-1', pm.userId, admin),
        'project_member_not_found',
        404,
      );
    });

    it('returns the refreshed project after a successful removal', async () => {
      repository.findProjectById
        .mockResolvedValueOnce(projectView())
        .mockResolvedValueOnce(projectView({ name: 'Refreshed' }));

      const result = await service.removeMember('proj-1', pm.userId, admin);

      expect(result.name).toBe('Refreshed');
    });
  });

  // --------------------------------------------------------------- setLead
  describe('setLead', () => {
    it('404 project_member_not_found for a user not on the project', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expectStatus(
        service.setLead('proj-1', 'ghost-1', { isLead: true }, admin),
        'project_member_not_found',
        404,
      );
    });

    it('same-value is a 200 no-op — no transaction, no lock', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      const result = await service.setLead(
        'proj-1',
        pm.userId,
        { isLead: false },
        admin,
      );

      expect(result).toEqual(projectView());
      expect(repository.setLead).not.toHaveBeenCalled();
    });

    it('promotion is a plain update', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await service.setLead('proj-1', dev.userId, { isLead: true }, admin);

      expect(repository.setLead).toHaveBeenCalledWith(
        'proj-1',
        dev.userId,
        true,
      );
    });

    it('403 lead_role_forbidden when promoting a non-Dev member', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expectStatus(
        service.setLead('proj-1', pm.userId, { isLead: true }, admin),
        'lead_role_forbidden',
        403,
      );
      expect(repository.setLead).not.toHaveBeenCalled();
    });

    it('403 last_lead_required when demoting the final lead', async () => {
      repository.findProjectById.mockResolvedValue(projectView());
      repository.setLead.mockResolvedValue({ outcome: 'last_lead' });

      await expectStatus(
        service.setLead('proj-1', admin.userId, { isLead: false }, admin),
        'last_lead_required',
        403,
      );
    });

    it('403 role_forbidden for HR (can see, cannot manage)', async () => {
      repository.findProjectById.mockResolvedValue(projectView());

      await expectStatus(
        service.setLead('proj-1', pm.userId, { isLead: true }, hr),
        'role_forbidden',
        403,
      );
    });

    it('returns the refreshed project after a successful toggle', async () => {
      repository.findProjectById
        .mockResolvedValueOnce(projectView())
        .mockResolvedValueOnce(projectView({ name: 'Refreshed' }));

      const result = await service.setLead(
        'proj-1',
        dev.userId,
        { isLead: true },
        admin,
      );

      expect(result.name).toBe('Refreshed');
    });
  });
});
