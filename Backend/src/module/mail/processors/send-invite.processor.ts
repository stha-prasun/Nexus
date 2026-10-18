import { Inject, Injectable } from '@nestjs/common';
import { type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Redis } from 'ioredis';
import { AppLogger } from '../../../common/logger/logger';
import { DRIZZLE } from '../../database/constants/database.contants';
import type { Database } from '../../database/interfaces/database.interfaces';
import {
  organizationMembers,
  organizations,
  users,
} from '../../database/schema';
import {
  INVITE_TOKEN_TTL_SECONDS,
  inviteMembershipKey,
} from '../../members/api/constants/members.constants';
import { REDIS_CLIENT } from '../../redis/constants/redis.constants';
import { MailService } from '../mail.service';
import {
  buildInviteMember,
  buildInviteMemberLink,
} from '../templates/invite-member';
import { classifyMailError } from './mail-error';

const env = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

export interface InviteMemberJobResult {
  status: 'sent' | 'skipped';
}

/**
 * Sends one invitation email. The payload is only `membershipId`; the token,
 * membership row, invitee and organization are re-fetched at execution time so
 * the latest state always wins (re-invite regenerates the token, removal
 * deletes the row — either way this job sends nothing stale). A removed,
 * already-accepted, or tokenless membership completes as `skipped`, not
 * failed, to avoid wasted delivery and retry storms.
 *
 * The recipient is `organization_members.email`, not a joined `users` row —
 * an invite may target an address that has no account yet (`user_id` NULL),
 * and that is the common case. The users join is only used (left) for the
 * inviter's display name.
 */
@Injectable()
export class SendInviteProcessor {
  private readonly log: ReturnType<AppLogger['child']>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly mailService: MailService,
    logger: AppLogger,
  ) {
    this.log = logger.child('mail:invite');
  }

  async process(
    job: Job<{ membershipId: string }>,
  ): Promise<InviteMemberJobResult> {
    const { membershipId } = job.data;

    const token = await this.redis.get(inviteMembershipKey(membershipId));
    if (token === null) {
      this.log.info('invite skipped', { membershipId, reason: 'token_gone' });
      return { status: 'skipped' };
    }

    const inviter = alias(users, 'invite_sender');
    const rows = await this.db
      .select({
        status: organizationMembers.status,
        invitedRole: organizationMembers.invitedRole,
        email: organizationMembers.email,
        orgName: organizations.name,
        inviterName: inviter.name,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id),
      )
      .leftJoin(inviter, eq(organizationMembers.invitedByUserId, inviter.id))
      .where(eq(organizationMembers.id, membershipId))
      .limit(1);
    const row = rows[0];
    if (row === undefined || row.status !== 'INVITED') {
      this.log.info('invite skipped', {
        membershipId,
        reason: row === undefined ? 'membership_gone' : 'not_invited',
      });
      return { status: 'skipped' };
    }
    if (row.invitedRole === null) {
      // CHECK-violating row (INVITED ⇒ role) — sending a roleless invite is
      // worse than skipping; surface it loudly instead.
      this.log.error('invite skipped', {
        membershipId,
        reason: 'missing_invited_role',
      });
      return { status: 'skipped' };
    }

    const link = buildInviteMemberLink(
      env('FRONTEND_URL', 'http://localhost:5173'),
      token,
    );
    const expiresInDays = Math.max(
      1,
      Math.round(INVITE_TOKEN_TTL_SECONDS / 86_400),
    );
    const content = buildInviteMember(
      row.orgName,
      row.inviterName,
      row.invitedRole,
      link,
      expiresInDays,
    );

    try {
      await this.mailService.send({ to: row.email, ...content });
    } catch (error) {
      this.log.error('invite email failed', {
        membershipId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw classifyMailError(error);
    }

    return { status: 'sent' };
  }
}
