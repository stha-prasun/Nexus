import { ApiProperty } from '@nestjs/swagger';
import { REGISTER_MESSAGE } from '../constants/auth.constants';

export class RegisterResponseDto {
  @ApiProperty({ example: REGISTER_MESSAGE })
  message!: string;
}

export class VerifyEmailResponseDto {
  @ApiProperty({ enum: ['verified', 'invalid_or_expired'] })
  status!: 'verified' | 'invalid_or_expired';
}

export class ResendConfirmationResponseDto {
  @ApiProperty({
    example:
      'If an unverified account exists for this email, a new confirmation link has been sent.',
  })
  message!: string;
}
