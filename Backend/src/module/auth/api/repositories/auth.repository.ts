import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../../../database/constants/database.contants';
import type { Database } from '../../../database/interfaces/database.interfaces';
import { users } from '../../../database/schema';
import type { Role } from '../constants/auth.constants';
import { User } from '../entities/user.entity';

type UserRow = typeof users.$inferSelect;

const toEntity = (row: UserRow): User =>
  new User({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as Role,
    passwordHash: row.passwordHash,
    emailVerifiedAt: row.emailVerifiedAt,
    createdAt: row.createdAt,
  });

/** Entity-aware persistence for auth flows. Rows map to `User` directly here. */
@Injectable()
export class AuthRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const row = rows[0];
    return row ? toEntity(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    const row = rows[0];
    return row ? toEntity(row) : null;
  }

  async insert(user: User): Promise<User> {
    const rows = await this.db
      .insert(users)
      .values({
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash: user.passwordHash,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
      })
      .returning();
    return toEntity(rows[0]);
  }

  async save(user: User): Promise<User> {
    if (user.id === undefined) {
      throw new Error('Cannot save a user without an id');
    }
    const rows = await this.db
      .update(users)
      .set({ emailVerifiedAt: user.emailVerifiedAt })
      .where(eq(users.id, user.id))
      .returning();
    if (rows.length === 0) {
      throw new Error(`User ${user.id} not found`);
    }
    return toEntity(rows[0]);
  }
}
