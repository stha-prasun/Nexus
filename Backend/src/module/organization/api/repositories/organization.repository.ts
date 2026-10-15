import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import { organizations } from '../../../database/schema';
import {
  ORGANIZATION_EXISTS_MESSAGE,
  ORGANIZATION_EXISTS_STATUS,
} from '../constants/organization.constants';
import { Organization } from '../entities/organization.entity';

type OrganizationRow = typeof organizations.$inferSelect;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === '23505';

const toEntity = (row: OrganizationRow): Organization =>
  new Organization({
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/**
 * Entity-aware persistence for the singleton organization. The singleton
 * guarantee itself lives in the DB (UNIQUE + CHECK on `singleton`); the
 * unique violation caught here is the race path — a concurrent create won
 * the INSERT between the service's pre-check and this write — and maps to
 * the same 409 the pre-check answers. `updatedAt` is stamped by the
 * column's `$onUpdate` on every UPDATE.
 */
@Injectable()
export class OrganizationRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findSingleton(): Promise<Organization | null> {
    const rows = await this.db.select().from(organizations).limit(1);
    const row = rows[0];
    return row ? toEntity(row) : null;
  }

  async insert(organization: Organization): Promise<Organization> {
    try {
      const rows = await this.db
        .insert(organizations)
        .values({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          createdByUserId: organization.createdByUserId,
          createdAt: organization.createdAt,
          updatedAt: organization.updatedAt,
        })
        .returning();
      return toEntity(rows[0]);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw new ConflictException({
        status: ORGANIZATION_EXISTS_STATUS,
        message: ORGANIZATION_EXISTS_MESSAGE,
      });
    }
  }

  async update(
    id: string,
    changes: { name?: string; slug?: string },
  ): Promise<Organization | null> {
    const rows = await this.db
      .update(organizations)
      .set(changes)
      .where(eq(organizations.id, id))
      .returning();
    const row = rows[0];
    return row ? toEntity(row) : null;
  }

  /** Hard delete — the plan explicitly rules out soft delete for now. */
  async remove(id: string): Promise<void> {
    await this.db.delete(organizations).where(eq(organizations.id, id));
  }
}
