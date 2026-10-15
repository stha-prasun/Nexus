import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { UNAUTHENTICATED_MESSAGE } from './constants/auth.constants';
import {
  LoginResponseDto,
  LogoutResponseDto,
  MeResponseDto,
  RegisterResponseDto,
  ResendConfirmationResponseDto,
  UnauthenticatedResponseDto,
  VerifyEmailResponseDto,
} from './dto/auth-responses.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { SESSION_COOKIE_NAME } from './session/session.constants';
import { SessionService } from './session/session.service';

/** The session sid from the cookie, if present and non-empty. */
const sidFrom = (req: Request): string | undefined => {
  const raw = req.cookies?.[SESSION_COOKIE_NAME] as unknown;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({
    summary:
      'Create an account and send a confirmation email; 409 when the email already exists (taken vs unverified)',
  })
  @ApiCreatedResponse({ type: RegisterResponseDto })
  @ApiConflictResponse({
    description:
      '409 { status: "email_taken" | "email_unverified", message } — email belongs to an existing account',
    schema: {
      example: {
        status: 'email_taken',
        message: 'This email is already registered. Try signing in instead.',
      },
    },
  })
  register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.authService.register(dto);
  }

  @Get('verify-email')
  @ApiOperation({
    summary: 'Consume a confirmation token and verify the email',
  })
  @ApiQuery({ name: 'token', required: true })
  @ApiOkResponse({ type: VerifyEmailResponseDto })
  @ApiBadRequestResponse({ type: VerifyEmailResponseDto })
  async verifyEmail(
    @Query('token') token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VerifyEmailResponseDto> {
    const result = await this.authService.verifyEmail(token ?? '');
    if (result.status !== 'verified') {
      res.status(HttpStatus.BAD_REQUEST);
    }
    return result;
  }

  @Post('resend-confirmation')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @ApiOperation({
    summary:
      'Resend the confirmation email for an unverified account (generic response)',
  })
  @ApiOkResponse({ type: ResendConfirmationResponseDto })
  resendConfirmation(
    @Body() dto: ResendConfirmationDto,
  ): Promise<ResendConfirmationResponseDto> {
    return this.authService.resendConfirmation(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 600_000 } })
  @ApiOperation({
    summary:
      'Sign in; sets the session cookie (24h, 7d with remember) and rotates any pre-login sid',
  })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({
    description:
      '401 { status: "invalid_credentials", message } — unknown email or wrong password (identical bodies)',
    schema: {
      example: {
        status: 'invalid_credentials',
        message: 'Email or password is incorrect.',
      },
    },
  })
  @ApiForbiddenResponse({
    description:
      '403 { status: "email_unverified", message } — correct password, unverified account (no session)',
    schema: {
      example: {
        status: 'email_unverified',
        message: "This email has an account that hasn't been verified yet.",
      },
    },
  })
  @ApiTooManyRequestsResponse({
    description:
      '429 { status: "too_many_attempts", message } — per-email lockout (10/15 min) or per-IP throttle',
    schema: {
      example: {
        status: 'too_many_attempts',
        message:
          'Too many sign-in attempts. Please wait a few minutes and try again.',
      },
    },
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponseDto> {
    const result = await this.authService.login(dto, sidFrom(req));
    this.sessionService.setCookie(res, result.sid, result.ttlSeconds);
    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sign out (this device by default, allDevices: true for every session). Idempotent — always 200',
  })
  @ApiOkResponse({ type: LogoutResponseDto })
  async logout(
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponseDto> {
    const result = await this.authService.logout(
      sidFrom(req),
      dto.allDevices === true,
    );
    this.sessionService.clearCookie(res);
    return result;
  }

  @Get('me')
  @ApiOperation({
    summary:
      'Current session snapshot (0 Postgres reads); 401 clears a stale cookie',
  })
  @ApiOkResponse({ type: MeResponseDto })
  @ApiUnauthorizedResponse({ type: UnauthenticatedResponseDto })
  async me(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponseDto | UnauthenticatedResponseDto> {
    const result = await this.authService.me(sidFrom(req));
    if (result.status !== 'authenticated') {
      res.status(HttpStatus.UNAUTHORIZED);
      this.sessionService.clearCookie(res);
      return {
        status: 'unauthenticated',
        message: UNAUTHENTICATED_MESSAGE,
      };
    }
    return { user: result.user };
  }
}
