import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { ApiError, getOrganization, type Organization } from '@/lib/api';
import type { AppDispatch, RootState } from '@/store';
import { setAnonymous } from '@/store/slices/authSlice';

export interface OrgState {
  /** `unknown` until the first GET; `error` keeps `org` null and offers retry. */
  status: 'unknown' | 'loading' | 'ready' | 'error';
  org: Organization | null;
  error: string[];
}

const initialState: OrgState = { status: 'unknown', org: null, error: [] };

const orgSlice = createSlice({
  name: 'org',
  initialState,
  reducers: {
    fetchStarted(state) {
      state.status = 'loading';
      state.error = [];
    },
    fetchSucceeded(state, action: PayloadAction<Organization | null>) {
      state.status = 'ready';
      state.org = action.payload;
      state.error = [];
    },
    fetchFailed(state, action: PayloadAction<string[]>) {
      state.status = 'error';
      state.org = null;
      state.error = action.payload;
    },
    /** After POST/PATCH — the fresh organization becomes the cached truth. */
    setOrg(state, action: PayloadAction<Organization>) {
      state.status = 'ready';
      state.org = action.payload;
      state.error = [];
    },
    /** After DELETE (or a 404 race) — back to "no organization yet". */
    removeOrg(state) {
      state.status = 'ready';
      state.org = null;
      state.error = [];
    },
    /** On logout — wipe the cache so the next account refetches from scratch. */
    clearOrg(state) {
      state.status = 'unknown';
      state.org = null;
      state.error = [];
    },
  },
});

export const {
  fetchStarted,
  fetchSucceeded,
  fetchFailed,
  setOrg,
  removeOrg,
  clearOrg,
} = orgSlice.actions;

/**
 * Cached singleton fetch: runs only from `unknown`/`error` (never when
 * already loaded or in flight), so switching dashboard ↔ profile makes no
 * API calls. A 401 is a definitive session verdict (same as /me); anything
 * else keeps the user signed in and shows a retry. A sign-out while the
 * request is in flight discards the stale result.
 */
export function fetchOrganization() {
  return async (
    dispatch: AppDispatch,
    getState: () => RootState,
  ): Promise<void> => {
    const { status } = getState().org;
    if (status === 'loading' || status === 'ready') return;
    dispatch(fetchStarted());
    try {
      const organization = await getOrganization();
      if (getState().auth.status !== 'authenticated') {
        dispatch(clearOrg());
        return;
      }
      dispatch(fetchSucceeded(organization));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        dispatch(clearOrg());
        dispatch(setAnonymous());
        return;
      }
      dispatch(
        fetchFailed(
          error instanceof ApiError
            ? error.messages
            : ['Something went wrong. Please try again.'],
        ),
      );
    }
  };
}

/**
 * "Check again" refetch: always GETs fresh (unlike `fetchOrganization`,
 * which stays cached while `ready`). A successful result overwrites the
 * cache — if an organization now exists, `org` flips non-null and the
 * dashboard swaps to the org view on its own. Never touches `status`, so
 * the current view doesn't flash to the loading spinner; failures are
 * rethrown for the caller to surface (a 401 still ends the session).
 */
export function refreshOrganization() {
  return async (
    dispatch: AppDispatch,
    getState: () => RootState,
  ): Promise<Organization | null> => {
    if (getState().org.status === 'loading') return getState().org.org;
    try {
      const organization = await getOrganization();
      if (getState().auth.status !== 'authenticated') {
        dispatch(clearOrg());
        return null;
      }
      dispatch(fetchSucceeded(organization));
      return organization;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        dispatch(clearOrg());
        dispatch(setAnonymous());
        return null;
      }
      throw error;
    }
  };
}

export default orgSlice.reducer;
