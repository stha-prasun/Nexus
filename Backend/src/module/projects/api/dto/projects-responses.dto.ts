import { ApiProperty } from '@nestjs/swagger';
import { ROLES } from '../../../auth/api/constants/auth.constants';
import type {
  ProjectMemberView,
  ProjectView,
} from '../repositories/projects.repository';

export class ProjectMemberResponseDto {
  @ApiProperty({
    example: '00000000-0000-4000-8000-000000000031',
    description: 'User id — the handle for lead toggle / removal routes.',
  })
  userId!: string;

  @ApiProperty({ example: 'Grace' })
  name!: string;

  @ApiProperty({ example: 'grace@example.com' })
  email!: string;

  @ApiProperty({
    example: 'Dev',
    enum: [...ROLES],
    description: "The member's org role (users.role).",
  })
  role!: (typeof ROLES)[number];

  @ApiProperty({
    example: false,
    description: 'Team-lead flag — a project always keeps ≥1 lead.',
  })
  isLead!: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  addedAt!: Date;
}

export class ProjectResponseDto {
  @ApiProperty({ example: '00000000-0000-4000-8000-000000000030' })
  id!: string;

  @ApiProperty({ example: 'Website relaunch', minLength: 2, maxLength: 100 })
  name!: string;

  @ApiProperty({
    example: 'Rebuild the marketing site and move it to the new CMS.',
    maxLength: 500,
    nullable: true,
    description: 'Optional blurb — null when the project has none.',
  })
  description!: string | null;

  @ApiProperty({ example: '#1F2FE0' })
  color!: string;

  @ApiProperty({
    example: '00000000-0000-4000-8000-000000000007',
    description:
      'Display credit only — the creator keeps no rights once removed from members (plan §1).',
  })
  createdByUserId!: string;

  @ApiProperty({ example: 'Maya' })
  createdByName!: string;

  @ApiProperty({
    type: [ProjectMemberResponseDto],
    description:
      'Full roster (leads first). Avatars and member counts render from this array.',
  })
  members!: ProjectMemberResponseDto[];

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: Date;
}

export class ListProjectsResponseDto {
  @ApiProperty({ type: [ProjectResponseDto] })
  projects!: ProjectResponseDto[];
}

/** GET/PATCH/create/add-member wrapper — `{ project }` bodies (plan §3). */
export class GetProjectResponseDto {
  @ApiProperty({ type: ProjectResponseDto })
  project!: ProjectResponseDto;
}

export class ProjectMessageResponseDto {
  @ApiProperty({ example: 'Project deleted.' })
  message!: string;
}

const toProjectMemberResponse = (
  member: ProjectMemberView,
): ProjectMemberResponseDto => ({
  userId: member.userId,
  name: member.name,
  email: member.email,
  role: member.role,
  isLead: member.isLead,
  addedAt: member.addedAt,
});

/** Serialization seam — repository views never leave the API directly. */
export const toProjectResponse = (view: ProjectView): ProjectResponseDto => ({
  id: view.id,
  name: view.name,
  description: view.description,
  color: view.color,
  createdByUserId: view.createdByUserId,
  createdByName: view.createdByName,
  members: view.members.map(toProjectMemberResponse),
  createdAt: view.createdAt,
  updatedAt: view.updatedAt,
});
