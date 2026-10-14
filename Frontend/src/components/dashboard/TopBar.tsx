import type { ReactNode } from 'react';

interface TopBarProps {
  crumb: ReactNode;
  menuOpen: boolean;
  onMenuToggle: () => void;
}

export function TopBar({ crumb, menuOpen, onMenuToggle }: TopBarProps) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <header className="flex h-14 items-center justify-between border-b border-ink-line px-4 sm:px-8">
      <button
        type="button"
        onClick={onMenuToggle}
        className="border border-ink px-3 py-1.5 text-sm font-semibold lg:hidden"
        aria-expanded={menuOpen}
        aria-controls="sidebar"
      >
        Menu
      </button>
      <p className="text-sm text-ink-soft">{crumb}</p>
      <span className="hidden text-sm text-ink-soft sm:block">{today}</span>
    </header>
  );
}
