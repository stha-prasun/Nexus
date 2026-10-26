import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Role } from '../../../auth/api/constants/auth.constants';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import {
  organizationMembers,
  projectMembers,
  projects,
  users,
} from '../../../database/schema';
import { projectLockKey } from '../constants/projects.constants';
import { Project } from '../entities/project.entity';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** One hydrated member row — org role included for the UI's role column. */
export interface ProjectMemberView {
  userId: string;
  name: string;
  email: string;
  role: Role;
  isLead: boolean;
  addedAt: Date;
}

/** Full API-facing project shape: row + creator credit + members. */
export interface ProjectView {
  id: string;
  organizationId: string;
  name: string;
  color: string;
  createdByUserId: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  members: ProjectMemberView[];
}

/** A resolved ACTIVE org membership — the "only org members" checkpoint. */
export interface ActiveOrgMembership {
  organizationMemberId: string;
  userId: string;
  role: Role;
}

/** Membership rows written in the same transaction as the project row. */
export interface ProjectMembershipRow {
  organizationMemberId: string;
  userId: string;
  isLead: boolean;
  addedByUserId: string | null;
}

export type AddMemberResult =
  | { outcome: 'inserted'; project: ProjectView }
  | { outcome: 'conflict' };

export type RemoveMemberResult =
  | { outcome: 'removed' }
  | { outcome: 'not_found' }
  | { outcome: 'last_lead' };

export type SetLeadResult =
  | { outcome: 'updated' }
  | { outcome: 'not_found' }
  | { outcome: 'last_lead' };

/** Thrown inside a lead-counting transaction to force a rollback. */
class LastLeadError extends Error {
  constructor() {
    super('project would have zero team leads');
    this.name = 'LastLeadError';
  }
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === '23505';

const projectSelect = {
  id: projects.id,
  organizationId: projects.organizationId,
  name: projects.name,
  color: projects.color,
  createdByUserId: projects.createdByUserId,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
  createdByName: users.name,
};

type ProjectBaseRowResolved = {
  id: string;
  organizationId: string;
  name: string;
  color: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  createdByName: string;
};

type MemberJoinRow = {
  projectId: string;
  organizationMemberId: string;
  userId: string | null;
  name: string;
  email: string;
  role: Role;
  isLead: boolean;
  addedAt: Date;
};

/**
 * Entity-aware persistence for projects + project_members. Every mutation
 * that must preserve the ≥1-lead invariant runs inside a per-project
 * `pg_advisory_xact_lock` transaction (removal, demotion) and re-reads the
 * affected row with `FOR UPDATE` under the lock — same shape as the members
 * repository's `last_admin_required` transactions. Lock ordering: project
 * mutations take the project lock only, never the members lock; the
 * org-removal path (members.repository) takes members-lock → sorted
 * project-locks — an acyclic graph, so no deadlock is possible (plan §4.1).
 */
@Injectable()
export class ProjectsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Every project in the org, each hydrated with its members. */
  async listProjects(organizationId: string): Promise<ProjectView[]> {
    const bases = await this.db
      .select(projectSelect)
      .from(projects)
      .innerJoin(users, eq(projects.createdByUserId, users.id))
      .where(eq(projects.organizationId, organizationId))
      .orderBy(asc(projects.createdAt));
    return this.hydrateMany(bases as ProjectBaseRowResolved[]);
  }

  /** Projects the given user is a member of (PM/Dev visibility scope). */
  async listProjectsForMember(
    organizationId: string,
    userId: string,
  ): Promise<ProjectView[]> {
    const bases = await this.db
      .select(projectSelect)
      .from(projects)
      .innerJoin(users, eq(projects.createdByUserId, users.id))
      .where(
        sql`${projects.organizationId} = ${organizationId}
            AND ${projects.id} IN (
              SELECT ${projectMembers.projectId} FROM ${projectMembers}
              WHERE ${projectMembers.userId} = ${userId}
            )`,
      )
      .orderBy(asc(projects.createdAt));
    return this.hydrateMany(bases as ProjectBaseRowResolved[]);
  }

  /** One hydrated project, or null (missing and invisible stay indistinguishable). */
  async findProjectById(id: string): Promise<ProjectView | null> {
    const bases = await this.db
      .select(projectSelect)
      .from(projects)
      .innerJoin(users, eq(projects.createdByUserId, users.id))
      .where(eq(projects.id, id))
      .limit(1);
    const base = bases[0];
    if (base === undefined) return null;
    return this.hydrateOne(base as ProjectBaseRowResolved);
  }

