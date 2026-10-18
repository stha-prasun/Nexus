import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Role } from '../../../auth/api/constants/auth.constants';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import {
  organizationMembers,
  organizations,
  users,
} from '../../../database/schema';
import {
  MEMBERS_ADVISORY_LOCK_KEY,
  REMOVED_MEMBER_ROLE,
} from '../constants/members.constants';
import { InvitePreview, Member } from '../entities/member.entity';
import type { InviteMembershipRow } from '../factories/member.factory';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Organization id + name as the members flows need them. */
export interface OrgRef {
  id: string;
  name: string;
}

export interface UserRef {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerifiedAt: Date | null;
}

interface MembershipJoinRow {
  id: string;
  organizationId: string;
  userId: string | null;
  email: string;
  status: 'INVITED' | 'ACTIVE';
  invitedRole: Role | null;
  invitedByUserId: string | null;
  invitedAt: Date;
  acceptedAt: Date | null;
  name: string | null;
  userRole: Role | null;
  emailVerifiedAt: Date | null;
  inviterEmail: string | null;
}

export type InsertInviteResult =
  | { outcome: 'inserted'; member: Member }
  | { outcome: 'conflict' };

export type ChangeRoleResult =
  | { outcome: 'changed'; member: Member }
  | { outcome: 'not_found' }
  | { outcome: 'last_admin' };

export type RemoveMemberResult =
  | { outcome: 'removed'; wasActive: boolean; userId: string | null }
  | { outcome: 'not_found' }
  | { outcome: 'last_admin' };

export type AcceptResult =
  | { outcome: 'accepted'; member: Member }
  | { outcome: 'gone' }
  | { outcome: 'already' };

/** One auto-joined invite (verify-time accept) — id + the role applied. */
export interface AcceptedInviteRef {
  membershipId: string;
  role: Role;
}

/** Thrown inside the role-change/removal transaction to force a rollback. */
class LastAdminError extends Error {
  constructor() {
    super('organization would have zero active admins');
    this.name = 'LastAdminError';
  }
}

const inviter = alias(users, 'membership_inviter');

const memberJoin = () => ({
  id: organizationMembers.id,
  organizationId: organizationMembers.organizationId,
  userId: organizationMembers.userId,
  email: organizationMembers.email,
  status: organizationMembers.status,
  invitedRole: organizationMembers.invitedRole,
  invitedByUserId: organizationMembers.invitedByUserId,
  invitedAt: organizationMembers.invitedAt,
  acceptedAt: organizationMembers.acceptedAt,
  name: users.name,
  userRole: users.role,
  emailVerifiedAt: users.emailVerifiedAt,
  inviterEmail: inviter.email,
});

const baseJoin = (tx: Database | Tx) =>
  tx
    .select(memberJoin())
    .from(organizationMembers)
    .leftJoin(users, eq(organizationMembers.userId, users.id))
    .leftJoin(inviter, eq(organizationMembers.invitedByUserId, inviter.id));

const toMember = (row: MembershipJoinRow): Member => {
  // INVITED ⇒ invitedRole (CHECK); ACTIVE ⇒ users.role. One source per state.
  const role = row.status === 'INVITED' ? row.invitedRole : row.userRole;
  if (role === null) {
    throw new Error(
      `membership ${row.id} has no role for status ${row.status}`,
    );
  }
  return new Member({
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    email: row.email,
    status: row.status,
    role,
    name: row.name,
    invitedAt: row.invitedAt,
    acceptedAt: row.acceptedAt,
    invitedBy: row.inviterEmail,
  });
};

/**
 * Entity-aware persistence for organization_members. Membership mutations
 * that must preserve the ≥1 ACTIVE Admin invariant run inside
 * `pg_advisory_xact_lock` transactions (role change, removal, accept) so
 * concurrent cross-mutations serialize; invite creation mutates no existing
 * row and relies on the unique constraints (23505 → 'conflict') instead.
 */
