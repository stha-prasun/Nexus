import { ApiProperty } from '@nestjs/swagger';
import { ROLES } from '../../../auth/api/constants/auth.constants';
import type { InvitePreview, Member } from '../entities/member.entity';

export class MemberResponseDto {
  @ApiProperty({
    example: '00000000-0000-4000-8000-000000000020',
    description: 'Membership row id — the handle for role change / removal.',
  })
  id!: string;

  @ApiProperty({
    example: 'Ada',
    nullable: true,
    description:
      "Invitee's name; null while INVITED and no account exists yet (the UI falls back to the email local-part).",
  })
  name!: string | null;

  @ApiProperty({ example: 'ada@example.com' })
  email!: string;

  @ApiProperty({
    example: 'Dev',
    enum: [...ROLES],
    description:
      'invitedRole while INVITED, users.role while ACTIVE (always one source per state).',
  })
  role!: (typeof ROLES)[number];

  @ApiProperty({ example: 'INVITED', enum: ['INVITED', 'ACTIVE'] })
  status!: 'INVITED' | 'ACTIVE';

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  invitedAt!: Date;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Set when the invitation was accepted; null while INVITED.',
  })
  acceptedAt!: Date | null;

  @ApiProperty({
    example: 'admin@nexus.dev',
    nullable: true,
    description:
      "Inviter's email; null when the inviter was removed (the invite stays valid).",
  })
  invitedBy!: string | null;
}

export class ListMembersResponseDto {
  @ApiProperty({ type: [MemberResponseDto] })
  members!: MemberResponseDto[];
}

export class InvitePreviewResponseDto {
  @ApiProperty({ example: 'valid', enum: ['valid'] })
  status!: 'valid';

  @ApiProperty({ example: 'ada@example.com' })
  email!: string;

  @ApiProperty({ example: 'Acme Inc' })
  orgName!: string;

  @ApiProperty({ example: 'Dev', enum: [...ROLES] })
  role!: (typeof ROLES)[number];

  @ApiProperty({
    example: 'verified',
    enum: ['none', 'unverified', 'verified'],
    description:
      'none — no account for the invited email; unverified — account exists but never confirmed; verified — ready to accept.',
  })
  accountState!: 'none' | 'unverified' | 'verified';
}

export class InviteAcceptedResponseDto {
  @ApiProperty({ example: 'You have joined the organization.' })
  message!: string;
}

export class InviteSentResponseDto {
  @ApiProperty({ example: 'The invitation has been sent.' })
  message!: string;
}

export class MemberMessageResponseDto {
  @ApiProperty({ example: 'Member role updated.' })
  message!: string;
}

/** Serialization seam — entities never leave the API directly. */
export const toMemberResponse = (member: Member): MemberResponseDto => ({
  id: member.id,
  name: member.name,
  email: member.email,
  role: member.role,
  status: member.status,
  invitedAt: member.invitedAt,
  acceptedAt: member.acceptedAt,
  invitedBy: member.invitedBy,
});

export const toInvitePreviewResponse = (
  preview: InvitePreview,
): InvitePreviewResponseDto => ({
  status: 'valid',
  email: preview.email,
  orgName: preview.orgName,
  role: preview.role,
  accountState: preview.accountState,
});
