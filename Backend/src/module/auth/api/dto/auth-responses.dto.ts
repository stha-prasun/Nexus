import { ApiProperty } from '@nestjs/swagger';
import {
  LOGOUT_ALL_MESSAGE,
  REGISTER_MESSAGE,
  ROLES,
  type Role,
} from '../constants/auth.constants';

/** User snapshot returned by login/me — never carries passwordHash. */
export class UserSnapshotDto {
  @ApiProperty({
    example: '00000000-0000-4000-8000-000000000007',
  })
  id!: string;

  @ApiProperty({ example: 'Ada Lovelace' })
  name!: string;

  @ApiProperty({ example: 'ada@example.com' })
  email!: string;

  @ApiProperty({ enum: ROLES, example: 'Dev' })
  role!: Role;
}

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

export class LoginResponseDto {
  @ApiProperty({ type: UserSnapshotDto })
  user!: UserSnapshotDto;
}

/** Session snapshot for /auth/me — same shape as login, 0 Postgres reads. */
export class MeResponseDto {
  @ApiProperty({ type: UserSnapshotDto })
  user!: UserSnapshotDto;
}

/** 401 from /auth/me — the stale cookie is cleared with it. */
export class UnauthenticatedResponseDto {
  @ApiProperty({ example: 'unauthenticated' })
  status!: 'unauthenticated';

  @ApiProperty({ example: 'You are not signed in.' })
  message!: string;
}

export class LogoutResponseDto {
  @ApiProperty({ example: LOGOUT_ALL_MESSAGE })
  message!: string;

  @ApiProperty({
    example: 2,
    description: 'Number of live sessions actually destroyed (0 or more)',
  })
  revoked!: number;
}
