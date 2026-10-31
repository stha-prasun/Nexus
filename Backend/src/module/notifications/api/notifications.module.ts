import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/api/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MembersModule } from '../../members/api/members.module';
import { RedisModule } from '../../redis/redis.module';
import { NotificationFactory } from './factories/notification.factory';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './repositories/notifications.repository';
import { NotificationEmitterService } from './sse/notification-emitter.service';

/**
 * Notification center: the REST source of truth (cursor list, read/read-all)
 * plus the live SSE stream. Leaf module — imports Auth/Database/Members/Redis
 * only and **never** TasksModule: the scheduler and assignment side-effects
 * live on the tasks side and call `NotificationsService.createForUser`
 * (one-way dependency, plan §4).
 */
@Module({
  imports: [AuthModule, DatabaseModule, MembersModule, RedisModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsRepository,
    NotificationFactory,
    NotificationEmitterService,
  ],
  // TasksModule consumes the service (assignment + reminder writes), the
  // factory (row construction) and the emitter (publish after commit), plus
  // the repository — TasksRepository inserts its notification row *inside*
  // the task mutation's own transaction (tx-aware `insert(row, tx)`), which
  // is what keeps "task changed" and "notification exists" atomic (plan §5).
  exports: [
    NotificationsService,
    NotificationsRepository,
    NotificationFactory,
    NotificationEmitterService,
  ],
})
export class NotificationsModule {}
