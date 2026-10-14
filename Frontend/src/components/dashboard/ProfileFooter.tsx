import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router';
import { initials, tint } from '@/lib/dashboard';
import { ProfileIcon } from './Icons';

export interface ProfileFooterProps {
  name: string;
  email: string;
  roleLabel: string;
  onLogout: () => void;
}

/**
 * Sidebar footer identity block — opens a menu upward with
 * Profile (→ /profile) and Log out ("log out everywhere" lives on
 * the profile page itself).
 */
export function ProfileFooter({
  name,
  email,
  roleLabel,
  onLogout,
}: ProfileFooterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative border-t border-ink-line p-3.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 text-left"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center text-xs font-bold text-ink"
          style={{ background: tint(name) }}
        >
          {initials(name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">
            {name}
          </span>
          <span className="block truncate text-xs text-ink-soft">
            {roleLabel}
          </span>
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute bottom-full left-3 right-3 z-20 mb-2 border border-ink bg-white shadow-[6px_6px_0_#14183A]"
        >
          <div className="border-b border-ink-line px-3.5 py-2.5">
            <p className="truncate text-[15px] font-semibold">{name}</p>
            <p className="truncate text-xs text-ink-soft">{email}</p>
          </div>
          <NavLink
            to="/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-2.5 text-[15px] font-semibold hover:bg-paper ${
                isActive ? 'text-cobalt' : 'text-ink'
              }`
            }
          >
            <ProfileIcon />
            Profile
          </NavLink>
          <div className="border-t border-ink-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex w-full px-3.5 py-2.5 text-left text-[15px] font-semibold text-red-700 hover:bg-red-50"
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}
