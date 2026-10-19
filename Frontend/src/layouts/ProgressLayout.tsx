import { Outlet } from 'react-router';
import { TopLoadingBar } from '@/components/TopLoadingBar';

/**
 * Pathless parent of every route — exists so the top loading line can read
 * router state (useNavigation) on all pages, including ones that render no
 * shared chrome (login, dashboard, 404).
 */
export function ProgressLayout() {
  return (
    <>
      <TopLoadingBar />
      <Outlet />
    </>
  );
}
