import type { MemberListItem, Role } from '@/lib/api';

export type RoleKey = 'pm' | 'admin' | 'dev' | 'hr';

/** Session role from the auth store ('PM' | 'Dev' | 'Admin' | 'HR') → dashboard key. */
export const toRoleKey = (role: Role): RoleKey => role.toLowerCase() as RoleKey;

/** Dashboard role key → API role (invite payloads, role-change PATCH). */
export const toApiRole = (key: RoleKey): Role => key.toUpperCase() as Role;

export const ROLES: Record<
  RoleKey,
  { label: string; cls: string; desc: string }
> = {
  pm: {
    label: 'PM',
    cls: 'bg-cobalt text-white',
    desc: 'Creates and manages projects and its members.',
  },
  admin: {
    label: 'Admin',
    cls: 'bg-sun text-ink',
    desc: 'Creates, edits and deletes the organization.',
  },
  hr: {
    label: 'HR',
    cls: 'bg-mist text-ink',
    desc: 'Handles people operations and member invitations.',
  },
  dev: {
    label: 'Dev',
    cls: 'border border-ink text-ink',
    desc: "Works on tasks in the projects they're added to.",
  },
};

export const ROLE_ORDER: RoleKey[] = ['pm', 'hr', 'dev', 'admin'];

/**
 * Client mirror of the server's membership matrix (backend
 * `members.policy.ts`) — the UI hides what the API would 403. The server
 * stays the authority; this only shapes which controls render.
 */
export const canInviteRole = (actor: RoleKey, role: RoleKey): boolean => {
  switch (actor) {
    case 'admin':
      return true;
    case 'hr':
      return role === 'pm' || role === 'dev' || role === 'hr';
    case 'pm':
      return role === 'pm' || role === 'dev';
    default:
      return false;
  }
};

/** Role-change and removal — same rules; checked against the target's current role. */
export const canManageMember = (actor: RoleKey, target: RoleKey): boolean => {
  switch (actor) {
    case 'admin':
      return true;
    case 'hr':
      return target === 'pm' || target === 'dev';
    case 'pm':
      return target === 'dev';
    default:
      return false;
  }
};

/** Roles the actor may put in an invite (drives the picker's options). */
export const invitableRoles = (actor: RoleKey): RoleKey[] =>
  ROLE_ORDER.filter((role) => canInviteRole(actor, role));

/** Plain-language summary of the actor's own access — rendered under "People". */
export const accessSummary = (actor: RoleKey): string => {
  switch (actor) {
    case 'admin':
      return 'You can invite anyone and manage every member.';
    case 'hr':
      return 'You can invite PM, Dev and HR members — and manage PM and Dev members.';
    case 'pm':
      return 'You can invite PM and Dev members — and manage Dev members.';
    default:
      return '';
  }
};

export interface Member {
  name: string;
  email: string;
  role: RoleKey;
  invited?: boolean;
}

/** API roster row → the dashboard's display shape (name falls back to local-part). */
export const displayMember = (row: MemberListItem): Member => ({
  name: row.name ?? row.email.split('@')[0] ?? row.email,
  email: row.email,
  role: toRoleKey(row.role),
  invited: row.status === 'INVITED',
});

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
}

/**
 * Demo team data — members have no backend yet. The real organization
 * lives in the Redux `org` slice and real projects in the `projects`
 * slice (both fetched from the API).
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
