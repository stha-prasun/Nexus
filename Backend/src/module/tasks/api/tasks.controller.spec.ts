import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../../../common/decorators';
import type { AuthenticatedRequest } from '../../auth/api/guards/session-auth.guard';
import { SessionAuthGuard } from '../../auth/api/guards/session-auth.guard';
import { SessionService } from '../../auth/api/session/session.service';
import { ActiveMemberGuard } from '../../members/api/guards/active-member.guard';
import { MembersRepository } from '../../members/api/repositories/members.repository';
import { Task } from './entities/task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

describe('TasksController', () => {
  let controller: TasksController;

  const tasksService = {
    create: jest.fn(),
    list: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    changeStatus: jest.fn(),
    assign: jest.fn(),
    remove: jest.fn(),
  };

  const T0 = new Date('2026-01-01T00:00:00Z');

  const taskEntity = (
    overrides: Partial<ConstructorParameters<typeof Task>[0]> = {},
  ): Task =>
    new Task({
      id: 'task-1',
      projectId: 'proj-1',
      seq: 4,
      key: 'WR-4',
      title: 'Wire up auth flow',
      description: '',
      status: 'todo',
      priority: 'medium',
      assignee: null,
      dueDate: null,
      createdByUserId: 'actor-1',
      createdByName: 'Ada',
      createdAt: T0,
      updatedAt: T0,
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

  const handler = (name: keyof TasksController): Handler =>
    (TasksController.prototype as unknown as Record<string, Handler>)[name];

  const guardsOf = (target: Handler): unknown[] =>
    Reflect.getMetadata(GUARDS_METADATA, target) ?? [];

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        { provide: TasksService, useValue: tasksService },
        // Guard dependencies must be resolvable on the controller module.
        { provide: SessionService, useValue: {} },
        { provide: MembersRepository, useValue: {} },
      ],
    }).compile();

    controller = module.get<TasksController>(TasksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('guard composition', () => {
    it('every route: session + ActiveMemberGuard — and deliberately NO @Roles (the matrix is role+membership sensitive)', () => {
      for (const name of [
        'create',
        'list',
        'findOne',
        'update',
        'changeStatus',
        'assign',
        'remove',
      ] as const) {
        expect(guardsOf(handler(name))).toEqual([
          SessionAuthGuard,
          ActiveMemberGuard,
        ]);
        // No RolesGuard anywhere and no @Roles metadata: a Dev's self-create
        // and a Lead's assign both have to pass the same service-side matrix.
        expect(Reflect.getMetadata(ROLES_KEY, handler(name))).toBeUndefined();
      }
    });

    it('POST create answers 201; assign and DELETE answer 200', () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('create'))).toBe(
        201,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('assign'))).toBe(
        200,
      );
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('remove'))).toBe(
        200,
      );
      // GET/PATCH routes carry no explicit code (default 200).
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, handler('list')),
      ).toBeUndefined();
    });
  });

  describe('delegation', () => {
    it('create forwards projectId + dto + session user and wraps the task', async () => {
      tasksService.create.mockResolvedValue(taskEntity());
      const dto = { title: 'Wire up auth flow' };

      const result = await controller.create('proj-1', dto as never, request());

      expect(tasksService.create).toHaveBeenCalledWith(
        'proj-1',
        dto,
        request().user,
      );
      expect(result).toEqual({
        task: expect.objectContaining({ id: 'task-1', key: 'WR-4' }),
      });
    });

    it('list forwards projectId + session user and maps views to responses', async () => {
      tasksService.list.mockResolvedValue({ tasks: [taskEntity()] });

      const result = await controller.list('proj-1', request());

      expect(tasksService.list).toHaveBeenCalledWith('proj-1', request().user);
      expect(result.tasks).toEqual([
        expect.objectContaining({ id: 'task-1', key: 'WR-4' }),
      ]);
    });

    it('findOne forwards taskId + session user', async () => {
      tasksService.findOne.mockResolvedValue(taskEntity());

      const result = await controller.findOne('task-1', request());

      expect(tasksService.findOne).toHaveBeenCalledWith(
        'task-1',
        request().user,
      );
      expect(result.task).toEqual(expect.objectContaining({ id: 'task-1' }));
    });

    it('update forwards taskId + dto + session user', async () => {
      tasksService.update.mockResolvedValue(taskEntity());
      const dto = { title: 'Renamed' };

      await controller.update('task-1', dto as never, request());

      expect(tasksService.update).toHaveBeenCalledWith(
        'task-1',
        dto,
        request().user,
      );
    });

    it('changeStatus forwards taskId + dto + session user', async () => {
      tasksService.changeStatus.mockResolvedValue(taskEntity());
      const dto = { status: 'in_progress' };

      await controller.changeStatus('task-1', dto as never, request());

      expect(tasksService.changeStatus).toHaveBeenCalledWith(
        'task-1',
        dto,
        request().user,
      );
    });

    it('assign forwards taskId + dto + session user (200, not 201 — same-value no-op friendly)', async () => {
      tasksService.assign.mockResolvedValue(taskEntity());
      const dto = { assigneeId: null };

      const result = await controller.assign('task-1', dto as never, request());

      expect(tasksService.assign).toHaveBeenCalledWith(
        'task-1',
        dto,
        request().user,
      );
      expect(result.task).toEqual(expect.objectContaining({ id: 'task-1' }));
    });

    it('remove forwards taskId + session user and answers with a message', async () => {
      tasksService.remove.mockResolvedValue(undefined);

      const result = await controller.remove('task-1', request());

      expect(tasksService.remove).toHaveBeenCalledWith(
        'task-1',
        request().user,
      );
      expect(result).toEqual({
        message: 'Task deleted successfully.',
      });
    });
  });
});
