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
import { Roles } from '../../../common/decorators';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { UnauthenticatedResponseDto } from '../../auth/api/dto/auth-responses.dto';
import type { AuthenticatedRequest } from '../../auth/api/guards/session-auth.guard';
import { SessionAuthGuard } from '../../auth/api/guards/session-auth.guard';
import { ActiveMemberGuard } from '../../members/api/guards/active-member.guard';
import { AddProjectMemberDto } from './dto/add-project-member.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import {
  GetProjectResponseDto,
  ListProjectsResponseDto,
  ProjectMessageResponseDto,
  toProjectResponse,
} from './dto/projects-responses.dto';
import { SetProjectLeadDto } from './dto/set-project-lead.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

/** Error-body examples for Swagger — mirrors the members controller. */
const example = (status: string, message: string) => ({
  schema: { example: { status, message } },
});

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @UseGuards(SessionAuthGuard, RolesGuard, ActiveMemberGuard)
  @Roles('Admin', 'PM')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a project (Admin/PM); creator is auto-added, ≥1 explicit lead required (plan §1)',
  })
  @ApiCreatedResponse({ type: GetProjectResponseDto })
  @ApiBadRequestResponse({
    description:
      '400 { status: "lead_not_member", message } — a lead is outside members ∪ {creator}; also DTO validation (empty name, bad hex, invalid uuid)',
    ...example(
      'lead_not_member',
      'Every team lead must also be a project member.',
    ),
  })
  @ApiConflictResponse({
    description: '409 { status: "organization_required", message }',
    ...example(
      'organization_required',
      'Create an organization before creating projects.',
    ),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "not_org_member" | "project_member_role_forbidden" | "role_forbidden" | "not_active_member", message }',
    ...example(
      'not_org_member',
      'grace@example.com is not an active member of the organization. Invite them to the organization first.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async create(
    @Body() dto: CreateProjectDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetProjectResponseDto> {
    const project = await this.projectsService.create(dto, req.user);
    return { project: toProjectResponse(project) };
  }

  @Get()
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      'List projects — Admin/HR see all, PM/Dev only projects they belong to (any ACTIVE member)',
  })
  @ApiOkResponse({ type: ListProjectsResponseDto })
  @ApiForbiddenResponse({
    description:
      '403 { status: "not_active_member", message } — no ACTIVE membership (ActiveMemberGuard)',
    ...example(
      'not_active_member',
      'You are not an active member of this organization.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async list(
    @Req() req: AuthenticatedRequest,
  ): Promise<ListProjectsResponseDto> {
    const { projects } = await this.projectsService.list(req.user);
    return { projects: projects.map(toProjectResponse) };
  }

  @Get(':id')
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      'Project detail — visible else 404 (missing and invisible are indistinguishable)',
  })
  @ApiOkResponse({ type: GetProjectResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "project_not_found", message }',
    ...example('project_not_found', 'Project not found.'),
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
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetProjectResponseDto> {
    const project = await this.projectsService.findOne(id, req.user);
    return { project: toProjectResponse(project) };
  }

  @Patch(':id')
  @UseGuards(SessionAuthGuard, RolesGuard, ActiveMemberGuard)
  @Roles('Admin', 'PM')
  @ApiOperation({
    summary: 'Rename/recolor a project (Admin any; PM if a member)',
  })
  @ApiOkResponse({ type: GetProjectResponseDto })
  @ApiBadRequestResponse({
    description:
      '400 { status: "empty_update", message } — no known fields in the body; also DTO validation',
    ...example('empty_update', 'Provide at least one field to update.'),
  })
  @ApiNotFoundResponse({
    description: '404 { status: "project_not_found", message }',
    ...example('project_not_found', 'Project not found.'),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "role_forbidden" | "not_active_member", message } — HR/Dev (RolesGuard + service re-check)',
    ...example(
      'role_forbidden',
      'Your role is not allowed to perform this action.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetProjectResponseDto> {
    const project = await this.projectsService.update(id, dto, req.user);
    return { project: toProjectResponse(project) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, RolesGuard, ActiveMemberGuard)
  @Roles('Admin', 'PM')
  @ApiOperation({
    summary: 'Delete a project and its memberships (Admin any; PM if a member)',
  })
  @ApiOkResponse({ type: ProjectMessageResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "project_not_found", message }',
    ...example('project_not_found', 'Project not found.'),
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
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<ProjectMessageResponseDto> {
    const { message } = await this.projectsService.remove(id, req.user);
    return { message };
  }

  @Post(':id/members')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(SessionAuthGuard, RolesGuard, ActiveMemberGuard)
  @Roles('Admin', 'PM')
  @ApiOperation({
    summary:
      'Add an ACTIVE org member to the project (HR targets and strangers rejected; not a lead by default)',
  })
  @ApiCreatedResponse({ type: GetProjectResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "project_not_found", message }',
    ...example('project_not_found', 'Project not found.'),
  })
  @ApiConflictResponse({
    description: '409 { status: "already_project_member", message }',
    ...example(
      'already_project_member',
      'This person is already a member of the project.',
    ),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "not_org_member" | "project_member_role_forbidden" | "role_forbidden" | "not_active_member", message }',
    ...example(
      'project_member_role_forbidden',
      'HR members have organization-wide oversight and cannot be added to projects.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddProjectMemberDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetProjectResponseDto> {
    const project = await this.projectsService.addMember(id, dto, req.user);
    return { project: toProjectResponse(project) };
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, RolesGuard, ActiveMemberGuard)
  @Roles('Admin', 'PM')
  @ApiOperation({
    summary:
      'Remove a project member — self forbidden for every role; PM may remove Dev targets only; last-lead removal rolls back (403)',
  })
  @ApiOkResponse({ type: GetProjectResponseDto })
  @ApiNotFoundResponse({
    description:
      '404 { status: "project_not_found" | "project_member_not_found", message }',
    ...example(
      'project_member_not_found',
      'This person is not a member of the project.',
    ),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "self_remove_forbidden" | "project_remove_forbidden" | "last_lead_required" | "role_forbidden" | "not_active_member", message }',
    ...example(
      'last_lead_required',
      'A project must keep at least one team lead. Promote another lead first.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetProjectResponseDto> {
    const project = await this.projectsService.removeMember(
      id,
      userId,
      req.user,
    );
    return { project: toProjectResponse(project) };
  }

  @Patch(':id/members/:userId/lead')
  @UseGuards(SessionAuthGuard, RolesGuard, ActiveMemberGuard)
  @Roles('Admin', 'PM')
  @ApiOperation({
    summary:
      'Promote/demote a team lead — same-value is a 200 no-op; demoting the last lead rolls back (403)',
  })
  @ApiOkResponse({ type: GetProjectResponseDto })
  @ApiNotFoundResponse({
    description:
      '404 { status: "project_not_found" | "project_member_not_found", message }',
    ...example(
      'project_member_not_found',
      'This person is not a member of the project.',
    ),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "last_lead_required" | "role_forbidden" | "not_active_member", message }',
    ...example(
      'last_lead_required',
      'A project must keep at least one team lead. Promote another lead first.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async setLead(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetProjectLeadDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<GetProjectResponseDto> {
    const project = await this.projectsService.setLead(
      id,
      userId,
      dto,
      req.user,
    );
    return { project: toProjectResponse(project) };
  }
}
