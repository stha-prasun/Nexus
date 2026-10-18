import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/api/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MembersModule } from '../../members/api/members.module';
import { OrganizationFactory } from './factories/organization.factory';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { OrganizationPolicy } from './policies/organization.policy';
import { OrganizationRepository } from './repositories/organization.repository';

@Module({
  // MembersModule (one-way): ActiveMemberGuard on mutate routes, the
  // ACTIVE-membership re-checks in the service, and the bootstrap membership
  // created alongside the org row.
  imports: [AuthModule, DatabaseModule, MembersModule],
  controllers: [OrganizationController],
  providers: [
    OrganizationService,
    OrganizationFactory,
    OrganizationPolicy,
    OrganizationRepository,
  ],
})
export class OrganizationModule {}
