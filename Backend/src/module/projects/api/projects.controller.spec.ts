import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../../common/decorators';
import { RolesGuard } from '../../../common/guards/roles.guard';
import type { AuthenticatedRequest } from '../../auth/api/guards/session-auth.guard';
import { SessionAuthGuard } from '../../auth/api/guards/session-auth.guard';
import { SessionService } from '../../auth/api/session/session.service';
import { ActiveMemberGuard } from '../../members/api/guards/active-member.guard';
import { MembersRepository } from '../../members/api/repositories/members.repository';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import type { ProjectView } from './repositories/projects.repository';

describe('ProjectsController', () => {
  let controller: ProjectsController;

  const projectsService = {
    create: jest.fn(),
    list: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    addMember: jest.fn(),
    removeMember: jest.fn(),
    setLead: jest.fn(),
  };

  const projectView = (overrides: Partial<ProjectView> = {}): ProjectView => ({
    id: 'proj-1',
    organizationId: 'org-1',
    name: 'Website relaunch',
    description: null,
    color: '#1F2FE0',
    createdByUserId: 'actor-1',
    createdByName: 'Ada',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    members: [
      {
        userId: 'actor-1',
        name: 'Ada',
        email: 'ada@example.com',
        role: 'Admin',
        isLead: true,
        addedAt: new Date('2026-01-01T00:00:00Z'),
      },
    ],
    ...overrides,
  });

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

  const handler = (name: keyof ProjectsController): Handler =>
    (ProjectsController.prototype as unknown as Record<string, Handler>)[name];

  const guardsOf = (target: Handler): unknown[] =>
    Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

  const rolesOf = (target: Handler): unknown =>
    Reflect.getMetadata(ROLES_KEY, target);

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        { provide: ProjectsService, useValue: projectsService },
        // Guard dependencies must be resolvable on the controller module.
        { provide: SessionService, useValue: {} },
        { provide: MembersRepository, useValue: {} },
      ],
    }).compile();

    controller = module.get<ProjectsController>(ProjectsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('guard composition', () => {
    it('GET routes: session + ActiveMemberGuard, no role gate (every role may read)', () => {
      for (const name of ['list', 'findOne'] as const) {
        expect(guardsOf(handler(name))).toEqual([
          SessionAuthGuard,
          ActiveMemberGuard,
        ]);
        expect(rolesOf(handler(name))).toBeUndefined();
      }
    });

    it('mutation routes: session + roles (Admin/PM) + ActiveMemberGuard', () => {
      for (const name of [
        'create',
        'update',
        'remove',
        'addMember',
        'removeMember',
        'setLead',
      ] as const) {
        expect(guardsOf(handler(name))).toEqual([
          SessionAuthGuard,
          RolesGuard,
          ActiveMemberGuard,
        ]);
        expect(rolesOf(handler(name))).toEqual(['Admin', 'PM']);
      }
    });

    it('POST create/addMember answer 201; DELETE routes answer 200', () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('create'))).toBe(
        201,
      );
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, handler('addMember')),
      ).toBe(201);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('remove'))).toBe(
        200,
      );
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, handler('removeMember')),
      ).toBe(200);
    });
  });

  describe('delegation', () => {
    it('list passes the session user and maps views to responses', async () => {
      projectsService.list.mockResolvedValue({ projects: [projectView()] });

      const result = await controller.list(request());

      expect(projectsService.list).toHaveBeenCalledWith(request().user);
      expect(result.projects).toEqual([
        expect.objectContaining({ id: 'proj-1', name: 'Website relaunch' }),
      ]);
    });

    it('create forwards dto + session user and wraps the project', async () => {
      projectsService.create.mockResolvedValue(projectView());
      const dto = { name: 'Website relaunch', leadUserIds: ['actor-1'] };

      const result = await controller.create(dto as never, request());

      expect(projectsService.create).toHaveBeenCalledWith(dto, request().user);
      expect(result).toEqual({
        project: expect.objectContaining({ id: 'proj-1' }),
      });
    });

    it('findOne forwards id + session user', async () => {
      projectsService.findOne.mockResolvedValue(projectView());

      const result = await controller.findOne('proj-1', request());

      expect(projectsService.findOne).toHaveBeenCalledWith(
        'proj-1',
        request().user,
      );
      expect(result.project).toEqual(expect.objectContaining({ id: 'proj-1' }));
    });

    it('update forwards id + dto + session user', async () => {
      projectsService.update.mockResolvedValue(projectView());
      const dto = { name: 'Relaunch v2' };

      await controller.update('proj-1', dto as never, request());

      expect(projectsService.update).toHaveBeenCalledWith(
        'proj-1',
        dto,
        request().user,
      );
    });

    it('remove forwards id + session user and unwraps the message', async () => {
      projectsService.remove.mockResolvedValue({ message: 'Project deleted.' });

      const result = await controller.remove('proj-1', request());

      expect(projectsService.remove).toHaveBeenCalledWith(
        'proj-1',
        request().user,
      );
      expect(result).toEqual({ message: 'Project deleted.' });
    });

    it('addMember forwards id + dto + session user', async () => {
      projectsService.addMember.mockResolvedValue(projectView());
      const dto = { userId: 'dev-1' };

      const result = await controller.addMember(
        'proj-1',
        dto as never,
        request(),
      );

      expect(projectsService.addMember).toHaveBeenCalledWith(
        'proj-1',
        dto,
        request().user,
      );
      expect(result.project).toEqual(expect.objectContaining({ id: 'proj-1' }));
    });

    it('removeMember forwards id + userId + session user', async () => {
      projectsService.removeMember.mockResolvedValue(projectView());

      const result = await controller.removeMember(
        'proj-1',
        'dev-1',
        request(),
      );

      expect(projectsService.removeMember).toHaveBeenCalledWith(
        'proj-1',
        'dev-1',
        request().user,
      );
      expect(result.project).toEqual(expect.objectContaining({ id: 'proj-1' }));
    });

    it('setLead forwards id + userId + dto + session user', async () => {
      projectsService.setLead.mockResolvedValue(projectView());
      const dto = { isLead: true };

      await controller.setLead('proj-1', 'dev-1', dto as never, request());

      expect(projectsService.setLead).toHaveBeenCalledWith(
        'proj-1',
        'dev-1',
        dto,
        request().user,
      );
    });
  });
});