  /**
   * ACTIVE org memberships for the given user ids — the "only existing org
   * members" checkpoint for create/add (INVITED rows and strangers miss).
   */
  async findActiveOrgMemberships(
    organizationId: string,
    userIds: string[],
  ): Promise<ActiveOrgMembership[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select({
        organizationMemberId: organizationMembers.id,
        userId: organizationMembers.userId,
        role: users.role,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.status, 'ACTIVE'),
          inArray(organizationMembers.userId, userIds),
        ),
      );
    return rows.map((row) => ({
      organizationMemberId: row.organizationMemberId,
      // CHECK guarantees user_id is set on ACTIVE rows.
      userId: row.userId as string,
      role: row.role,
    }));
  }

  /**
   * Insert the project and every membership row (creator first) in one
   * transaction — partial creation is impossible. Hydrated view comes from
   * the same transaction, so the caller sees exactly what landed.
   */
  async insertProjectWithMembers(
    project: Project,
    rows: ProjectMembershipRow[],
  ): Promise<ProjectView> {
    return this.db.transaction(async (tx) => {
      await tx.insert(projects).values({
        id: project.id,
        organizationId: project.organizationId,
        name: project.name,
        color: project.color,
        createdByUserId: project.createdByUserId,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });
      for (const row of rows) {
        await tx.insert(projectMembers).values({
          projectId: project.id,
          organizationMemberId: row.organizationMemberId,
          userId: row.userId,
          isLead: row.isLead,
          addedByUserId: row.addedByUserId,
        });
      }
      const view = await this.loadProjectView(tx, project.id);
      if (view === null) {
        throw new Error(`project ${project.id} vanished after insert`);
      }
      return view;
    });
  }

  /**
   * Insert one membership row. The API pre-checks membership, but a
   * concurrent add collapses to the unique constraint — 'conflict' lets the
   * service answer 409 `already_project_member`.
   */
  async addMember(
    projectId: string,
    row: ProjectMembershipRow,
  ): Promise<AddMemberResult> {
    try {
      await this.db.insert(projectMembers).values({
        projectId,
        organizationMemberId: row.organizationMemberId,
        userId: row.userId,
        isLead: row.isLead,
        addedByUserId: row.addedByUserId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) return { outcome: 'conflict' };
      throw error;
    }
    const project = await this.findProjectById(projectId);
    if (project === null) throw new Error(`project ${projectId} vanished`);
    return { outcome: 'inserted', project };
  }

  /**
   * Remove a membership inside the per-project advisory-locked transaction:
   * lock → `FOR UPDATE` re-read → if the target is a lead, recount *other*
   * leads (0 → rollback via LastLeadError) → delete. The org-role checks
   * (self, PM-target) happen in the service before this call.
   */
  async removeMember(
    projectId: string,
    userId: string,
  ): Promise<RemoveMemberResult> {
    try {
      return await this.db.transaction(async (tx) => {
        await this.lockProject(tx, projectId);
        const locked = await tx
          .select({
            id: projectMembers.id,
            isLead: projectMembers.isLead,
          })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, userId),
            ),
          )
          .for('update');
        const row = locked[0];
        if (row === undefined) return { outcome: 'not_found' as const };

        if (row.isLead) {
          const others = await this.countOtherLeads(tx, projectId, row.id);
          if (others === 0) throw new LastLeadError();
        }
        await tx.delete(projectMembers).where(eq(projectMembers.id, row.id));
        return { outcome: 'removed' as const };
      });
    } catch (error) {
      if (error instanceof LastLeadError) return { outcome: 'last_lead' };
      throw error;
    }
  }

  /**
   * Lead toggle. Promotion is a plain update (adds a lead — never breaks the
   * invariant). Demotion runs under the per-project lock: recount *other*
   * leads after the flip; 0 → rollback via LastLeadError.
   */
  async setLead(
    projectId: string,
    userId: string,
    isLead: boolean,
  ): Promise<SetLeadResult> {
    if (isLead) {
      await this.db
        .update(projectMembers)
        .set({ isLead: true })
        .where(
          and(
            eq(projectMembers.projectId, projectId),
            eq(projectMembers.userId, userId),
          ),
        );
      return { outcome: 'updated' };
    }
    try {
      return await this.db.transaction(async (tx) => {
        await this.lockProject(tx, projectId);
        const locked = await tx
          .select({ id: projectMembers.id })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, userId),
            ),
          )
          .for('update');
        const row = locked[0];
        if (row === undefined) return { outcome: 'not_found' as const };

        const others = await this.countOtherLeads(tx, projectId, row.id);
        if (others === 0) throw new LastLeadError();
        await tx
          .update(projectMembers)
          .set({ isLead: false })
          .where(eq(projectMembers.id, row.id));
        return { outcome: 'updated' as const };
      });
    } catch (error) {
      if (error instanceof LastLeadError) return { outcome: 'last_lead' };
      throw error;
    }
  }

  /** Rename/recolor; `updatedAt` is stamped by the column's `$onUpdate`. */
  async update(
    id: string,
    changes: { name?: string; color?: string },
  ): Promise<ProjectView | null> {
    await this.db.update(projects).set(changes).where(eq(projects.id, id));
    return this.findProjectById(id);
  }

  /** Hard delete — project_members cascade with the row. */
  async remove(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  // ---------------------------------------------------------------- helpers

  private async lockProject(
    tx: Database | Tx,
    projectId: string,
  ): Promise<void> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${projectLockKey(projectId)})::bigint)`,
    );
  }

  /** Lead rows on `projectId` excluding `exceptId` — the invariant probe. */
  private async countOtherLeads(
    tx: Database | Tx,
    projectId: string,
    exceptId: string,
  ): Promise<number> {
    const rows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.isLead, true),
          ne(projectMembers.id, exceptId),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  private async hydrateMany(
    bases: ProjectBaseRowResolved[],
  ): Promise<ProjectView[]> {
    if (bases.length === 0) return [];
    const memberRows = (await this.db
      .select({
        projectId: projectMembers.projectId,
        organizationMemberId: projectMembers.organizationMemberId,
        userId: projectMembers.userId,
        name: users.name,
        email: users.email,
        role: users.role,
        isLead: projectMembers.isLead,
        addedAt: projectMembers.createdAt,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(
        inArray(
          projectMembers.projectId,
          bases.map((base) => base.id),
        ),
      )) as MemberJoinRow[];
    const byProject = new Map<string, ProjectMemberView[]>();
    for (const row of memberRows) {
      const list = byProject.get(row.projectId) ?? [];
      list.push(toMemberView(row));
      byProject.set(row.projectId, list);
    }
    return bases.map((base) =>
      toProjectView(base, byProject.get(base.id) ?? []),
    );
  }

  private async hydrateOne(base: ProjectBaseRowResolved): Promise<ProjectView> {
    const memberRows = (await this.db
      .select({
        projectId: projectMembers.projectId,
        organizationMemberId: projectMembers.organizationMemberId,
        userId: projectMembers.userId,
        name: users.name,
        email: users.email,
        role: users.role,
        isLead: projectMembers.isLead,
        addedAt: projectMembers.createdAt,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, base.id))) as MemberJoinRow[];
    return toProjectView(base, memberRows.map(toMemberView));
  }

  private async loadProjectView(
    tx: Database | Tx,
    projectId: string,
  ): Promise<ProjectView | null> {
    const bases = (await tx
      .select(projectSelect)
      .from(projects)
      .innerJoin(users, eq(projects.createdByUserId, users.id))
      .where(eq(projects.id, projectId))
      .limit(1)) as ProjectBaseRowResolved[];
    const base = bases[0];
    if (base === undefined) return null;
    const memberRows = (await tx
      .select({
        projectId: projectMembers.projectId,
        organizationMemberId: projectMembers.organizationMemberId,
        userId: projectMembers.userId,
        name: users.name,
        email: users.email,
        role: users.role,
        isLead: projectMembers.isLead,
        addedAt: projectMembers.createdAt,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(eq(projectMembers.projectId, projectId))) as MemberJoinRow[];
    return toProjectView(base, memberRows.map(toMemberView));
  }
}

const toMemberView = (row: MemberJoinRow): ProjectMemberView => ({
  // CHECK guarantees user_id on every inserted row.
  userId: row.userId as string,
  name: row.name,
  email: row.email,
  role: row.role,
  isLead: row.isLead,
  addedAt: row.addedAt,
});

const toProjectView = (
  base: ProjectBaseRowResolved,
  members: ProjectMemberView[],
): ProjectView => ({
  id: base.id,
  organizationId: base.organizationId,
  name: base.name,
  color: base.color,
  createdByUserId: base.createdByUserId,
  createdByName: base.createdByName,
  createdAt: base.createdAt,
  updatedAt: base.updatedAt,
  // Leads first, then insertion order — deterministic presentation.
  members: [...members].sort(
    (a, b) =>
      Number(b.isLead) - Number(a.isLead) ||
      a.addedAt.getTime() - b.addedAt.getTime(),
  ),
});
