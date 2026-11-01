import { type Notification, notificationsStreamUrl } from '@/lib/api';
import { store } from '@/store';
import { setAnonymous } from '@/store/slices/authSlice';
import { clearMembers } from '@/store/slices/membersSlice';
import {
  clearNotifications,
  fetchNotifications,
  notificationReceived,
} from '@/store/slices/notificationsSlice';
import { clearOrg } from '@/store/slices/orgSlice';
import { clearProjects } from '@/store/slices/projectsSlice';

let source: EventSource | null = null;
/** Whether we've completed at least one connect — the first open needs no
 * reconcile (the gate already fetched page one); later opens are reconnects. */
let connectedOnce = false;

/**
 * Live notification transport (plan §6): a native `EventSource` singleton on
 * `GET /notifications/stream`, started once the session is authenticated and
 * closed on logout. Only the `notification` event is subscribed — the server's
 * named `ping` heartbeat is ignored by construction (browsers deliver only
 * listened names), and `session_expired` runs the full logout teardown.
 *
 * No replay on connect: the REST list is the source of truth, this channel
 * only appends live rows (dedupe by id in the slice covers the reconnect
 * race). On every *re*connect the first page is re-fetched to reconcile
 * anything missed while disconnected (edge 41).
 */
export function startNotificationsStream(): void {
  if (source !== null) return; // idempotent — StrictMode double-effects

  const events = new EventSource(notificationsStreamUrl(), {
    withCredentials: true, // the httpOnly nexus_sid cookie rides along
  });
  source = events;

  events.addEventListener('open', () => {
    if (connectedOnce) {
      void store.dispatch(fetchNotifications());
    }
    connectedOnce = true;
  });

  events.addEventListener('notification', (event) => {
    try {
      const notification = JSON.parse(
        (event as MessageEvent).data,
      ) as Notification;
      store.dispatch(notificationReceived(notification));
    } catch {
      // Malformed payload — droppable noise, never a crash.
    }
  });

  events.addEventListener('session_expired', () => {
    // Heartbeat found a dead session: tear everything down and stop
    // reconnecting — EventSource would otherwise retry into 401 forever.
    stopNotificationsStream();
    store.dispatch(clearMembers());
    store.dispatch(clearOrg());
    store.dispatch(clearProjects());
    store.dispatch(setAnonymous());
  });
}

/**
 * Close the stream and drop the cached list (edge 50). Idempotent — called
 * by the gate's effect cleanup and by `session_expired`.
 */
export function stopNotificationsStream(): void {
  source?.close();
  source = null;
  connectedOnce = false;
  store.dispatch(clearNotifications());
}
