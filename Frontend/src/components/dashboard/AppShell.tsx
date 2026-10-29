import { type ReactNode, useState } from 'react';
import type { Org } from '@/lib/dashboard';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface AppShellProps {
  org: Org | null;
  user: { name: string; email: string; roleLabel: string };
  crumb: ReactNode;
  onLogout: () => void;
  children: ReactNode;
  /** Board-style pages — drops the max-w-6xl reading measure. */
  wide?: boolean;
}

export function AppShell({
  org,
  user,
  crumb,
  onLogout,
  children,
  wide = false,
}: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="nx-dashboard flex min-h-screen bg-white font-sans text-ink antialiased">
      <Sidebar org={org} user={user} open={sidebarOpen} onLogout={onLogout} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          crumb={crumb}
          menuOpen={sidebarOpen}
          onMenuToggle={() => setSidebarOpen((value) => !value)}
        />
        <main
          className={
            wide
              ? 'w-full px-4 py-8 sm:px-8'
              : 'mx-auto w-full max-w-6xl px-4 py-8 sm:px-8'
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
