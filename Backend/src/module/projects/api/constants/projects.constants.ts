/**
 * Server-side default for `projects.color` — mirrors the DTO palette's
 * primary swatch and the schema column default (single source for both).
 */
export const DEFAULT_PROJECT_COLOR = '#1F2FE0';

/** `#rrggbb` — the DTO @Matches and the schema CHECK share this shape. */
export const PROJECT_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * Key material for `pg_advisory_xact_lock(hashtext(...))` per project —
 * serializes every lead-count-checking mutation (member removal, lead
 * demotion) so the ≥1-lead invariant resolves deterministically, and the
 * org-removal path (members.repository) can take the same locks in sorted
 * order (plan §4.1).
 */
export const PROJECT_ADVISORY_LOCK_PREFIX = 'nexus:project:';

export const projectLockKey = (projectId: string): string =>
  `${PROJECT_ADVISORY_LOCK_PREFIX}${projectId}`;

/** 409 — no organization row exists yet; no project can exist either. */
export const ORGANIZATION_REQUIRED_STATUS = 'organization_required';
export const ORGANIZATION_REQUIRED_MESSAGE =
  'Create an organization before creating projects.';

/** 403 — a referenced user has no ACTIVE org membership (or no account). */
export const NOT_ORG_MEMBER_STATUS = 'not_org_member';

/**
 * The offending user is named in the message (email when the account
 * exists, raw id otherwise) so multi-offender creates are debuggable.
 */
export const notOrgMemberMessage = (who: string): string =>
  `${who} is not an active member of the organization. Invite them to the organization first.`;

/** 403 — target's org role is HR (oversight only, never a project member). */
export const PROJECT_MEMBER_ROLE_FORBIDDEN_STATUS =
  'project_member_role_forbidden';
export const PROJECT_MEMBER_ROLE_FORBIDDEN_MESSAGE =
  'HR members have organization-wide oversight and cannot be added to projects.';

/** 400 — a lead id is outside members ∪ {creator}. */
export const LEAD_NOT_MEMBER_STATUS = 'lead_not_member';
export const LEAD_NOT_MEMBER_MESSAGE =
  'Every team lead must also be a project member.';

/** 409 — the target already has a row on this project (also the 23505 race). */
export const ALREADY_PROJECT_MEMBER_STATUS = 'already_project_member';
export const ALREADY_PROJECT_MEMBER_MESSAGE =
  'This person is already a member of the project.';

/**
 * 404 — missing and invisible are indistinguishable (no existence leak):
 * PM/Dev asking about a project they are not a member of gets this too.
 */
export const PROJECT_NOT_FOUND_STATUS = 'project_not_found';
export const PROJECT_NOT_FOUND_MESSAGE = 'Project not found.';

/** 404 — no project-membership row for the given user id. */
export const PROJECT_MEMBER_NOT_FOUND_STATUS = 'project_member_not_found';
export const PROJECT_MEMBER_NOT_FOUND_MESSAGE =
  'This person is not a member of the project.';

/** 403 — every actor, every role: no self-service removal (plan §1). */
export const SELF_REMOVE_FORBIDDEN_STATUS = 'self_remove_forbidden';
export const SELF_REMOVE_FORBIDDEN_MESSAGE =
  'You cannot remove yourself from a project. Another Admin has to do it for you.';

/** 403 — PM removing a non-Dev target (Admin + peer PM are protected). */
export const PROJECT_REMOVE_FORBIDDEN_STATUS = 'project_remove_forbidden';
export const PROJECT_REMOVE_FORBIDDEN_MESSAGE =
  'Project Managers can only remove Dev members from a project.';

/**
 * 403 — the mutation would leave the project with zero leads. Thrown from
 * inside the per-project advisory-locked transaction, so the concurrent
 * loser always rolls back. Applies to Admin too (plan §1).
 */
export const LAST_LEAD_REQUIRED_STATUS = 'last_lead_required';
export const LAST_LEAD_REQUIRED_MESSAGE =
  'A project must keep at least one team lead. Promote another lead first.';

/** 200 — project deleted (members cascade with it). */
export const PROJECT_DELETED_MESSAGE = 'Project deleted.';
