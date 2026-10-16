import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { Organization } from '@/lib/api';
import type { AppDispatch, RootState } from '@/store';
import {
  fetchOrganization,
  refreshOrganization,
} from '@/store/slices/orgSlice';

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

/**
 * The cached organization: fetches on first use (or after a failure),
 * never re-fetches while it's loaded — so moving between dashboard and
 * profile stays on Redux and makes no API calls.
 */
export function useOrganization() {
  const dispatch = useAppDispatch();
  const org = useAppSelector((state) => state.org.org);
  const status = useAppSelector((state) => state.org.status);
  const error = useAppSelector((state) => state.org.error);

  useEffect(() => {
    if (status === 'unknown') void dispatch(fetchOrganization());
  }, [dispatch, status]);

  const retry = (): void => {
    void dispatch(fetchOrganization());
  };

  /** "Check again" — always GETs fresh; resolves to the (possibly null) org. */
  const refresh = (): Promise<Organization | null> =>
    dispatch(refreshOrganization());

  return { org, status, error, retry, refresh };
}
