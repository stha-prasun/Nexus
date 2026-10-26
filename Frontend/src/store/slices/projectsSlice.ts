import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { ApiError, listProjects, type Project } from '@/lib/api';
import type { AppDispatch, RootState } from '@/store';
import { setAnonymous } from '@/store/slices/authSlice';
import { clearMembers } from '@/store/slices/membersSlice';
import { clearOrg } from '@/store/slices/orgSlice';

export interface ProjectsState {
  /** `unknown` until the first GET; `error` keeps the list empty + offers retry. */
  status: 'unknown' | 'loading' | 'ready' | 'error';
  projects: Project[];
  error: string[];
}

const initialState: ProjectsState = {
  status: 'unknown',
  projects: [],
  error: [],
};

const projectsSlice = createSlice({
  name: 'projects',
  initialState,
  reducers: {
    fetchStarted(state) {
      state.status = 'loading';
      state.error = [];
    },
    fetchSucceeded(state, action: PayloadAction<Project[]>) {
      state.status = 'ready';
      state.projects = action.payload;
      state.error = [];
    },
    fetchFailed(state, action: PayloadAction<string[]>) {
      state.status = 'error';
      state.projects = [];
      state.error = action.payload;
    },
    /** Mutation responses carry the full project — sync the list without a refetch. */
    upsertProject(state, action: PayloadAction<Project>) {
      const index = state.projects.findIndex(
        (project) => project.id === action.payload.id,
      );
      if (index === -1) {
        state.projects.push(action.payload);
      } else {
        state.projects[index] = action.payload;
      }
    },
    removeProject(state, action: PayloadAction<string>) {
      state.projects = state.projects.filter(
        (project) => project.id !== action.payload,
      );
    },
    /** On logout, org deletion, or accepting an invite — refetch from scratch. */
    clearProjects(state) {
      state.status = 'unknown';
      state.projects = [];
      state.error = [];
    },
  },
});

export const {
  fetchStarted,
  fetchSucceeded,
  fetchFailed,
  upsertProject,
  removeProject,
  clearProjects,
} = projectsSlice.actions;

const endSession = (dispatch: AppDispatch): void => {
  dispatch(clearProjects());
  dispatch(clearMembers());
  dispatch(clearOrg());
  dispatch(setAnonymous());
};

/**
 * Cached project list — runs only from `unknown`/`error`, and only while an
 * organization is loaded (no org → no projects; stays `unknown` so the effect
 * refires the moment an org appears). A 401 is a definitive session verdict;
 * anything else keeps the user signed in and shows a retry.
 */
export function fetchProjects() {
  return async (
    dispatch: AppDispatch,
    getState: () => RootState,
  ): Promise<void> => {
    const { status } = getState().projects;
    if (status === 'loading' || status === 'ready') return;
    if (getState().org.org === null) return;
    dispatch(fetchStarted());
    try {
      const { projects } = await listProjects();
      if (getState().auth.status !== 'authenticated') {
        dispatch(clearProjects());
        return;
      }
      dispatch(fetchSucceeded(projects));
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
 * Always GETs fresh (used when the list must reflect external changes).
 * Resolves to the projects so callers can toast; failures are rethrown for
 * the caller to surface (a 401 still ends the session). Never touches
 * `status`, so the list keeps rendering while it revalidates — no flicker.
 */
export function refreshProjects() {
  return async (
    dispatch: AppDispatch,
    getState: () => RootState,
  ): Promise<Project[]> => {
    if (getState().org.org === null) return [];
    try {
      const { projects } = await listProjects();
      if (getState().auth.status !== 'authenticated') {
        dispatch(clearProjects());
        return [];
      }
      dispatch(fetchSucceeded(projects));
      return projects;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        endSession(dispatch);
        return [];
      }
      throw error;
    }
  };
}

export default projectsSlice.reducer;
