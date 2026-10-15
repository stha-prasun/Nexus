export interface OrganizationProps {
  id: string;
  name: string;
  slug: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Domain entity for the system-wide singleton organization. Never serialized
 * directly — controllers map it through `OrganizationResponseDto` so only
 * the intended fields leave the API.
 */
export class Organization {
  constructor(private readonly props: OrganizationProps) {}

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get slug(): string {
    return this.props.slug;
  }

  get createdByUserId(): string {
    return this.props.createdByUserId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
