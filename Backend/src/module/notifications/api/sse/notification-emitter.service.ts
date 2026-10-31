import {
  Inject,
  Injectable,
  type MessageEvent,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { interval, Observable, Subject, type Subscription } from 'rxjs';
import { AppLogger } from '../../../../common/logger/logger';
import type { SessionService } from '../../../auth/api/session/session.service';
import { REDIS_CLIENT } from '../../../redis/constants/redis.constants';
import {
  NOTIFICATION_EVENT,
  NOTIFICATIONS_CHANNEL,
  PING_EVENT,
  SESSION_EXPIRED_EVENT,
  SSE_HEARTBEAT_MS,
} from '../constants/notifications.constants';
import type { NotificationResponseDto } from '../dto/notifications-responses.dto';

/** Redis wire envelope: which user the event is for, plus the DTO payload. */
interface RedisEnvelope {
  userId: string;
  notification: NotificationResponseDto;
}

/** One live SSE connection — its own sid, its own observer. */
interface Connection {
  userId: string;
  sid: string;
  subject: Subject<MessageEvent>;
}

/**
 * SSE fan-out for live notifications.
 *
 * Two layers: an in-process registry of live connections (one entry per tab,
 * each with its own `Subject`) and a Redis **subscriber** connection
 * (`redis.duplicate()` — subscriber mode is connection-exclusive in ioredis)
 * on a single shared channel (plain `subscribe`, never `psubscribe`). Every
 * publish reaches every node, which delivers it to each local connection of
 * that user — so a multi-instance deploy and the cron process both reach
 * browsers connected anywhere (plan §6).
 *
 * Heartbeat: a named `ping` event every 25 s (Nest's `MessageEvent` has no
 * comment field, so `: ping` comments are not emittable — clients simply
 * never subscribe to `ping`). Each tick revalidates the connection's session
 * in Redis; a dead session gets `session_expired` and a complete, so the
 * client tears down and stops reconnecting (EventSource retry would hit 401
 * forever otherwise).
 *
 * No replay on connect: the client fetches the REST list first and uses SSE
 * purely as an append channel (dedupe by `id` covers the reconnect race).
 */
@Injectable()
export class NotificationEmitterService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly connections = new Map<string, Set<Connection>>();
  private subscriber: Redis | null = null;
  private heartbeat: Subscription | null = null;
  private readonly log: ReturnType<AppLogger['child']>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly sessions: SessionService,
    logger: AppLogger,
  ) {
    this.log = logger.child('sse');
  }

  /** Open the subscriber connection once the app is up (retry-safe). */
  onModuleInit(): void {
    this.subscriber = this.redis.duplicate();
    // Without a listener a down redis would crash the process on 'error'.
    this.subscriber.on('error', () => undefined);
    void this.subscriber.subscribe(NOTIFICATIONS_CHANNEL);
    this.subscriber.on('message', (_channel: string, raw: string) => {
      this.onRedisMessage(raw);
    });
    this.heartbeat = interval(SSE_HEARTBEAT_MS).subscribe(() => {
      void this.beat();
    });
  }

  onModuleDestroy(): void {
    this.heartbeat?.unsubscribe();
    this.heartbeat = null;
    for (const set of this.connections.values()) {
      for (const connection of set) connection.subject.complete();
    }
    this.connections.clear();
    void this.subscriber?.quit();
    this.subscriber = null;
  }

  /**
   * Publish a serialized notification to every node. Called **after** the
   * DB transaction commits — a rolled-back mutation must never produce a
   * live event (plan §5).
   */
  async publish(
    userId: string,
    notification: NotificationResponseDto,
  ): Promise<void> {
    const envelope: RedisEnvelope = { userId, notification };
    await this.redis.publish(NOTIFICATIONS_CHANNEL, JSON.stringify(envelope));
    // Same-node delivery too: a Redis round trip does not echo back to the
    // publisher's own subscriber.
    this.deliver(userId, notification);
  }

  /**
   * Register a live stream for `userId`. Returns the observable the
   * controller wraps in `Observable<MessageEvent>`; cleanup runs on
   * disconnect (unsubscribe + complete).
   */
  subscribe(userId: string, sid: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((observer) => {
      const subject = new Subject<MessageEvent>();
      const connection: Connection = { userId, sid, subject };
      const set = this.connections.get(userId) ?? new Set<Connection>();
      set.add(connection);
      this.connections.set(userId, set);

      const inner = subject.subscribe({
        next: (event) => observer.next(event),
        error: (error) => observer.error(error),
        complete: () => observer.complete(),
      });

      return () => {
        inner.unsubscribe();
        subject.complete();
        const current = this.connections.get(userId);
        if (current !== undefined) {
          current.delete(connection);
          if (current.size === 0) this.connections.delete(userId);
        }
      };
    });
  }

  // ---------------------------------------------------------------- internals

  private onRedisMessage(raw: string): void {
    try {
      const envelope = JSON.parse(raw) as RedisEnvelope;
      if (typeof envelope.userId !== 'string') return;
      this.deliver(envelope.userId, envelope.notification);
    } catch {
      // A malformed envelope is droppable noise, never a crash.
      this.log.warn('sse: dropped malformed redis envelope');
    }
  }

  private deliver(userId: string, notification: NotificationResponseDto): void {
    const set = this.connections.get(userId);
    if (set === undefined) return;
    for (const connection of set) {
      connection.subject.next({
        type: NOTIFICATION_EVENT,
        data: notification,
      });
    }
  }

  /**
   * One heartbeat round: `ping` to every live connection (proxies keep the
   * socket open), then revalidate that connection's session — dead session
   * → `session_expired` + complete that connection only (other tabs keep
   * their own subjects alive).
   */
  private async beat(): Promise<void> {
    const live: Connection[] = [];
    for (const set of this.connections.values()) live.push(...set);
    for (const connection of live) {
      connection.subject.next({ type: PING_EVENT, data: { ts: Date.now() } });
      try {
        const session = await this.sessions.get(connection.sid);
        if (session === null) {
          connection.subject.next({ type: SESSION_EXPIRED_EVENT, data: {} });
          connection.subject.complete();
        }
      } catch {
        // Redis outage: fail open — never kill live streams over a blip;
        // SessionAuthGuard already answers 500 for the same outage.
      }
    }
  }
}
