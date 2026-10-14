import type { Role } from '../constants/auth.constants';

export interface UserProps {
  id?: string;
  name: string;
  email: string;
  role: Role;
  passwordHash: string;
  emailVerifiedAt?: Date | null;
  createdAt: Date;
}

/**
 * Domain entity for a user account. Never serialized directly — controllers
 * return response DTOs so `passwordHash` cannot leak by accident.
 */
export class User {
  constructor(private readonly props: UserProps) {}

  get id(): string | undefined {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get email(): string {
    return this.props.email;
  }

  get role(): Role {
    return this.props.role;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get emailVerifiedAt(): Date | null {
    return this.props.emailVerifiedAt ?? null;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get isVerified(): boolean {
    return this.props.emailVerifiedAt != null;
  }

  /** An account becomes verified exactly once, via its token. */
  markEmailVerified(at: Date = new Date()): void {
    if (this.props.emailVerifiedAt == null) {
      this.props.emailVerifiedAt = at;
    }
  }
}
