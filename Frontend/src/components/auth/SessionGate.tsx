import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
} from 'react';
import { me } from '@/lib/api';
import { useAppDispatch } from '@/store/hooks';
import {
  markLoading,
  setAnonymous,
  setBootstrapError,
  setUser,
} from '@/store/slices/authSlice';

const RetryContext = createContext<() => void>(() => {});

/** Re-runs the /me bootstrap (RequireAuth's Retry button). */
export const useRetrySession = (): (() => void) => useContext(RetryContext);

/**
 * Runs the session bootstrap exactly once per full page load: /me is the
 * only authority on whether the httpOnly cookie still opens a session.
 * Provides a retry that re-runs the same check after an unreachable result.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();

  const check = useCallback(() => {
    dispatch(markLoading());
    void me().then((result) => {
      if (result.kind === 'ok') {
        dispatch(setUser(result.user));
      } else if (result.kind === 'anonymous') {
        dispatch(setAnonymous());
      } else {
        // Not a verdict — keep the session unknown, offer a retry.
        dispatch(setBootstrapError(true));
      }
    });
  }, [dispatch]);

  useEffect(() => {
    check();
  }, [check]);

  return (
    <RetryContext.Provider value={check}>{children}</RetryContext.Provider>
  );
}
