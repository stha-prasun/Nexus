import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { ApiError, listMembers, type MemberListItem } from '@/lib/api';
import type { AppDispatch, RootState } from '@/store';
import { setAnonymous } from '@/store/slices/authSlice';
import { clearOrg } from '@/store/slices/orgSlice';

export interface MembersState {
  /** `unknown` until the first GET; `error` keeps the list empty + offers retry. */
  status: 'unknown' | 'loading' | 'ready' | 'error';
  members: MemberListItem[];
  error: string[];
}

const initialState: MembersState = {
  status: 'unknown',
  members: [],
  error: [],
};

const membersSlice = createSlice({
  name: 'members',
  initialState,
  reducers: {
    fetchStarted(state) {
      state.status = 'loading';
      state.error = [];
    },
    fetchSucceeded(state, action: PayloadAction<MemberListItem[]>) {
      state.status = 'ready';
      state.members = action.payload;
      state.error = [];
    },
    fetchFailed(state, action: PayloadAction<string[]>) {
      state.status = 'error';
      state.members = [];
      state.error = action.payload;
    },
    /** On logout, org deletion, or accepting an invite — refetch from scratch. */
    clearMembers(state) {
      state.status = 'unknown';
      state.members = [];
      state.error = [];
    },
  },
});

export const { fetchStarted, fetchSucceeded, fetchFailed, clearMembers } =
  membersSlice.actions;

const endSession = (dispatch: AppDispatch): void => {
  dispatch(clearMembers());
  dispatch(clearOrg());
  dispatch(setAnonymous());
};

/**
 * Cached roster fetch — runs only from `unknown`/`error`, and only while an
 * organization is loaded (an invitee without a membership sees `org: null`
 * and never hits the 403). A 401 is a definitive session verdict; anything
 * else keeps the user signed in and shows a retry.
 */
export function fetchMembers() {
  return async (
    dispatch: AppDispatch,
    getState: () => RootState,
  ): Promise<void> => {
    const { status } = getState().members;
    if (status === 'loading' || status === 'ready') return;
    // No organization yet (or not a member) — nothing to list; stays `unknown`
    // so the effect refires the moment an org appears (e.g. after create/accept).
    if (getState().org.org === null) return;
    dispatch(fetchStarted());
    try {
      const { members } = await listMembers();
      if (getState().auth.status !== 'authenticated') {
        dispatch(clearMembers());
        return;
      }
      dispatch(fetchSucceeded(members));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        endSession(dispatch);
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
 * Always GETs fresh (used after every mutation). Resolves to the roster so
 * callers can toast; failures are rethrown for the caller to surface (a 401
 * still ends the session). Never touches `status`, so the list keeps
 * rendering while it revalidates — no flicker.
 */
export function refreshMembers() {
  return async (
    dispatch: AppDispatch,
    getState: () => RootState,
  ): Promise<MemberListItem[]> => {
    if (getState().org.org === null) return [];
    try {
      const { members } = await listMembers();
      if (getState().auth.status !== 'authenticated') {
        dispatch(clearMembers());
        return [];
      }
      dispatch(fetchSucceeded(members));
      return members;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        endSession(dispatch);
        return [];
      }
      throw error;
    }
  };
}

export default membersSlice.reducer;
