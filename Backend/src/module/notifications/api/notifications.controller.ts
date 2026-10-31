import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { UnauthenticatedResponseDto } from '../../auth/api/dto/auth-responses.dto';
import type { AuthenticatedRequest } from '../../auth/api/guards/session-auth.guard';
import { SessionAuthGuard } from '../../auth/api/guards/session-auth.guard';
import { SESSION_COOKIE_NAME } from '../../auth/api/session/session.constants';
import { ActiveMemberGuard } from '../../members/api/guards/active-member.guard';
import {
  ListNotificationsQueryDto,
  ListNotificationsResponseDto,
  NotificationNoContentResponseDto,
} from './dto/notifications-responses.dto';
import { NotificationsService } from './notifications.service';
import { NotificationEmitterService } from './sse/notification-emitter.service';

/** Error-body examples for Swagger — mirrors the projects controller. */
const example = (status: string, message: string) => ({
  schema: { example: { status, message } },
});

const notActiveMember = (): ReturnType<typeof example> =>
  example(
    'not_active_member',
    'You are not an active member of this organization.',
  );

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly emitter: NotificationEmitterService,
  ) {}

  @Get()
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      "List the caller's own notifications — newest first, cursor-paginated (default 30, max 50)",
  })
  @ApiOkResponse({ type: ListNotificationsResponseDto })
  @ApiForbiddenResponse({
    description:
      '403 { status: "not_active_member", message } — no ACTIVE membership (ActiveMemberGuard)',
    ...notActiveMember(),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async list(
    @Query() query: ListNotificationsQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<ListNotificationsResponseDto> {
    const result = await this.notificationsService.list(query, req.user);
    return {
      notifications: result.notifications,
      unreadCount: result.unreadCount,
      nextCursor: result.nextCursor,
    };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      'Mark one notification read — not-yours → 404; already read → 204 no-op',
  })
  @ApiNoContentResponse({ type: NotificationNoContentResponseDto })
  @ApiNotFoundResponse({
    description: '404 { status: "notification_not_found", message }',
    ...example('notification_not_found', 'Notification not found.'),
  })
  @ApiForbiddenResponse({
    description: '403 { status: "not_active_member", message }',
    ...notActiveMember(),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.notificationsService.markRead(id, req.user);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary: 'Mark every unread notification of the caller read',
  })
  @ApiNoContentResponse({ type: NotificationNoContentResponseDto })
  @ApiForbiddenResponse({
    description: '403 { status: "not_active_member", message }',
    ...notActiveMember(),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async markAllRead(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.notificationsService.markAllRead(req.user);
  }

  @Get('stream')
  @SkipThrottle()
  @UseGuards(SessionAuthGuard, ActiveMemberGuard)
  @ApiOperation({
    summary:
      'SSE stream: `notification` events for the caller (plus `ping` heartbeat and `session_expired`); throttling skipped so EventSource reconnects never 429',
  })
  @ApiOkResponse({
    description:
      'text/event-stream — `event: notification` / `data: {...}`; `ping` every 25 s; `session_expired` when the session dies',
  })
  @ApiForbiddenResponse({
    description: '403 { status: "not_active_member", message }',
    ...notActiveMember(),
  })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  stream(@Req() req: AuthenticatedRequest & Request): Observable<unknown> {
    const raw = req.cookies?.[SESSION_COOKIE_NAME] as unknown;
    const sid = typeof raw === 'string' && raw.length > 0 ? raw : '';
    return this.emitter.subscribe(req.user.userId, sid);
  }
}
