import type { Redis } from 'ioredis';
import { AppLogger } from '../../../../common/logger/logger';
import type { SessionService } from '../../../auth/api/session/session.service';
import type { NotificationResponseDto } from '../dto/notifications-responses.dto';
import { NotificationEmitterService } from './notification-emitter.service';

describe('NotificationEmitterService', () => {
  let emitter: NotificationEmitterService;

  const published: { channel: string; payload: string }[] = [];
  const subscribers: FakeSubscriber[] = [];

  class FakeSubscriber {
    handlers: ((channel: string, raw: string) => void)[] = [];
    subscribed: string[] = [];
    quit = jest.fn();

    subscribe(channel: string): Promise<number> {
      this.subscribed.push(channel);
      return Promise.resolve(1);
    }

    on(event: string, handler: (...args: never[]) => void): this {
      if (event === 'message') {
        this.handlers.push(
          handler as unknown as (channel: string, raw: string) => void,
        );
      }
      return this;
    }

    /** Test hook — simulate a message arriving from another node. */
    emit(channel: string, raw: string): void {
      for (const handler of this.handlers) handler(channel, raw);
    }
  }

  const redis = {
    publish: jest.fn((channel: string, payload: string): Promise<number> => {
      published.push({ channel, payload });
      return Promise.resolve(1);
    }),
    duplicate: jest.fn(() => {
      const subscriber = new FakeSubscriber();
      subscribers.push(subscriber);
      return subscriber as unknown as Redis;
    }),
  };

  const sessions = { get: jest.fn() };
  const logger = {
    child: jest.fn(() => ({ warn: jest.fn(), error: jest.fn() })),
  };

  const notification: NotificationResponseDto = {
    id: 'notif-1',
    type: 'task_assigned',
    taskId: 'task-1',
    title: 'Task assigned to you',
    body: 'WR-4 — Website relaunch',
    readAt: null,
    createdAt: '2026-01-01T00:00:00.000000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    published.length = 0;
    subscribers.length = 0;
    emitter = new NotificationEmitterService(
      redis as unknown as Redis,
      sessions as unknown as SessionService,
      logger as unknown as AppLogger,
    );
    emitter.onModuleInit();
  });

  afterEach(() => {
    emitter.onModuleDestroy();
  });

  it('opens a plain (pattern-free) subscriber on the shared channel', () => {
    expect(subscribers[0]?.subscribed).toEqual(['nexus:notifications']);
  });

  it('fans one publish out to every tab of that user and to nobody else', async () => {
    const tabA: unknown[] = [];
    const tabB: unknown[] = [];
    const other: unknown[] = [];
    emitter.subscribe('user-1', 'sid-a').subscribe((event) => tabA.push(event));
    emitter.subscribe('user-1', 'sid-b').subscribe((event) => tabB.push(event));
    emitter
      .subscribe('user-2', 'sid-c')
      .subscribe((event) => other.push(event));

    await emitter.publish('user-1', notification);

    expect(tabA).toHaveLength(1);
    expect(tabB).toHaveLength(1);
    expect(other).toHaveLength(0);
    expect(tabA[0]).toEqual({ type: 'notification', data: notification });
    // Envelope published once, for the Redis-level fan-out to other nodes.
    expect(published).toHaveLength(1);
    expect(published[0]?.channel).toBe('nexus:notifications');
    expect(JSON.parse(published[0]?.payload ?? '{}')).toEqual({
      userId: 'user-1',
      notification,
    });
  });

  it('delivers a message published by another node (Redis path)', async () => {
    const events: unknown[] = [];
    emitter
      .subscribe('user-1', 'sid-a')
      .subscribe((event) => events.push(event));

    subscribers[0]?.emit(
      'nexus:notifications',
      JSON.stringify({ userId: 'user-1', notification }),
    );

    expect(events).toEqual([{ type: 'notification', data: notification }]);
  });

  it('drops malformed envelopes without throwing', () => {
    const events: unknown[] = [];
    emitter
      .subscribe('user-1', 'sid-a')
      .subscribe((event) => events.push(event));

    expect(() =>
      subscribers[0]?.emit('nexus:notifications', 'not-json'),
    ).not.toThrow();
    expect(() =>
      subscribers[0]?.emit('nexus:notifications', JSON.stringify({})),
    ).not.toThrow();
    expect(events).toHaveLength(0);
  });

  it('stops delivering after disconnect (cleanup runs)', async () => {
    const events: unknown[] = [];
    const subscription = emitter
      .subscribe('user-1', 'sid-a')
      .subscribe((event) => events.push(event));

    subscription.unsubscribe();
    await emitter.publish('user-1', notification);

    expect(events).toHaveLength(0);
  });

  it('sends session_expired and completes when the heartbeat finds no session', async () => {
    sessions.get.mockResolvedValue(null);
    const events: { type?: string }[] = [];
    let completed = false;
    emitter.subscribe('user-1', 'sid-dead').subscribe({
      next: (event) => events.push(event as { type?: string }),
      complete: () => {
        completed = true;
      },
    });

    // Drive one heartbeat round directly (the interval is trivial wiring).
    await (emitter as unknown as { beat: () => Promise<void> }).beat();

    expect(events.map((event) => event.type)).toEqual([
      'ping',
      'session_expired',
    ]);
    expect(completed).toBe(true);
  });

  it('keeps the stream open when the session is still alive', async () => {
    sessions.get.mockResolvedValue({ userId: 'user-1', role: 'Dev' });
    const events: { type?: string }[] = [];
    let completed = false;
    emitter.subscribe('user-1', 'sid-live').subscribe({
      next: (event) => events.push(event as { type?: string }),
      complete: () => {
        completed = true;
      },
    });

    await (emitter as unknown as { beat: () => Promise<void> }).beat();

    expect(events.map((event) => event.type)).toEqual(['ping']);
    expect(completed).toBe(false);
  });

  it('never kills live streams over a Redis outage during heartbeat', async () => {
    sessions.get.mockRejectedValue(new Error('redis down'));
    const events: { type?: string }[] = [];
    let completed = false;
    emitter.subscribe('user-1', 'sid-a').subscribe({
      next: (event) => events.push(event as { type?: string }),
      complete: () => {
        completed = true;
      },
    });

    await expect(
      (emitter as unknown as { beat: () => Promise<void> }).beat(),
    ).resolves.toBeUndefined();
    expect(completed).toBe(false);
    expect(events.map((event) => event.type)).toEqual(['ping']);
  });

  it('completes every live connection on destroy', () => {
    let completed = false;
    emitter.subscribe('user-1', 'sid-a').subscribe({
      complete: () => {
        completed = true;
      },
    });

    emitter.onModuleDestroy();

    expect(completed).toBe(true);
    expect(subscribers[0]?.quit).toHaveBeenCalled();
  });
});
