import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { SessionUser } from '../../auth/api/session/session.types';
import {
  TASK_ASSIGNED_TITLE,
  TASK_ASSIGNED_TYPE,
} from '../../notifications/api/constants/notifications.constants';
import { NotificationFactory } from '../../notifications/api/factories/notification.factory';
import { NotificationsService } from '../../notifications/api/notifications.service';
import type { NotificationInsert } from '../../notifications/api/repositories/notifications.repository';
import type { CreateTaskDto } from './dto/create-task.dto';
import type { UpdateTaskDto } from './dto/update-task.dto';
import { Task } from './entities/task.entity';
import { TaskFactory } from './factories/task.factory';
import { TasksPolicy } from './policies/tasks.policy';
import type { ProjectScope } from './repositories/tasks.repository';
import { TasksRepository } from './repositories/tasks.repository';
import { TasksService } from './tasks.service';

type ErrorShape = {
  status: number;
  response: { status: string; message?: string };
};

describe('TasksService', () => {
  let service: TasksService;

  const T0 = new Date('2026-01-01T00:00:00Z');
  // Fixed "today" for the due-date rules — tests freeze the clock so the
  // past/today/future boundaries stay deterministic.
  const TODAY = '2026-06-15';

  const admin: SessionUser = {
    userId: 'actor-admin',
    role: 'Admin',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  };
  const pm: SessionUser = {
    userId: 'actor-pm',
    role: 'PM',
    name: 'Maya Kim',
    email: 'maya@example.com',
  };
  const dev: SessionUser = {
    userId: 'actor-dev',
    role: 'Dev',
    name: 'Grace Hopper',
    email: 'grace@example.com',
  };
  const hr: SessionUser = {
    userId: 'actor-hr',
    role: 'HR',
    name: 'Helen Admin',
    email: 'hr@example.com',
  };

  const memberScope: ProjectScope = {
    id: 'proj-1',
    name: 'Website relaunch',
    isMember: true,
    isLead: false,
  };
  const nonMemberScope: ProjectScope = { ...memberScope, isMember: false };

  const assignee = {
    id: 'user-dev-target',
    name: 'Dev Target',
    email: 't@example.com',
  };

  const taskEntity = (
    overrides: Partial<ConstructorParameters<typeof Task>[0]> = {},
  ) =>
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
      createdByUserId: admin.userId,
      createdByName: admin.name,
      createdAt: T0,
      updatedAt: T0,
      ...overrides,
    });

  const repository = {
    findProjectScope: jest.fn(),
    findRosterMembers: jest.fn(),
    listByProject: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    changeStatus: jest.fn(),
    assign: jest.fn(),
    remove: jest.fn(),
  };
  const notifications = {
    createForUser: jest.fn(),
    publishExisting: jest.fn(),
  };

  const createDto = (overrides: Partial<CreateTaskDto> = {}): CreateTaskDto =>
    ({ title: 'Wire up auth flow', ...overrides }) as CreateTaskDto;

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
    jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T12:00:00Z`));

    repository.findProjectScope.mockResolvedValue(memberScope);
    repository.findRosterMembers.mockResolvedValue([]);
    repository.listByProject.mockResolvedValue([]);
    repository.findById.mockResolvedValue(null);
    repository.create.mockImplementation(
      async (
        _input: { keyPrefix: string; assigneeId: string | null },
        notificationFor: (task: Task) => NotificationInsert | null,
      ) => {
        const task = taskEntity({ assignee: null });
        const notification = notificationFor(task);
        return { outcome: 'created' as const, task, notification };
      },
    );
    repository.update.mockResolvedValue(taskEntity());
    repository.changeStatus.mockResolvedValue(taskEntity());
    repository.assign.mockImplementation(
      async (
        _taskId: string,
        _assigneeId: string | null,
        notification: NotificationInsert | null,
      ) => ({
        outcome: 'assigned' as const,
        task: taskEntity(),
        notification,
      }),
    );
    repository.remove.mockResolvedValue(undefined);
    notifications.createForUser.mockResolvedValue(null);
    notifications.publishExisting.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        TaskFactory,
        TasksPolicy,
        NotificationFactory,
        { provide: TasksRepository, useValue: repository },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------- create
  describe('create', () => {
    it('404 task_project_not_found for a missing or invisible project', async () => {
      repository.findProjectScope.mockResolvedValue(null);
      await expectStatus(
        service.create('proj-1', createDto(), admin),
        'task_project_not_found',
        404,
      );

      repository.findProjectScope.mockResolvedValue(nonMemberScope);
      await expectStatus(
        service.create('proj-1', createDto(), pm),
        'task_project_not_found',
        404,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('403 role_forbidden for HR (defense in depth behind no @Roles)', async () => {
      await expectStatus(
        service.create('proj-1', createDto({ assigneeId: dev.userId }), hr),
        'role_forbidden',
        403,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('403 for a Dev whose assignee is not self, or omitted entirely', async () => {
      // Someone else — forbidden.
      await expectStatus(
        service.create('proj-1', createDto({ assigneeId: 'user-other' }), dev),
        'role_forbidden',
        403,
      );
      // Omitted — a Dev's create IS a self-assign, so missing target fails too.
      await expectStatus(
        service.create('proj-1', createDto(), dev),
        'role_forbidden',
        403,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('400 due_date_past for yesterday, but today and future pass', async () => {
      // Unassigned creates skip the roster entirely — isolates the date rule.
      await expectStatus(
        service.create('proj-1', createDto({ dueDate: '2026-06-14' }), admin),
        'due_date_past',
        400,
      );
      // Today passes — the boundary is inclusive.
      await expect(
        service.create('proj-1', createDto({ dueDate: TODAY }), admin),
      ).resolves.toBeDefined();
      await expect(
        service.create('proj-1', createDto({ dueDate: '2026-06-20' }), admin),
      ).resolves.toBeDefined();
    });

    it('400 assign_target_invalid when the target is not an ACTIVE project member', async () => {
      repository.findRosterMembers.mockResolvedValue([]);
      await expectStatus(
        service.create(
          'proj-1',
          createDto({ assigneeId: 'user-stranger' }),
          admin,
        ),
        'assign_target_invalid',
        400,
      );
    });

    it('admin create without assignee succeeds and writes no notification', async () => {
      const task = await service.create('proj-1', createDto(), admin);
      expect(task.key).toBe('WR-4');
      // The factory was invoked with null → nothing published.
      expect(notifications.publishExisting).not.toHaveBeenCalled();
    });

    it('PM assigning a Dev inserts the notification in-tx and publishes after commit', async () => {
      repository.findRosterMembers.mockResolvedValue([
        {
          userId: assignee.id,
          role: 'Dev',
          isMember: true,
          isActiveOrgMember: true,
        },
      ]);

      await service.create(
        'proj-1',
        createDto({ assigneeId: assignee.id }),
        pm,
      );

      // The in-tx factory produced a correctly-titled assignment row.
      const [, notificationFor] = repository.create.mock.calls[0] as [
        unknown,
        (task: Task) => NotificationInsert,
      ];
      const row = notificationFor(taskEntity());
      expect(row).toMatchObject({
        userId: assignee.id,
        type: TASK_ASSIGNED_TYPE,
        title: TASK_ASSIGNED_TITLE,
        dedupeKey: null,
      });
      // Publish happens only via the post-commit path.
      expect(notifications.publishExisting).toHaveBeenCalledWith(
        expect.objectContaining({ userId: assignee.id }),
      );
      expect(notifications.createForUser).not.toHaveBeenCalled();
    });

    it('Dev self-assign succeeds and is silent (no notification)', async () => {
      repository.findRosterMembers.mockResolvedValue([
        {
          userId: dev.userId,
          role: 'Dev',
          isMember: true,
          isActiveOrgMember: true,
        },
      ]);
      await expect(
        service.create('proj-1', createDto({ assigneeId: dev.userId }), dev),
      ).resolves.toBeDefined();
      expect(notifications.publishExisting).not.toHaveBeenCalled();
    });

    it('409 task_key_conflict on a unique(projectId, seq) race', async () => {
      repository.create.mockResolvedValue({ outcome: 'conflict' });
      await expectStatus(
        service.create('proj-1', createDto(), admin),
        'task_key_conflict',
        409,
      );
    });
  });

  // ---------------------------------------------------------------- findOne
  describe('findOne', () => {
    it('404 task_not_found for a missing task', async () => {
      repository.findById.mockResolvedValue(null);
      await expectStatus(
        service.findOne('task-1', admin),
        'task_not_found',
        404,
      );
    });

    it('404 for a task whose project is invisible (no existence leak)', async () => {
      repository.findById.mockResolvedValue(taskEntity());
      repository.findProjectScope.mockResolvedValue(nonMemberScope);
      await expectStatus(service.findOne('task-1', pm), 'task_not_found', 404);
    });
  });

  // ---------------------------------------------------------------- update
  describe('update', () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(taskEntity());
    });

    it('403 for a plain Dev assignee — status moves only, no field edits', async () => {
      await expectStatus(
        service.update(
          'task-1',
          { title: 'Sneaky edit' } as UpdateTaskDto,
          dev,
        ),
        'role_forbidden',
        403,
      );
    });

    it('400 empty_update when no editable field is present', async () => {
      await expectStatus(
        service.update('task-1', {} as UpdateTaskDto, admin),
        'empty_update',
        400,
      );
    });

    it('400 only when the due date *changes* to a past day (no-change exemption)', async () => {
      // Stored overdue date + a title-only edit → allowed (edge 3).
      repository.findById.mockResolvedValue(
        taskEntity({ dueDate: '2026-01-01' }),
      );
      await expect(
        service.update('task-1', { title: 'ok' } as UpdateTaskDto, admin),
      ).resolves.toBeDefined();

      // Same stored past date resubmitted unchanged → allowed.
      await expect(
        service.update(
          'task-1',
          { dueDate: '2026-01-01' } as UpdateTaskDto,
          admin,
        ),
      ).resolves.toBeDefined();

      // A *changed* past date → rejected.
      repository.findById.mockResolvedValue(
        taskEntity({ dueDate: '2026-01-01' }),
      );
      await expectStatus(
        service.update(
          'task-1',
          { dueDate: '2026-02-01' } as UpdateTaskDto,
          admin,
        ),
        'due_date_past',
        400,
      );
    });

    it('null clears the due date without a past-date check', async () => {
      repository.findById.mockResolvedValue(
        taskEntity({ dueDate: '2026-06-20' }),
      );
      await service.update('task-1', { dueDate: null } as UpdateTaskDto, admin);
      expect(repository.update).toHaveBeenCalledWith('task-1', {
        dueDate: null,
      });
    });
  });

  // ----------------------------------------------------------- changeStatus
  describe('changeStatus', () => {
    it('lets the assignee move their own card (a Dev moves their card)', async () => {
      repository.findById.mockResolvedValue(
        taskEntity({
          assignee: { id: dev.userId, name: dev.name, email: dev.email },
        }),
      );
      await expect(
        service.changeStatus('task-1', { status: 'in_progress' } as never, dev),
      ).resolves.toBeDefined();
      expect(repository.changeStatus).toHaveBeenCalledWith(
        'task-1',
        'in_progress',
      );
    });

    it('403 for a non-assignee Dev', async () => {
      repository.findById.mockResolvedValue(taskEntity({ assignee: null }));
      await expectStatus(
        service.changeStatus('task-1', { status: 'done' } as never, dev),
        'role_forbidden',
        403,
      );
    });
  });

  // ---------------------------------------------------------------- assign
  describe('assign', () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(taskEntity());
    });

    it('same-value assign is a 200 no-op — no lock, no notification', async () => {
      repository.findById.mockResolvedValue(
        taskEntity({ assignee: { id: assignee.id, name: 'T', email: 't@x' } }),
      );
      const task = await service.assign(
        'task-1',
        { assigneeId: assignee.id } as never,
        admin,
      );
      expect(task).toBeDefined();
      expect(repository.assign).not.toHaveBeenCalled();
      expect(notifications.publishExisting).not.toHaveBeenCalled();
    });

    it('400 assign_target_invalid when the matrix rejects the new target', async () => {
      repository.findRosterMembers.mockResolvedValue([
        {
          userId: 'user-hr-target',
          role: 'HR',
          isMember: true,
          isActiveOrgMember: true,
        },
      ]);
      await expectStatus(
        service.assign(
          'task-1',
          { assigneeId: 'user-hr-target' } as never,
          admin,
        ),
        'assign_target_invalid',
        400,
      );
    });

    it('unassign (null) always allowed and silent', async () => {
      repository.findById.mockResolvedValue(
        taskEntity({ assignee: { id: assignee.id, name: 'T', email: 't@x' } }),
      );
      await service.assign('task-1', { assigneeId: null } as never, admin);
      expect(repository.assign).toHaveBeenCalledWith('task-1', null, null);
      expect(notifications.publishExisting).not.toHaveBeenCalled();
    });

    it('publishes only when the assignee differs from the actor (A→B tells B)', async () => {
      repository.findRosterMembers.mockResolvedValue([
        {
          userId: assignee.id,
          role: 'Dev',
          isMember: true,
          isActiveOrgMember: true,
        },
      ]);
      await service.assign('task-1', { assigneeId: assignee.id } as never, pm);
      expect(notifications.publishExisting).toHaveBeenCalledWith(
        expect.objectContaining({ userId: assignee.id }),
      );
    });

    it('404 when the row vanished between read and update', async () => {
      // Task currently assigned → null is a real change, not a no-op.
      repository.findById.mockResolvedValue(
        taskEntity({ assignee: { id: assignee.id, name: 'T', email: 't@x' } }),
      );
      repository.assign.mockResolvedValue({ outcome: 'missing' });
      await expectStatus(
        service.assign('task-1', { assigneeId: null } as never, admin),
        'task_not_found',
        404,
      );
    });
  });

  // ---------------------------------------------------------------- remove
  describe('remove', () => {
    it('403 for a plain Dev', async () => {
      repository.findById.mockResolvedValue(taskEntity());
      await expectStatus(service.remove('task-1', dev), 'role_forbidden', 403);
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('admin deletes and the repository is invoked', async () => {
      repository.findById.mockResolvedValue(taskEntity());
      await service.remove('task-1', admin);
      expect(repository.remove).toHaveBeenCalledWith('task-1');
    });
  });
});