@Injectable()
export class MembersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findOrganization(): Promise<OrgRef | null> {
    const rows = await this.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .limit(1);
    return rows[0] ?? null;
  }

  async findUserByEmail(email: string): Promise<UserRef | null> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : { ...row };
  }

  async findUserById(id: string): Promise<UserRef | null> {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : { ...row };
  }

  /**
   * The caller's ACTIVE membership in the singleton org, or null when no org
   * exists or the caller is not an ACTIVE member. One indexed statement —
   * used by ActiveMemberGuard and the organization service's gating.
   */
  async findActiveMembershipOrg(userId: string): Promise<OrgRef | null> {
    const rows = await this.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id),
      )
      .where(
        sql`${organizationMembers.userId} = ${userId} AND ${organizationMembers.status} = 'ACTIVE'`,
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** True when the user has an account that verified its email. */
  async isUserVerified(userId: string): Promise<boolean> {
    const user = await this.findUserById(userId);
    return user !== null && user.emailVerifiedAt !== null;
  }

  async listMembers(organizationId: string): Promise<Member[]> {
    const rows = (await baseJoin(this.db)
      .where(eq(organizationMembers.organizationId, organizationId))
      .orderBy(organizationMembers.invitedAt)) as MembershipJoinRow[];
    return rows.map(toMember);
  }

  async findMembershipById(id: string): Promise<Member | null> {
    const rows = (await baseJoin(this.db)
      .where(eq(organizationMembers.id, id))
      .limit(1)) as MembershipJoinRow[];
    const row = rows[0];
    return row === undefined ? null : toMember(row);
  }

  async findMembershipByEmail(
    organizationId: string,
    email: string,
  ): Promise<Member | null> {
    const rows = (await baseJoin(this.db)
      .where(
        sql`${organizationMembers.organizationId} = ${organizationId} AND ${organizationMembers.email} = ${email}`,
      )
      .limit(1)) as MembershipJoinRow[];
    const row = rows[0];
    return row === undefined ? null : toMember(row);
  }

  /** Full joined row for accept: also needs the invitee's verification state. */
  async findMembershipDetailById(
    id: string,
  ): Promise<{ member: Member; emailVerifiedAt: Date | null } | null> {
    const rows = (await baseJoin(this.db)
      .where(eq(organizationMembers.id, id))
      .limit(1)) as MembershipJoinRow[];
    const row = rows[0];
    if (row === undefined) return null;
    return { member: toMember(row), emailVerifiedAt: row.emailVerifiedAt };
  }

  /**
   * Insert an INVITED row. A concurrent invite/accept for the same email or
   * account collapses to the unique constraint — 'conflict' lets the service
   * re-read and merge (INVITED) or answer already_member (ACTIVE).
   */
  async insertInvite(row: InviteMembershipRow): Promise<InsertInviteResult> {
    try {
      await this.db.insert(organizationMembers).values({
        id: row.id,
        organizationId: row.organizationId,
        userId: row.userId,
        email: row.email,
        status: row.status,
        invitedRole: row.invitedRole,
        invitedByUserId: row.invitedByUserId,
        invitedAt: row.invitedAt,
        acceptedAt: row.acceptedAt,
        createdAt: row.createdAt,
      });
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === '23505') return { outcome: 'conflict' };
      throw error;
    }
    const member = await this.findMembershipById(row.id);
    if (member === null) throw new Error('invite row vanished after insert');
    return { outcome: 'inserted', member };
  }

  /** Re-invite / role change on an INVITED row: writes invitedRole only. */
  async updateInviteRole(id: string, role: Role): Promise<Member | null> {
    await this.db
      .update(organizationMembers)
      .set({ invitedRole: role })
      .where(eq(organizationMembers.id, id));
    return this.findMembershipById(id);
  }

  /**
   * Role change inside the advisory-locked transaction. Writes exactly one
   * column depending on the row's *current* state (re-read under the lock):
   * ACTIVE → users.role, INVITED → invitedRole. Rolls back via LastAdminError
   * when the org would keep zero ACTIVE Admins. A row that vanished or
   * flipped state since the service loaded it → 'not_found' (rollback).
   */
  async changeRole(
    membershipId: string,
    role: Role,
  ): Promise<ChangeRoleResult> {
    try {
      return await this.db.transaction(async (tx) => {
        await this.lock(tx);
        // Single-table FOR UPDATE (a LEFT JOIN's nullable side cannot be
        // locked with FOR UPDATE) — state is re-read under the lock.
        const locked = await tx
          .select({
            id: organizationMembers.id,
            organizationId: organizationMembers.organizationId,
            userId: organizationMembers.userId,
            status: organizationMembers.status,
          })
          .from(organizationMembers)
          .where(eq(organizationMembers.id, membershipId))
          .for('update');
        const row = locked[0];
        if (row === undefined) return { outcome: 'not_found' as const };

        if (row.status === 'ACTIVE') {
          if (row.userId === null) return { outcome: 'not_found' as const };
          await tx.update(users).set({ role }).where(eq(users.id, row.userId));
        } else {
          await tx
            .update(organizationMembers)
            .set({ invitedRole: role })
            .where(eq(organizationMembers.id, membershipId));
        }

        const admins = await this.countActiveAdmins(tx, row.organizationId);
        if (admins === 0) throw new LastAdminError();

        const updated = (await baseJoin(tx)
          .where(eq(organizationMembers.id, membershipId))
          .limit(1)) as MembershipJoinRow[];
        const updatedRow = updated[0];
        if (updatedRow === undefined) return { outcome: 'not_found' as const };
        return { outcome: 'changed' as const, member: toMember(updatedRow) };
      });
    } catch (error) {
      if (error instanceof LastAdminError) return { outcome: 'last_admin' };
      throw error;
    }
  }

  /**
   * Removal inside the advisory-locked transaction: delete the row; if it
   * was ACTIVE, reset users.role → Dev in the same transaction. Rollback via
   * LastAdminError when the org would keep zero ACTIVE Admins.
   */
  async removeMember(membershipId: string): Promise<RemoveMemberResult> {
    try {
      return await this.db.transaction(async (tx) => {
        await this.lock(tx);
        const locked = await tx
          .select({
            id: organizationMembers.id,
            organizationId: organizationMembers.organizationId,
            userId: organizationMembers.userId,
            status: organizationMembers.status,
          })
          .from(organizationMembers)
          .where(eq(organizationMembers.id, membershipId))
          .for('update');
        const row = locked[0];
        if (row === undefined) return { outcome: 'not_found' as const };

        await tx
          .delete(organizationMembers)
          .where(eq(organizationMembers.id, membershipId));

        if (row.status === 'ACTIVE') {
          // CHECK guarantees user_id is set on ACTIVE rows.
          await tx
            .update(users)
            .set({ role: REMOVED_MEMBER_ROLE })
            .where(eq(users.id, row.userId as string));
          const admins = await this.countActiveAdmins(tx, row.organizationId);
          if (admins === 0) throw new LastAdminError();
        }

        return {
          outcome: 'removed' as const,
          wasActive: row.status === 'ACTIVE',
          userId: row.userId,
        };
      });
    } catch (error) {
      if (error instanceof LastAdminError) return { outcome: 'last_admin' };
      throw error;
    }
  }

  /**
   * Accept inside the advisory-locked transaction: re-verify the row is still
   * INVITED, then copy invitedRole → users.role, null invitedRole, set userId
   * (when the account was created after the invite), flip status + acceptedAt.
   * The copy and the null are one atomic statement set — the CHECK constraint
   * passes by construction. Admin-count check is unnecessary: accept never
   * demotes an existing ACTIVE member.
   */
  async accept(membershipId: string, userId: string): Promise<AcceptResult> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx);
      const rows = (await tx
        .select({
          id: organizationMembers.id,
          status: organizationMembers.status,
          userId: organizationMembers.userId,
          email: organizationMembers.email,
          invitedRole: organizationMembers.invitedRole,
        })
        .from(organizationMembers)
        .where(eq(organizationMembers.id, membershipId))
        .for('update')) as {
        id: string;
        status: 'INVITED' | 'ACTIVE';
        userId: string | null;
        email: string;
        invitedRole: Role | null;
      }[];
      const row = rows[0];
      if (row === undefined) return { outcome: 'gone' as const };
      if (row.status === 'ACTIVE') return { outcome: 'already' as const };

      const invitedRole = row.invitedRole;
      if (invitedRole === null)
        throw new Error('INVITED row without invitedRole');

      await tx
        .update(users)
        .set({ role: invitedRole })
        .where(eq(users.id, userId));
      await tx
        .update(organizationMembers)
        .set({
          userId,
          status: 'ACTIVE',
          invitedRole: null,
          acceptedAt: new Date(),
        })
        .where(eq(organizationMembers.id, membershipId));

      const updated = (await tx
        .select(memberJoin())
        .from(organizationMembers)
        .leftJoin(users, eq(organizationMembers.userId, users.id))
        .leftJoin(inviter, eq(organizationMembers.invitedByUserId, inviter.id))
        .where(eq(organizationMembers.id, membershipId))
        .limit(1)) as MembershipJoinRow[];
      const updatedRow = updated[0];
      if (updatedRow === undefined) return { outcome: 'gone' as const };
      return { outcome: 'accepted' as const, member: toMember(updatedRow) };
    });
  }

  /**
   * Auto-accept every pending invite for `email` — called when the owner
   * proves address ownership by verifying their account (verifyEmail).
   * Same transaction shape as accept() (advisory lock, FOR UPDATE, copy
   * invitedRole → users.role, null invitedRole, set userId + ACTIVE +
   * acceptedAt) but selected by the invite identity (email), because at
   * verify time there is no membership id and `user_id` is still NULL.
   * A CHECK-violating INVITED row (no role) is skipped, not accepted.
   */
  async acceptPendingForEmail(
    email: string,
    userId: string,
  ): Promise<AcceptedInviteRef[]> {
    return this.db.transaction(async (tx) => {
      await this.lock(tx);
      const rows = (await tx
        .select({
          id: organizationMembers.id,
          invitedRole: organizationMembers.invitedRole,
        })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.email, email),
            eq(organizationMembers.status, 'INVITED'),
          ),
        )
        .for('update')) as { id: string; invitedRole: Role | null }[];

      const accepted: AcceptedInviteRef[] = [];
      for (const row of rows) {
        if (row.invitedRole === null) continue;
        await tx
          .update(users)
          .set({ role: row.invitedRole })
          .where(eq(users.id, userId));
        await tx
          .update(organizationMembers)
          .set({
            userId,
            status: 'ACTIVE',
            invitedRole: null,
            acceptedAt: new Date(),
          })
          .where(eq(organizationMembers.id, row.id));
        accepted.push({ membershipId: row.id, role: row.invitedRole });
      }
      return accepted;
    });
  }

  /** Public preview for a token holder (joined with the singleton org). */
  async findInvitePreview(membershipId: string): Promise<InvitePreview | null> {
    const rows = (await baseJoin(this.db)
      .innerJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id),
      )
      .where(eq(organizationMembers.id, membershipId))
      .limit(1)) as (MembershipJoinRow & { orgName: string })[];
    const row = rows[0];
    if (
      row === undefined ||
      row.status !== 'INVITED' ||
      row.invitedRole === null
    ) {
      return null;
    }
    const accountState =
      row.userId === null
        ? 'none'
        : row.emailVerifiedAt === null
          ? 'unverified'
          : 'verified';
    return new InvitePreview({
      email: row.email,
      orgName: row.orgName,
      role: row.invitedRole,
      accountState,
    });
  }

  private async lock(tx: Database | Tx): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${MEMBERS_ADVISORY_LOCK_KEY})::bigint)`,
    );
  }

  private async countActiveAdmins(
    tx: Database | Tx,
    organizationId: string,
  ): Promise<number> {
    const rows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(
        sql`${organizationMembers.organizationId} = ${organizationId}
            AND ${organizationMembers.status} = 'ACTIVE'
            AND ${users.role} = 'Admin'`,
      );
    return rows[0]?.count ?? 0;
  }
}
