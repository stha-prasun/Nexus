import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/api/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MembersModule } from '../../members/api/members.module';
import { NotificationsModule } from '../../notifications/api/notifications.module';
import { RedisModule } from '../../redis/redis.module';
import { TaskFactory } from './factories/task.factory';
import { TasksPolicy } from './policies/tasks.policy';
import { ReminderRepository } from './repositories/reminder.repository';
import { TasksRepository } from './repositories/tasks.repository';
import { TasksController } from './tasks.controller';
import { TasksScheduler } from './tasks.scheduler';
import { TasksService } from './tasks.service';

/**
 * Project task board + due-date reminder cron. One-way dependencies:
 * TasksModule imports NotificationsModule (assignment writes + post-commit
 * SSE publish via `publishExisting`, and `createForUser` for the sweep) and
 * RedisModule (the scheduler's SETNX lock) — never the reverse, so no cycle
 * forms (plan §4). The notification row itself is inserted by the tasks
 * repository inside its own mutation transaction (advisory-locked create /
 * reassign), keeping "task changed" and "notification exists" atomic.
 *
 * Member-removal unassigns do NOT come through this module: they are
 * shared-schema Drizzle updates inside the projects/members transactions
 * (§8.3) — those modules must not import TasksModule (Tasks → Members for
 * the guard would form a cycle).
 */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    MembersModule,
    NotificationsModule,
    RedisModule,
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    TaskFactory,
    TasksPolicy,
    TasksRepository,
    ReminderRepository,
    TasksScheduler,
  ],
})
export class TasksModule {}
