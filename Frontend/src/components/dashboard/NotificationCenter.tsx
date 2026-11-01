import { cn } from 'cn';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { BellIcon } from '@/components/dashboard/Icons';
import { useToast } from '@/components/dashboard/Toast';
import { ApiError, getTask, type Notification } from '@/lib/api';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  fetchNotifications,
  loadMoreNotifications,
  markAllRead,
  markRead,
} from '@/store/slices/notificationsSlice';

/** Notification type → marker color (task work vs due-date nudge). */
const TYPE_COLOR: Record<Notification['type'], string> = {
  task_assigned: '#1F2FE0',
  due_reminder: '#E5484D',
};

/** Compact stamp: time today, else month + day. */
const stamp = (iso: string): string => {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return sameDay
    ? date.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * TopBar dropdown: unread badge, newest-first list, mark one / mark all read,
 * cursor-backed "Load more", empty and error states. A click marks the row
 * read and deep-links to its task — `GET /tasks/:id` supplies the project
 * (notifications only carry `taskId`); a 404 means the task was deleted, so
 * the toast says exactly that instead of bouncing to a dead board (§9 edge 29).
 */
export function NotificationCenter() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { show, element: toastElement } = useToast();
  const [open, setOpen] = useState(false);
  const [moreError, setMoreError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const status = useAppSelector((state) => state.notifications.status);
  const items = useAppSelector((state) => state.notifications.items);
  const unreadCount = useAppSelector(
    (state) => state.notifications.unreadCount,
  );
  const nextCursor = useAppSelector((state) => state.notifications.nextCursor);
  const loadingMore = useAppSelector(
    (state) => state.notifications.loadingMore,
  );
  const error = useAppSelector((state) => state.notifications.error);

  // Close on outside click or Escape — the panel is purely local UI state.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openNotification = (notification: Notification): void => {
    setMoreError('');
    void (async () => {
      try {
        await dispatch(markRead(notification.id));
      } catch (error_) {
        show(
          error_ instanceof ApiError
            ? error_.messages.join(' ')
            : "Couldn't mark as read.",
        );
        return;
      }
      setOpen(false);
      if (notification.taskId === null) return;
      try {
        const { task } = await getTask(notification.taskId);
        navigate(`/dashboard/projects/${task.projectId}/board?task=${task.id}`);
      } catch (error_) {
        if (error_ instanceof ApiError && error_.status === 404) {
          show('That task no longer exists.');
          return;
        }
        show(
          error_ instanceof ApiError
            ? error_.messages.join(' ')
            : "Couldn't open the task.",
        );
      }
    })();
  };

  const onLoadMore = (): void => {
    setMoreError('');
    void dispatch(loadMoreNotifications()).catch((error_: unknown) => {
      setMoreError(
        error_ instanceof ApiError
          ? error_.messages.join(' ')
          : "Couldn't load older notifications.",
      );
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : 'Notifications'
        }
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center border transition-colors',
          open
            ? 'border-ink bg-ink text-white'
            : 'border-transparent text-ink-soft hover:border-ink-line hover:text-ink',
        )}
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
            aria-hidden="true"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] border-2 border-ink bg-white shadow-[8px_8px_0_#14183A]">
          <header className="flex items-center justify-between border-b border-ink-line px-4 py-3">
            <h2 className="font-display text-base font-bold tracking-tight">
              Notifications
            </h2>
            <button
              type="button"
              disabled={unreadCount === 0}
              onClick={() => {
                void dispatch(markAllRead()).catch((error_: unknown) => {
                  show(
                    error_ instanceof ApiError
                      ? error_.messages.join(' ')
                      : "Couldn't mark all as read.",
                  );
                });
              }}
              className="text-xs font-semibold text-cobalt underline-offset-2 hover:underline disabled:text-ink-soft/60 disabled:no-underline"
            >
              Mark all read
            </button>
          </header>

          <div className="max-h-[24rem] overflow-y-auto">
            {status === 'unknown' || status === 'loading' ? (
              <p className="px-4 py-8 text-center text-sm text-ink-soft">
                Loading…
              </p>
            ) : status === 'error' ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm font-semibold text-ink">
                  Couldn&apos;t load notifications.
                </p>
                <p className="mt-1 text-xs text-ink-soft">{error.join(' ')}</p>
                <button
                  type="button"
                  onClick={() => void dispatch(fetchNotifications())}
                  className="mt-3 border border-ink px-3 py-1.5 text-xs font-semibold hover:bg-paper"
                >
                  Retry
                </button>
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-soft">
                You&apos;re all caught up.
              </p>
            ) : (
              <ul>
                {items.map((notification) => {
                  const unread = notification.readAt === null;
                  return (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(notification)}
                        className={cn(
                          'flex w-full gap-3 border-b border-ink-line px-4 py-3 text-left transition-colors hover:bg-paper',
                          unread && 'bg-paper/60',
                        )}
                      >
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0"
                          style={{
                            background: TYPE_COLOR[notification.type],
                          }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span
                              className={cn(
                                'truncate text-sm',
                                unread
                                  ? 'font-bold text-ink'
                                  : 'font-semibold text-ink-soft',
                              )}
                            >
                              {notification.title}
                            </span>
                            <span className="shrink-0 text-[11px] text-ink-soft">
                              {stamp(notification.createdAt)}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-xs leading-snug text-ink-soft">
                            {notification.body}
                          </span>
                        </span>
                        {unread ? (
                          <span
                            className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cobalt"
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {nextCursor !== null && status === 'ready' ? (
              <div className="px-4 py-3 text-center">
                {moreError ? (
                  <p className="mb-2 text-xs text-red-700">{moreError}</p>
                ) : null}
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={onLoadMore}
                  className="text-xs font-semibold text-cobalt underline-offset-2 hover:underline disabled:text-ink-soft/60"
                >
                  {loadingMore ? 'Loading…' : 'Load older'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {toastElement}
    </div>
  );
}
