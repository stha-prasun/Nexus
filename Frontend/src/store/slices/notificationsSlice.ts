import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import {
  ApiError,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
  type NotificationCursor,
} from '@/lib/api';
import type { AppDispatch, RootState } from '@/store';
import { setAnonymous } from '@/store/slices/authSlice';

export interface NotificationsState {
  /** `unknown` until the first GET; `error` keeps the list empty + offers retry. */
  status: 'unknown' | 'loading' | 'ready' | 'error';
  items: Notification[];
  /** Server-derived on every list fetch; incremented/decremented between them. */
  unreadCount: number;
  /** Older-page boundary — null means the list is fully paged. */
  nextCursor: NotificationCursor | null;
  loadingMore: boolean;
  error: string[];
}

const initialState: NotificationsState = {
  status: 'unknown',
  items: [],
  unreadCount: 0,
  nextCursor: null,
  loadingMore: false,
  error: [],
};

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    fetchStarted(state) {
      state.status = 'loading';
      state.error = [];
    },
    /** First page replaces the list — the REST source of truth (plan §3.2). */
    fetchSucceeded(
      state,
      action: PayloadAction<{
        notifications: Notification[];
        unreadCount: number;
        nextCursor: NotificationCursor | null;
      }>,
    ) {
      state.status = 'ready';
      state.items = action.payload.notifications;
      state.unreadCount = action.payload.unreadCount;
      state.nextCursor = action.payload.nextCursor;
      state.error = [];
    },
    fetchFailed(state, action: PayloadAction<string[]>) {
      state.status = 'error';
      state.items = [];
      state.unreadCount = 0;
      state.nextCursor = null;
      state.error = action.payload;
    },
    /** Live SSE append — dedupe by id covers the reconnect race (§6). */
    notificationReceived(state, action: PayloadAction<Notification>) {
      if (state.items.some((item) => item.id === action.payload.id)) return;
      state.items = [action.payload, ...state.items];
      if (action.payload.readAt === null) state.unreadCount += 1;
    },
    loadMoreStarted(state) {
      state.loadingMore = true;
    },
    loadMoreSucceeded(
      state,
      action: PayloadAction<{
        notifications: Notification[];
        unreadCount: number;
        nextCursor: NotificationCursor | null;
      }>,
    ) {
      state.loadingMore = false;
      // Older page appends below; dedupe guards a burst at the boundary.
      for (const notification of action.payload.notifications) {
        if (!state.items.some((item) => item.id === notification.id)) {
          state.items.push(notification);
        }
      }
      state.unreadCount = action.payload.unreadCount;
      state.nextCursor = action.payload.nextCursor;
    },
    loadMoreFailed(state) {
      state.loadingMore = false;
    },
    /** One row marked read — server already answered 204 (idempotent). */
    notificationRead(state, action: PayloadAction<string>) {
      const item = state.items.find((row) => row.id === action.payload);
      if (!item || item.readAt !== null) return;
      item.readAt = new Date().toISOString();
      state.unreadCount = Math.max(0, state.unreadCount - 1);
    },
    allNotificationsRead(state) {
      const now = new Date().toISOString();
      for (const item of state.items) {
        if (item.readAt === null) item.readAt = now;
      }
      state.unreadCount = 0;
    },
    /** Logout / session expiry — the slice dies with the session (§9 edge 50). */
    clearNotifications(state) {
      state.status = 'unknown';
      state.items = [];
      state.unreadCount = 0;
      state.nextCursor = null;
      state.loadingMore = false;
      state.error = [];
    },
  },
});

export const {
  fetchStarted,
  fetchSucceeded,
  fetchFailed,
  notificationReceived,
  loadMoreStarted,
  loadMoreSucceeded,
  loadMoreFailed,
  notificationRead,
  allNotificationsRead,
  clearNotifications,
} = notificationsSlice.actions;

const endSession = (dispatch: AppDispatch): void => {
  dispatch(clearNotifications());
  dispatch(setAnonymous());
};

const toMessages = (error: unknown): string[] =>
  error instanceof ApiError
    ? error.messages
    : ["Can't reach the server. Please try again shortly."];

/**
 * First-page fetch — the REST source of truth. Runs from `unknown`/`error`
 * and again on every SSE reconnect (the stream module dispatches it to
 * reconcile events missed while disconnected). A 401 is a definitive
 * session verdict; anything else keeps the panel open with a retry.
 */
export function fetchNotifications() {
  return async (
    dispatch: AppDispatch,
    getState: () => RootState,
  ): Promise<void> => {
    if (getState().notifications.status === 'loading') return;
    dispatch(fetchStarted());
    try {
      const page = await listNotifications();
      if (getState().auth.status !== 'authenticated') {
        dispatch(clearNotifications());
        return;
      }
      dispatch(fetchSucceeded(page));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        endSession(dispatch);
        return;
      }
      dispatch(fetchFailed(toMessages(error)));
    }
  };
}

/** Older page behind `nextCursor`. Rethrows for the panel to surface inline. */
export function loadMoreNotifications() {
  return async (
    dispatch: AppDispatch,
    getState: () => RootState,
  ): Promise<void> => {
    const { nextCursor, loadingMore, status } = getState().notifications;
    if (status !== 'ready' || nextCursor === null || loadingMore) return;
    dispatch(loadMoreStarted());
    try {
      const page = await listNotifications({ cursor: nextCursor });
      if (getState().auth.status !== 'authenticated') {
        dispatch(clearNotifications());
        return;
      }
      dispatch(loadMoreSucceeded(page));
    } catch (error) {
      dispatch(loadMoreFailed());
      if (error instanceof ApiError && error.status === 401) {
        endSession(dispatch);
        return;
      }
      throw error;
    }
  };
}

/** Mark one row read (no-op locally when already read). Rethrows failures. */
export function markRead(id: string) {
  return async (
    dispatch: AppDispatch,
    getState: () => RootState,
  ): Promise<void> => {
    const item = getState().notifications.items.find((row) => row.id === id);
    if (!item || item.readAt !== null) return;
    try {
      await markNotificationRead(id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        endSession(dispatch);
        return;
      }
      throw error;
    }
    if (getState().auth.status !== 'authenticated') return;
    dispatch(notificationRead(id));
  };
}

/** Mark every unread row read. Rethrows failures for the caller to toast. */
export function markAllRead() {
  return async (
    dispatch: AppDispatch,
    getState: () => RootState,
  ): Promise<void> => {
    if (getState().notifications.unreadCount === 0) return;
    try {
      await markAllNotificationsRead();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        endSession(dispatch);
        return;
      }
      throw error;
    }
    if (getState().auth.status !== 'authenticated') return;
    dispatch(allNotificationsRead());
  };
}

export default notificationsSlice.reducer;
