import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UnauthenticatedResponseDto } from '../../auth/api/dto/auth-responses.dto';
import type { AuthenticatedRequest } from '../../auth/api/guards/session-auth.guard';
import { SessionAuthGuard } from '../../auth/api/guards/session-auth.guard';
import { ActiveMemberGuard } from '../../members/api/guards/active-member.guard';
import { AssignTaskDto } from './dto/assign-task.dto';
import { ChangeTaskStatusDto } from './dto/change-task-status.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import {
  GetTaskResponseDto,
  ListTasksResponseDto,
  TaskMessageResponseDto,
  toTaskResponse,
} from './dto/tasks-responses.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

/** Error-body examples for Swagger — mirrors the projects controller. */
const example = (status: string, message: string) => ({
  schema: { example: { status, message } },
});

@ApiTags('Tasks')
@Controller()
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post('projects/:projectId/tasks')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a task — no @Roles: Admin any project, PM/Lead/Dev members, Dev forced to self-assign, HR 403 (matrix is role+membership sensitive)',
  })
  @ApiCreatedResponse({ type: GetTaskResponseDto })
  @ApiBadRequestResponse({
    description:
      '400 { status: "due_date_past" | "assign_target_invalid", message }; also DTO validation (title required, status/priority enums, uuid, date-only)',
    ...example('due_date_past', 'The due date cannot be in the past.'),
  })
  @ApiNotFoundResponse({
    description: '404 { status: "task_project_not_found", message }',
    ...example('task_project_not_found', 'Project not found.'),
  })
  @ApiConflictResponse({
    description: '409 { status: "task_key_conflict", message }',
    ...example(
      'task_key_conflict',
      'Could not allocate a task key. Please try again.',
    ),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "role_forbidden" | "not_active_member", message } — HR creates; Dev assignee ≠ self',
    ...example(
      'role_forbidden',
      'Your role is not allowed to perform this action.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateTaskDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetTaskResponseDto> {
    const task = await this.tasksService.create(projectId, dto, req.user);
    return { task: toTaskResponse(task) };
  }

  @Get('projects/:projectId/tasks')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      'Board list — (priorityRank, createdAt) order; invisible project 404',
  })
  @ApiOkResponse({ type: ListTasksResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "task_project_not_found", message }',
    ...example('task_project_not_found', 'Project not found.'),
  })
  @ApiForbiddenResponse({
    description: '403 { status: "not_active_member", message }',
    ...example(
      'not_active_member',
      'You are not an active member of this organization.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ListTasksResponseDto> {
    const { tasks } = await this.tasksService.list(projectId, req.user);
    return { tasks: tasks.map(toTaskResponse) };
  }

  @Get('tasks/:taskId')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary: 'Task detail — missing or invisible → 404 (no existence leak)',
  })
  @ApiOkResponse({ type: GetTaskResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "task_not_found", message }',
    ...example('task_not_found', 'Task not found.'),
  })
  @ApiForbiddenResponse({
    description: '403 { status: "not_active_member", message }',
    ...example(
      'not_active_member',
      'You are not an active member of this organization.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async findOne(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetTaskResponseDto> {
    const task = await this.tasksService.findOne(taskId, req.user);
    return { task: toTaskResponse(task) };
  }

  @Patch('tasks/:taskId')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      'Edit title/description/priority/dueDate — full actors only (assignee gets status moves only); changed past due date 400',
  })
  @ApiOkResponse({ type: GetTaskResponseDto })
  @ApiBadRequestResponse({
    description:
      '400 { status: "empty_update" | "due_date_past", message }; also DTO validation',
    ...example('empty_update', 'Provide at least one field to update.'),
  })
  @ApiNotFoundResponse({
    description: '404 { status: "task_not_found", message }',
    ...example('task_not_found', 'Task not found.'),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "role_forbidden" | "not_active_member", message }',
    ...example(
      'role_forbidden',
      'Your role is not allowed to perform this action.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async update(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetTaskResponseDto> {
    const task = await this.tasksService.update(taskId, dto, req.user);
    return { task: toTaskResponse(task) };
  }

  @Patch('tasks/:taskId/status')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      "Move a card between columns — full actors or the task's own assignee; free transition, last-write-wins",
  })
  @ApiOkResponse({ type: GetTaskResponseDto })
  @ApiBadRequestResponse({
    description: '400 — DTO validation (status must be one of the seven)',
  })
  @ApiNotFoundResponse({
    description: '404 { status: "task_not_found", message }',
    ...example('task_not_found', 'Task not found.'),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "role_forbidden" | "not_active_member", message }',
    ...example(
      'role_forbidden',
      'Your role is not allowed to perform this action.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async changeStatus(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: ChangeTaskStatusDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetTaskResponseDto> {
    const task = await this.tasksService.changeStatus(taskId, dto, req.user);
    return { task: toTaskResponse(task) };
  }

  @Post('tasks/:taskId/assign')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Assign / reassign / unassign — full actors; target must pass the assignment matrix; same-value is a 200 no-op; only a different assignee is notified',
  })
  @ApiOkResponse({ type: GetTaskResponseDto })
  @ApiBadRequestResponse({
    description: '400 { status: "assign_target_invalid", message }',
    ...example(
      'assign_target_invalid',
      'That person cannot be assigned this task. Pick a member of the project with an allowed role.',
    ),
  })
  @ApiNotFoundResponse({
    description: '404 { status: "task_not_found", message }',
    ...example('task_not_found', 'Task not found.'),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "role_forbidden" | "not_active_member", message }',
    ...example(
      'role_forbidden',
      'Your role is not allowed to perform this action.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async assign(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: AssignTaskDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetTaskResponseDto> {
    const task = await this.tasksService.assign(taskId, dto, req.user);
    return { task: toTaskResponse(task) };
  }

  @Delete('tasks/:taskId')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Delete a task — full actors only; task notifications cascade away',
  })
  @ApiOkResponse({ type: TaskMessageResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "task_not_found", message }',
    ...example('task_not_found', 'Task not found.'),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "role_forbidden" | "not_active_member", message }',
    ...example(
      'role_forbidden',
      'Your role is not allowed to perform this action.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async remove(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<TaskMessageResponseDto> {
    await this.tasksService.remove(taskId, req.user);
    return { message: 'Task deleted successfully.' };
  }
}
