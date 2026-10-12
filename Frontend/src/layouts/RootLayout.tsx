import { NavLink, Outlet } from 'react-router';

export function RootLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
          <NavLink to="/" className="text-sm font-semibold text-foreground">
            Nexus
          </NavLink>
          <nav className="flex items-center gap-4">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `text-sm transition-colors ${
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`
              }
            >
              Home
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-4 text-sm text-muted-foreground">
          Nexus
        </div>
      </footer>
    </div>
  );
}
