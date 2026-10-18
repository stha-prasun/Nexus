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
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../../common/decorators';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { UnauthenticatedResponseDto } from '../../auth/api/dto/auth-responses.dto';
import type { AuthenticatedRequest } from '../../auth/api/guards/session-auth.guard';
import { SessionAuthGuard } from '../../auth/api/guards/session-auth.guard';
import { ChangeMemberRoleDto } from './dto/change-member-role.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import {
  InviteAcceptedResponseDto,
  InvitePreviewResponseDto,
  InviteSentResponseDto,
  ListMembersResponseDto,
  MemberMessageResponseDto,
  toInvitePreviewResponse,
  toMemberResponse,
} from './dto/members-responses.dto';
import { ActiveMemberGuard } from './guards/active-member.guard';
import { MembersService } from './members.service';

/** Error-body examples for Swagger — mirrors the organization controller. */
const example = (status: string, message: string) => ({
  schema: { example: { status, message } },
});

/** Mail-bomb guard shared by invite, resend and accept. */
const inviteThrottle = { default: { limit: 10, ttl: 600_000 } };

@ApiTags('Members')
@Controller('members')
export class MembersController {
  constructor(private readonly membersService: MembersService) {}

  @Get()
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      'List organization members and pending invitations (any ACTIVE member, Dev included)',
  })
  @ApiOkResponse({ type: ListMembersResponseDto })
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
  ): Promise<ListMembersResponseDto> {
    const { members } = await this.membersService.list(req.user);
    return { members: members.map(toMemberResponse) };
  }

  @Post('invites')
  @UseGuards(SessionAuthGuard, RolesGuard, ActiveMemberGuard)
  @Roles('Admin', 'HR', 'PM')
  @Throttle(inviteThrottle)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Invite by email (Admin/HR/PM per matrix); re-invite updates the role and reissues the link',
  })
  @ApiCreatedResponse({ type: InviteSentResponseDto })
  @ApiOkResponse({
    description: '200 — an INVITED row already existed (re-invite path)',
    type: InviteSentResponseDto,
  })
  @ApiConflictResponse({
    description:
      '409 { status: "organization_required" | "already_member", message }',
    ...example(
      'organization_required',
      'Create an organization before inviting members.',
    ),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "self_invite_forbidden" | "member_policy_forbidden" | "role_forbidden" | "not_active_member", message }',
    ...example('self_invite_forbidden', 'You cannot invite yourself.'),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async invite(
    @Body() dto: InviteMemberDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<InviteSentResponseDto> {
    const { message } = await this.membersService.invite(dto, req.user);
    return { message };
  }

  @Post('invites/:id/resend')
  @UseGuards(SessionAuthGuard, RolesGuard, ActiveMemberGuard)
  @Roles('Admin', 'HR', 'PM')
  @Throttle(inviteThrottle)
  @ApiOperation({
    summary:
      'Regenerate and resend an invitation link (handles Redis flush / lost mail / expired link)',
  })
  @ApiOkResponse({ type: MemberMessageResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "member_not_found", message }',
    ...example('member_not_found', 'Member not found.'),
  })
  @ApiConflictResponse({
    description: '409 { status: "already_member", message } — row is ACTIVE',
    ...example(
      'already_member',
      'This person is already a member of the organization.',
    ),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "self_invite_forbidden" | "member_policy_forbidden" | "role_forbidden" | "not_active_member", message }',
    ...example(
      'member_policy_forbidden',
      'Your role is not allowed to manage that role.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async resend(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<MemberMessageResponseDto> {
    const { message } = await this.membersService.resendInvite(id, req.user);
    return { message };
  }

  @Patch(':id/role')
  @UseGuards(SessionAuthGuard, RolesGuard, ActiveMemberGuard)
  @Roles('Admin', 'HR', 'PM')
  @ApiOperation({
    summary:
      'Change a member role (ACTIVE → users.role, INVITED → invitedRole; never both)',
  })
  @ApiOkResponse({ type: MemberMessageResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "member_not_found", message }',
    ...example('member_not_found', 'Member not found.'),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "self_manage_forbidden" | "member_policy_forbidden" | "last_admin_required" | "role_forbidden" | "not_active_member", message }',
    ...example(
      'last_admin_required',
      'The organization must keep at least one active Admin. Promote another Admin first.',
    ),
  })
  @ApiBadRequestResponse({
    description: '400 — validation (role must be one of PM, Dev, Admin, HR)',
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeMemberRoleDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MemberMessageResponseDto> {
    const { message } = await this.membersService.changeRole(id, dto, req.user);
    return { message };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard, RolesGuard, ActiveMemberGuard)
  @Roles('Admin', 'HR', 'PM')
  @ApiOperation({
    summary:
      'Remove a member or pending invitation (ACTIVE removal also resets users.role → Dev and revokes sessions)',
  })
  @ApiOkResponse({ type: MemberMessageResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "member_not_found", message }',
    ...example('member_not_found', 'Member not found.'),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "self_manage_forbidden" | "member_policy_forbidden" | "last_admin_required" | "role_forbidden" | "not_active_member", message }',
    ...example(
      'self_manage_forbidden',
      'You cannot change your own role or remove yourself. Another Admin has to do it for you.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<MemberMessageResponseDto> {
    const { message } = await this.membersService.remove(id, req.user);
    return { message };
  }

  @Get('invites/:token')
  @ApiOperation({
    summary:
      'Public invitation preview — the token is the capability (reveals the invited email to its holder)',
  })
  @ApiOkResponse({ type: InvitePreviewResponseDto })
  @ApiNotFoundResponse({
    description:
      '404 { status: "invite_invalid_or_expired", message } — unknown, consumed, expired, or the row was deleted',
    ...example(
      'invite_invalid_or_expired',
      'This invitation link is invalid or has expired. Ask an Admin to resend it.',
    ),
  })
  async preview(
    @Param('token') token: string,
  ): Promise<InvitePreviewResponseDto> {
    const preview = await this.membersService.getInvitePreview(token);
    return toInvitePreviewResponse(preview);
  }

  @Post('invites/:token/accept')
  @Throttle(inviteThrottle)
  @UseGuards(SessionAuthGuard)
  @ApiOperation({
    summary:
      'Accept the invitation as the signed-in invitee — copies invitedRole → users.role in one transaction',
  })
  @ApiOkResponse({ type: InviteAcceptedResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "invite_invalid_or_expired", message }',
    ...example(
      'invite_invalid_or_expired',
      'This invitation link is invalid or has expired. Ask an Admin to resend it.',
    ),
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "invite_email_mismatch" | "email_unverified", message }',
    ...example(
      'invite_email_mismatch',
      'This invitation was sent to a different email address. Sign out and sign in with the invited email to accept.',
    ),
  })
  @ApiConflictResponse({
    description:
      '409 { status: "already_member", message } — idempotent-friendly',
    ...example(
      'already_member',
      'This person is already a member of the organization.',
    ),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async accept(
    @Param('token') token: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<InviteAcceptedResponseDto> {
    const { message } = await this.membersService.acceptInvite(token, req.user);
    return { message };
  }
}
