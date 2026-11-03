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

/** One device row of GET /auth/sessions — never carries the raw sid. */
export class SessionDto {
  @ApiProperty({
    example: 'a1b2c3d4e5f6',
    description: 'Opaque public handle used to revoke this session',
  })
  id!: string;

  @ApiProperty({ example: 'Windows device' })
  device!: string;

  @ApiProperty({ example: 'Chrome on Windows' })
  browser!: string;

  @ApiProperty({ example: '127.0.0.1' })
  ip!: string;

  @ApiProperty({
    example: '2026-11-03T09:04:00.000Z',
    description: 'ISO timestamp of sign-in',
  })
  signedInAt!: string;

  @ApiProperty({
    example: '2026-11-03T10:22:00.000Z',
    description: 'ISO timestamp of last authenticated activity',
  })
  lastActiveAt!: string;

  @ApiProperty({
    example: '2026-11-04T09:04:00.000Z',
    description: 'ISO timestamp when this session expires',
  })
  expiresAt!: string;

  @ApiProperty({
    example: true,
    description: 'Current session or last active within the online window',
  })
  online!: boolean;

  @ApiProperty({ example: true, description: 'The calling session' })
  current!: boolean;
}

export class ListSessionsResponseDto {
  @ApiProperty({ type: [SessionDto] })
  sessions!: SessionDto[];
}
