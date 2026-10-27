export interface ProjectProps {
  id: string;
  organizationId: string;
  name: string;
  /** Optional blurb — null when the project has none. */
  description: string | null;
  color: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Domain entity for one projects row. Never serialized directly —
 * controllers map it through `ProjectResponseDto` (on top of the hydrated
 * `ProjectView`) so only the intended fields leave the API.
 */
export class Project {
  constructor(private readonly props: ProjectProps) {}

  get id(): string {
    return this.props.id;
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): string | null {
    return this.props.description;
  }

  get color(): string {
    return this.props.color;
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

export interface ProjectMemberProps {
  id: string;
  projectId: string;
  organizationMemberId: string;
  userId: string;
  isLead: boolean;
  addedByUserId: string | null;
  createdAt: Date;
}

/**
 * Domain entity for one project_members row — the adder's id is kept for
 * provenance but never blocks the membership (set null on their removal).
 */
export class ProjectMember {
  constructor(private readonly props: ProjectMemberProps) {}

  get id(): string {
    return this.props.id;
  }

  get projectId(): string {
    return this.props.projectId;
  }

  get organizationMemberId(): string {
    return this.props.organizationMemberId;
  }

  get userId(): string {
    return this.props.userId;
  }

  get isLead(): boolean {
    return this.props.isLead;
  }

  get addedByUserId(): string | null {
    return this.props.addedByUserId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }
}
