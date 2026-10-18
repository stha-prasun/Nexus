/**
 * Membership lifecycle states — append-only (mirrors `ROLES`: the schema's
 * `member_status` PG enum is built from this array, so new states are
 * appended to the tail, never reordered).
 */
export const MEMBER_STATUSES = ['INVITED', 'ACTIVE'] as const;

export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/**
 * `users.role` value a member is reset to when their membership is removed
 * (same transaction as the row delete). A removed account keeps no trace of
 * its previous role — re-invite starts fresh at `INVITED`.
 */
export const REMOVED_MEMBER_ROLE = 'Dev';

/** 409 — no organization row exists yet; nobody can be invited. */
export const ORGANIZATION_REQUIRED_STATUS = 'organization_required';
export const ORGANIZATION_REQUIRED_MESSAGE =
  'Create an organization before inviting members.';

/** 409 — the email already belongs to an ACTIVE member (change role instead). */
export const ALREADY_MEMBER_STATUS = 'already_member';
export const ALREADY_MEMBER_MESSAGE =
  'This person is already a member of the organization.';

/** 403 — the caller invited themselves. */
export const SELF_INVITE_STATUS = 'self_invite_forbidden';
export const SELF_INVITE_MESSAGE = 'You cannot invite yourself.';

/** 403 — every actor, every operation: no self-demotion, no self-removal. */
export const SELF_MANAGE_STATUS = 'self_manage_forbidden';
export const SELF_MANAGE_MESSAGE =
  'You cannot change your own role or remove yourself. Another Admin has to do it for you.';

/** 404 — no membership row for the given id. */
export const MEMBER_NOT_FOUND_STATUS = 'member_not_found';
export const MEMBER_NOT_FOUND_MESSAGE = 'Member not found.';

/** 403 — the actor's policy does not allow managing that role (§1.1 matrix). */
export const MEMBER_POLICY_STATUS = 'member_policy_forbidden';
export const MEMBER_POLICY_MESSAGE =
  'Your role is not allowed to manage that role.';

/**
 * 403 — the mutation would leave the organization with zero ACTIVE Admins.
 * Thrown from inside the advisory-locked transaction, so the concurrent
 * loser always rolls back (§1.1).
 */
export const LAST_ADMIN_STATUS = 'last_admin_required';
export const LAST_ADMIN_MESSAGE =
  'The organization must keep at least one active Admin. Promote another Admin first.';

/** 403 — caller has no ACTIVE membership (or no org and one is required). */
export const NOT_ACTIVE_MEMBER_STATUS = 'not_active_member';
export const NOT_ACTIVE_MEMBER_MESSAGE =
  'You are not an active member of this organization.';

/** 404 — token unknown, consumed, expired, or the row was deleted. */
export const INVITE_INVALID_STATUS = 'invite_invalid_or_expired';
export const INVITE_INVALID_MESSAGE =
  'This invitation link is invalid or has expired. Ask an Admin to resend it.';

/** 403 — session email does not match the invited email. */
export const INVITE_EMAIL_MISMATCH_STATUS = 'invite_email_mismatch';
export const INVITE_EMAIL_MISMATCH_MESSAGE =
  'This invitation was sent to a different email address. Sign out and sign in with the invited email to accept.';

/** 403 — invited account has not confirmed its email yet. */
export const EMAIL_UNVERIFIED_STATUS = 'email_unverified';
export const EMAIL_UNVERIFIED_MESSAGE =
  'Verify your email address before accepting this invitation.';

/** 403 — a signed-in user tried to accept an invitation for another account. */
export const UNAUTHENTICATED_ACCEPT_STATUS = 'unauthenticated';
export const UNAUTHENTICATED_ACCEPT_MESSAGE =
  'Sign in with the invited email to accept this invitation.';

/** 200 — invitation accepted; the caller is now an ACTIVE member. */
export const INVITE_ACCEPTED_MESSAGE = 'You have joined the organization.';

/** 201 — invitation created and queued for delivery. */
export const INVITE_SENT_MESSAGE = 'The invitation has been sent.';

/** 200 — existing invitation re-issued (role updated, token regenerated). */
export const INVITE_RESENT_MESSAGE =
  'A new invitation link has been sent. The previous link no longer works.';

/** 200 — role changed (or matched — same-role is a no-op). */
export const MEMBER_ROLE_UPDATED_MESSAGE = 'Member role updated.';

/** 200 — membership removed (and role reset to Dev in the same transaction). */
export const MEMBER_REMOVED_MESSAGE = 'Member removed from the organization.';

/**
 * Redis key layout for invite tokens (mirrors the verification pattern):
 * token → membershipId, and the reverse for one active token per membership.
 * Payload is an id only — no PII in Redis.
 */
export const INVITE_TOKEN_PREFIX = 'members:invite:';
export const INVITE_MEMBERSHIP_PREFIX = 'members:invite:mid:';

export const inviteTokenKey = (token: string): string =>
  `${INVITE_TOKEN_PREFIX}${token}`;

export const inviteMembershipKey = (membershipId: string): string =>
  `${INVITE_MEMBERSHIP_PREFIX}${membershipId}`;

const inviteTtlHours = Number(process.env.INVITE_TOKEN_TTL_HOURS ?? 168);

/** Invite links live 7 days by default (env `INVITE_TOKEN_TTL_HOURS`). */
export const INVITE_TOKEN_TTL_SECONDS =
  Number.isFinite(inviteTtlHours) && inviteTtlHours > 0
    ? inviteTtlHours * 3600
    : 168 * 3600;

/**
 * Key material for `pg_advisory_xact_lock(hashtext(...))` — serializes every
 * row-mutating membership operation so the ≥1 ACTIVE Admin invariant and the
 * accept-vs-remove race resolve deterministically (§1.1).
 */
export const MEMBERS_ADVISORY_LOCK_KEY = 'nexus:members';
