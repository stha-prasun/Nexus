import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Role } from '../../../auth/api/constants/auth.constants';

export interface InviteMembershipInput {
  organizationId: string;
  /** Normalized email — the invite identity. */
  email: string;
  role: Role;
  /** Invitee's account id when one already exists; null otherwise. */
  userId: string | null;
  invitedByUserId: string;
}

export interface InviteMembershipRow {
  id: string;
  organizationId: string;
  userId: string | null;
  email: string;
  status: 'INVITED';
  invitedRole: Role;
  invitedByUserId: string;
  invitedAt: Date;
  acceptedAt: null;
  createdAt: Date;
}

/**
 * The single construction point for INVITED membership rows — mirrors
 * OrganizationFactory. Stamps id + invitedAt/createdAt with one instant;
 * status/role are fixed by the INVITED-state invariant.
 */
@Injectable()
export class MemberFactory {
  createInvite(input: InviteMembershipInput): InviteMembershipRow {
    const now = new Date();
    return {
      id: randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      email: input.email,
      status: 'INVITED',
      invitedRole: input.role,
      invitedByUserId: input.invitedByUserId,
      invitedAt: now,
      acceptedAt: null,
      createdAt: now,
    };
  }
}
