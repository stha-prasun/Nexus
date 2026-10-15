import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/api/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { OrganizationFactory } from './factories/organization.factory';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { OrganizationPolicy } from './policies/organization.policy';
import { OrganizationRepository } from './repositories/organization.repository';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [OrganizationController],
  providers: [
    OrganizationService,
    OrganizationFactory,
    OrganizationPolicy,
    OrganizationRepository,
  ],
})
export class OrganizationModule {}
