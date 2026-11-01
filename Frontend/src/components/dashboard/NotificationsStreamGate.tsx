import { useEffect } from 'react';
import {
  startNotificationsStream,
  stopNotificationsStream,
} from '@/lib/notificationsStream';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchNotifications } from '@/store/slices/notificationsSlice';

/**
 * Binds the SSE stream to the session: connects (and loads page one of the
 * notification list) the moment auth settles to `authenticated`, and closes
 * + clears on any other verdict. Every logout path dispatches `setAnonymous`,
 * so this effect alone covers them all — no per-page teardown (plan §10).
 */
export function NotificationsStreamGate() {
  const dispatch = useAppDispatch();
  const status = useAppSelector((state) => state.auth.status);

  useEffect(() => {
    if (status !== 'authenticated') {
      stopNotificationsStream();
      return;
    }
    startNotificationsStream();
    void dispatch(fetchNotifications());
    return () => stopNotificationsStream();
  }, [dispatch, status]);

  return null;
}
