import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/api/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MailModule } from '../../mail/mail.module';
import { RedisModule } from '../../redis/redis.module';
import { MemberFactory } from './factories/member.factory';
import { ActiveMemberGuard } from './guards/active-member.guard';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { MembersPolicy } from './policies/members.policy';
import { MembersRepository } from './repositories/members.repository';

/**
 * Organization membership: invites (Redis tokens + mailed links), accept,
 * role changes and removals. One-way dependency: OrganizationModule imports
 * this module (bootstrap membership, GET gating, ActiveMemberGuard on its
 * mutate routes) — never the reverse, so the singleton org row is read
 * through the shared schema/DRIZZLE and no cycle forms.
 */
@Module({
  imports: [AuthModule, DatabaseModule, MailModule, RedisModule],
  controllers: [MembersController],
  providers: [
    MembersService,
    MembersRepository,
    MembersPolicy,
    MemberFactory,
    ActiveMemberGuard,
  ],
  // OrganizationModule consumes the guard (per-route), the repository
  // (ACTIVE-membership checks) and the service (bootstrap assist).
  exports: [MembersService, MembersRepository, ActiveMemberGuard],
})
export class MembersModule {}
