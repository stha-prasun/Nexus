import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../../common/decorators';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { UnauthenticatedResponseDto } from '../../auth/api/dto/auth-responses.dto';
import type { AuthenticatedRequest } from '../../auth/api/guards/session-auth.guard';
import { SessionAuthGuard } from '../../auth/api/guards/session-auth.guard';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import {
  GetOrganizationResponseDto,
  OrganizationResponseDto,
  toOrganizationResponse,
} from './dto/organization-responses.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationService } from './organization.service';

/** Error-body examples for Swagger — mirrors the auth controller's style. */
const example = (status: string, message: string) => ({
  schema: { example: { status, message } },
});

@ApiTags('Organization')
@Controller('organization')
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Post()
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('Admin')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({
    summary:
      'Create the system-wide organization (Admin only); 409 while one already exists',
  })
  @ApiCreatedResponse({ type: OrganizationResponseDto })
  @ApiConflictResponse({
    description:
      '409 { status: "organization_exists", message } — a row already exists (also the concurrent-create race)',
    ...example(
      'organization_exists',
      'An organization already exists. Delete it before creating a new one.',
    ),
  })
  @ApiForbiddenResponse({
    description: '403 { status: "role_forbidden", message } — non-Admin role',
    ...example(
      'role_forbidden',
      'Your role is not allowed to perform this action.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async create(
    @Body() dto: CreateOrganizationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<OrganizationResponseDto> {
    const organization = await this.organizationService.create(dto, req.user);
    return toOrganizationResponse(organization);
  }

  @Get()
  @UseGuards(SessionAuthGuard)
  @ApiOperation({
    summary:
      'Current organization, or null when none exists yet (any signed-in user)',
  })
  @ApiOkResponse({ type: GetOrganizationResponseDto })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async find(): Promise<GetOrganizationResponseDto> {
    const organization = await this.organizationService.find();
    return {
      organization:
        organization === null ? null : toOrganizationResponse(organization),
    };
  }

  @Patch()
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('Admin')
  @ApiOperation({ summary: 'Update the organization (Admin only)' })
  @ApiOkResponse({ type: OrganizationResponseDto })
  @ApiBadRequestResponse({
    description:
      '400 { status: "empty_update", message } — no known fields in the body',
    ...example('empty_update', 'Provide at least one field to update.'),
  })
  @ApiNotFoundResponse({
    description: '404 { status: "organization_not_found", message }',
    ...example('organization_not_found', 'Organization not found.'),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "role_forbidden", message } — non-Admin role (RolesGuard)',
    ...example(
      'role_forbidden',
      'Your role is not allowed to perform this action.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async update(
    @Body() dto: UpdateOrganizationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<OrganizationResponseDto> {
    const organization = await this.organizationService.update(dto, req.user);
    return toOrganizationResponse(organization);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles('Admin')
  @ApiOperation({ summary: 'Hard-delete the organization (Admin only)' })
  @ApiNoContentResponse({ description: '204 — the organization is deleted' })
  @ApiNotFoundResponse({
    description: '404 { status: "organization_not_found", message }',
    ...example('organization_not_found', 'Organization not found.'),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "role_forbidden", message } — non-Admin role (RolesGuard)',
    ...example(
      'role_forbidden',
      'Your role is not allowed to perform this action.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async remove(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.organizationService.remove(req.user);
  }
}
