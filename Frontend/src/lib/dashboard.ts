import type { Role } from '@/lib/api';

export type RoleKey = 'pm' | 'admin' | 'dev';

/** Sign-up role from the auth store ('PM' | 'Dev' | 'Admin') → dashboard key. */
export const toRoleKey = (role: Role): RoleKey => role.toLowerCase() as RoleKey;

export const ROLES: Record<
  RoleKey,
  { label: string; cls: string; dot: string; desc: string }
> = {
  pm: {
    label: 'PM',
    cls: 'bg-cobalt text-white',
    dot: 'bg-cobalt',
    desc: 'Creates and manages projects, the organization and its members.',
  },
  admin: {
    label: 'Admin',
    cls: 'bg-sun text-ink',
    dot: 'bg-sun',
    desc: 'Can oversee any project in the organization.',
  },
  dev: {
    label: 'Dev',
    cls: 'border border-ink text-ink',
    dot: 'bg-ink',
    desc: "Works on tasks in the projects they're added to.",
  },
};

export const ROLE_ORDER: RoleKey[] = ['pm', 'admin', 'dev'];

export interface Member {
  name: string;
  email: string;
  role: RoleKey;
  invited?: boolean;
}

export interface Project {
  name: string;
  color: string;
  people: number[];
}

export interface Org {
  name: string;
  slug: string;
}

/** Demo identity — stands in for the signed-in user until the auth pass lands. */
export const CURRENT_USER: Member = {
  name: 'Maya Kim',
  email: 'maya@acme.com',
  role: 'pm',
};

export interface DashboardState {
  viewAs: RoleKey;
  members: Member[];
  projects: Project[];
}

/**
 * Demo team data — members/projects have no backend yet. The real
 * organization lives in the Redux `org` slice (fetched from the API).
 */
export const createDemoState = (): DashboardState => ({
  viewAs: 'pm',
  members: [
    { ...CURRENT_USER },
    { name: 'Jonas Weber', email: 'jonas@acme.com', role: 'admin' },
    { name: 'Priya Patel', email: 'priya@acme.com', role: 'dev' },
    { name: 'Lena Wu', email: 'lena@acme.com', role: 'dev' },
    { name: 'Rahul', email: 'rahul@acme.com', role: 'dev', invited: true },
  ],
  projects: [
    { name: 'Website relaunch', color: '#1F2FE0', people: [0, 1, 2, 3] },
    { name: 'Mobile app', color: '#2FB67C', people: [0, 2, 3] },
  ],
});

const TINTS = ['#DDE2FF', '#FFE79A', '#C9F0DE', '#FAD4D4', '#E0D8FA'];

export const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

export const tint = (seed: string): string => {
  const sum = [...seed].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return TINTS[sum % TINTS.length] as string;
};

export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export const INPUT =
  'w-full border border-ink/40 bg-white px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-soft/60 outline-none transition focus:border-cobalt focus:ring-2 focus:ring-cobalt/25';

export const BTN =
  'bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt-dark';

export const BTN_LINE =
  'border border-ink px-4 py-2 text-sm font-semibold hover:bg-ink hover:text-white';

/** Stub copy for logging out ANOTHER device — needs the session-list API. */
export const SESSION_LOGOUT_STUB_TOAST =
  'Logging out that device connects with the auth API — coming in the auth pass.';

export interface SessionInfo {
  id: string;
  device: string;
  browser: string;
  location: string;
  signedInAt: string;
  lastActive: string;
  online: boolean;
  current: boolean;
}

/** Demo sign-in history until the auth pass serves real sessions. */
export const SESSIONS: SessionInfo[] = [
  {
    id: 'this-device',
    device: 'Windows PC',
    browser: 'Chrome on Windows',
    location: 'Kathmandu, Nepal',
    signedInAt: 'Today, 9:04 AM',
    lastActive: 'Active now',
    online: true,
    current: true,
  },
  {
    id: 'iphone',
    device: 'iPhone 15',
    browser: 'Safari on iOS',
    location: 'Pokhara, Nepal',
    signedInAt: 'Oct 11, 8:12 PM',
    lastActive: '2 hours ago',
    online: false,
    current: false,
  },
  {
    id: 'macbook',
    device: 'MacBook Air',
    browser: 'Chrome on macOS',
    location: 'Kathmandu, Nepal',
    signedInAt: 'Oct 9, 10:45 AM',
    lastActive: 'Yesterday, 6:30 PM',
    online: false,
    current: false,
  },
  {
    id: 'galaxy',
    device: 'Galaxy S23',
    browser: 'Chrome on Android',
    location: 'Lalitpur, Nepal',
    signedInAt: 'Oct 2, 7:55 PM',
    lastActive: '6 days ago',
    online: false,
    current: false,
  },
];
