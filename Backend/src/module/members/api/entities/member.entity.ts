import type { Role } from '../../../auth/api/constants/auth.constants';
import type { MemberStatus } from '../constants/members.constants';

export interface MemberProps {
  /** Membership row id — the handle every management route operates on. */
  id: string;
  organizationId: string;
  /**
   * Invitee's account, when one exists. Null while the row is INVITED and
   * the invited email has no account yet (set at accept, or at invite when
   * the account already existed).
   */
  userId: string | null;
  /** The invite identity — normalized email, always present. */
  email: string;
  status: MemberStatus;
  /** `invitedRole` while INVITED, `users.role` while ACTIVE. */
  role: Role;
  /** Null until the invitee has an account (frontend falls back to local-part). */
  name: string | null;
  invitedAt: Date;
  acceptedAt: Date | null;
  /** Inviter's email; null when the inviter was removed or unknown. */
  invitedBy: string | null;
}

/**
 * Domain entity for one membership/invitation row — a flattened
 * users ∥ organization_members view, never serialized directly
 * (controllers map through MemberResponseDto).
 */
export class Member {
  constructor(private readonly props: MemberProps) {}

  get id(): string {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get userId(): string | null {
    return this.props.userId;
  }

  get email(): string {
    return this.props.email;
  }

  get status(): MemberStatus {
    return this.props.status;
  }

  get role(): Role {
    return this.props.role;
  }

  get name(): string | null {
    return this.props.name;
  }

  get invitedAt(): Date {
    return this.props.invitedAt;
  }

  get acceptedAt(): Date | null {
    return this.props.acceptedAt;
  }

  get invitedBy(): string | null {
    return this.props.invitedBy;
  }
}

export interface InvitePreviewProps {
  email: string;
  orgName: string;
  role: Role;
  accountState: 'none' | 'unverified' | 'verified';
}

/** Value object for the public GET /members/invites/:token preview. */
export class InvitePreview {
  constructor(private readonly props: InvitePreviewProps) {}

  get email(): string {
    return this.props.email;
  }

  get orgName(): string {
    return this.props.orgName;
  }

  get role(): Role {
    return this.props.role;
  }

  get accountState(): 'none' | 'unverified' | 'verified' {
    return this.props.accountState;
  }
}
