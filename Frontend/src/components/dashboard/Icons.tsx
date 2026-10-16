import type { ReactNode } from 'react';

const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    className="h-[18px] w-[18px] shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="square"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export function OrgIcon() {
  return (
    <Icon>
      <path d="M4 21V4h10v17M14 9h6v12M3 21h18M8 8h2M8 12h2M8 16h2" />
    </Icon>
  );
}

export function ProjectsIcon() {
  return (
    <Icon>
      <path d="M3 5h7l2 2h9v13H3z" />
    </Icon>
  );
}

export function TasksIcon() {
  return (
    <Icon>
      <path d="M4 4h16v16H4zM8 12l3 3 5-6" />
    </Icon>
  );
}

export function ProfileIcon() {
  return (
    <Icon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
    </Icon>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-4 w-4 shrink-0'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="m4 13 5 5L20 6" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-4 w-4 shrink-0'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="m5 9 7 7 7-7" />
    </svg>
  );
}

export function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-4 w-4 shrink-0'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="M12 3L2 21h20L12 3zM12 10v5M12 18v.5" />
    </svg>
  );
}

/** Envelope for the "ask your Admin to add you" card. */
export function MailIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-6 w-6 shrink-0'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="M4 7h16v12H4zM4 7l8 6 8-6" />
    </svg>
  );
}

/** Padlock for nav items that need an organization first. */
export function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-3.5 w-3.5'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="square"
      aria-hidden="true"
    >
      <path d="M6 11h12v9H6zM9 11V7a3 3 0 016 0v4" />
    </svg>
  );
}

export function NexusLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-6 w-6'}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 8.5v3.5M12 12l-5.5 4M12 12l5.5 4"
        stroke="#1F2FE0"
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <circle
        cx="12"
        cy="6"
        r="3.5"
        fill="#FFD83D"
        stroke="#1F2FE0"
        strokeWidth={1.8}
      />
      <circle cx="5.5" cy="17.5" r="2.5" fill="#1F2FE0" />
      <circle cx="18.5" cy="17.5" r="2.5" fill="#1F2FE0" />
    </svg>
  );
}
