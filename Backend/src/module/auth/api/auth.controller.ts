import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import {
  RegisterResponseDto,
  ResendConfirmationResponseDto,
  VerifyEmailResponseDto,
} from './dto/auth-responses.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({
    summary:
      'Create an account and send a confirmation email (identical response whether or not the email exists)',
  })
  @ApiCreatedResponse({ type: RegisterResponseDto })
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
}
