import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/api/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MembersModule } from '../../members/api/members.module';
import { ProjectFactory } from './factories/project.factory';
import { ProjectsPolicy } from './policies/projects.policy';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectsRepository } from './repositories/projects.repository';

/**
 * Projects: creation, role-scoped visibility (Admin/HR all, PM/Dev
 * member-only), membership management from the org roster, and the
 * ≥1-lead invariant. One-way dependency: ProjectsModule imports
 * MembersModule (ActiveMemberGuard + ACTIVE-membership reads) — never the
 * reverse, so no cycle forms (plan §4.1).
 */
@Module({
  imports: [AuthModule, DatabaseModule, MembersModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    ProjectFactory,
    ProjectsPolicy,
    ProjectsRepository,
  ],
})
export class ProjectsModule {}
