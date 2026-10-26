import { trackRequest } from '@/lib/progress';

const BASE_URL: string =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export type Role = 'PM' | 'Dev' | 'Admin' | 'HR';

/** Registration grants no role (the factory persists the default) — §members 5.4. */
export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface RegisterResponse {
  message: string;
}

/**
 * Non-2xx response from the API. `messages` always holds at least one
 * human-readable line (Nest sends validation errors as string[]). `code` is
 * the app-level discriminator when the body carries one (`{ status: "…",
 * message }` — e.g. invite_email_mismatch vs email_unverified).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly messages: string[];
  readonly code: string | undefined;

  constructor(status: number, messages: string[], code?: string) {
    super(messages.join(' '));
    this.name = 'ApiError';
    this.status = status;
    this.messages = messages;
    this.code = code;
  }
}

const parseError = async (response: Response): Promise<ApiError> => {
  let messages: string[] = ['Something went wrong. Please try again.'];
  let code: string | undefined;
  try {
    const body = (await response.json()) as {
      message?: string | string[];
      status?: unknown;
    };
    if (Array.isArray(body.message) && body.message.length > 0) {
      messages = body.message;
    } else if (typeof body.message === 'string' && body.message) {
      messages = [body.message];
    }
    if (typeof body.status === 'string' && body.status) {
      code = body.status;
    }
  } catch {
    // Non-JSON error body — keep the generic fallback.
  }
  return new ApiError(response.status, messages, code);
};

async function apiRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await trackRequest(
      fetch(`${BASE_URL}${path}`, {
        method,
        credentials: 'include',
        ...(body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
      }),
    );
  } catch {
    // fetch rejects on network failure — surface as status 0.
    throw new ApiError(0, [
      "Can't reach the server. Please try again shortly.",
    ]);
  }

  if (!response.ok) {
    throw await parseError(response);
  }
  // 204 No Content (DELETE) has no body to parse.
  const text = await response.text();
  if (text === '') return undefined as unknown as T;
  return JSON.parse(text) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, 'POST', body);
}

export function register(payload: RegisterPayload): Promise<RegisterResponse> {
  return apiPost<RegisterResponse>('/auth/register', payload);
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface LoginPayload {
  email: string;
  password: string;
  remember?: boolean;
}

export interface LoginResponse {
  user: User;
}

/** Sets the httpOnly `nexus_sid` cookie (24h, 7d when remember is true). */
export function login(payload: LoginPayload): Promise<LoginResponse> {
  return apiPost<LoginResponse>('/auth/login', payload);
}

export interface LogoutResponse {
  message: string;
  /** Live sessions actually destroyed — 0 also means "already logged out". */
  revoked: number;
}

/** This device by default; `{ allDevices: true }` revokes every session. */
export function logout(
  options: { allDevices?: boolean } = {},
): Promise<LogoutResponse> {
  return apiPost<LogoutResponse>('/auth/logout', options);
}

/**
 * Three-way session probe for bootstrap:
 * - `ok`        — 200, the server vouched for the cookie;
 * - `anonymous` — 401, definitive: the session is gone;
 * - `unreachable` — network error, 5xx or timeout: NOT a verdict on the
 *   session, so the client must not sign the user out.
 */
export type MeResult =
  | { kind: 'ok'; user: User }
  | { kind: 'anonymous' }
  | { kind: 'unreachable' };

/** A hung /me must never leave an infinite spinner. */
const ME_TIMEOUT_MS = 8000;

export async function me(): Promise<MeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ME_TIMEOUT_MS);

  let response: Response;
  try {
    response = await trackRequest(
      fetch(`${BASE_URL}/auth/me`, {
        credentials: 'include',
        signal: controller.signal,
      }),
    );
  } catch {
    // Network failure or our own abort — both are "unreachable".
    return { kind: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    try {
      const body = (await response.json()) as { user?: User };
      if (body.user) return { kind: 'ok', user: body.user };
    } catch {
      // Non-JSON 200 — treat as unreachable rather than invent a verdict.
    }
    return { kind: 'unreachable' };
  }
  return response.status === 401
    ? { kind: 'anonymous' }
    : { kind: 'unreachable' };
}

export interface ResendConfirmationResponse {
  message: string;
}

/**
 * Ask the backend to issue a fresh confirmation link and email it again.
 * The server always answers 202 with the same body (regardless of whether
 * the account exists / is unverified) so callers can't probe for emails.
 */
export function resendConfirmation(
  email: string,
): Promise<ResendConfirmationResponse> {
  return apiPost<ResendConfirmationResponse>('/auth/resend-confirmation', {
    email,
  });
}

export interface VerifyEmailResponse {
  status: 'verified' | 'invalid_or_expired';
}

/**
 * GET the verify endpoint. Unlike other routes, HTTP 400 is a *valid*
 * answer here — the body carries `status` (invalid_or_expired), so it is
 * parsed directly instead of via ApiError.
 */
export async function verifyEmail(token: string): Promise<VerifyEmailResponse> {
  let response: Response;
  try {
    response = await trackRequest(
      fetch(
        `${BASE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`,
        { credentials: 'include' },
      ),
    );
  } catch {
    throw new ApiError(0, [
      "Can't reach the server. Please try again shortly.",
    ]);
  }

  try {
    const body = (await response.json()) as { status?: string };
    if (
      (response.ok || response.status === 400) &&
      (body.status === 'verified' || body.status === 'invalid_or_expired')
    ) {
      return { status: body.status };
    }
  } catch {
    // Non-JSON body — fall through to the generic error.
  }
  throw new ApiError(response.status, [
    'Something went wrong. Please try again.',
  ]);
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  /** User id of the Admin who created the organization (records provenance only — grants no rights). */
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The singleton organization, or null when none exists yet — null is a
 * valid answer (200), not an error. Same `{status, message}` error bodies
 * as auth for 401/403/404/409, surfaced through ApiError.
 */
export async function getOrganization(): Promise<Organization | null> {
  const body = await apiRequest<{ organization: Organization | null }>(
    '/organization',
    'GET',
  );
  return body.organization;
}

export function createOrganization(payload: {
  name: string;
  slug: string;
}): Promise<Organization> {
  return apiRequest<Organization>('/organization', 'POST', payload);
}

export function updateOrganization(payload: {
  name?: string;
  slug?: string;
}): Promise<Organization> {
  return apiRequest<Organization>('/organization', 'PATCH', payload);
}

/** 204 No Content — resolves once the singleton row is gone. */
export function deleteOrganization(): Promise<void> {
  return apiRequest<void>('/organization', 'DELETE');
}

// ------------------------------------------------------------------ members

export type MemberStatus = 'INVITED' | 'ACTIVE';

/** One row of GET /members — membership/invitation, never the session user. */
export interface MemberListItem {
  /** Membership row id — the handle for role change / removal. */
  id: string;
  /** Account id for project-member routes; null while INVITED with no account yet. */
  userId: string | null;
  /** Null while INVITED with no account yet — the UI falls back to the email local-part. */
  name: string | null;
  email: string;
  role: Role;
  status: MemberStatus;
  invitedAt: string;
  acceptedAt: string | null;
  invitedBy: string | null;
}

/** Any ACTIVE member may read the roster (Dev included). */
export function listMembers(): Promise<{ members: MemberListItem[] }> {
  return apiRequest<{ members: MemberListItem[] }>('/members', 'GET');
}

/**
 * Invite by email (Admin/HR/PM per the §1.1 matrix). An INVITED row for the
 * same email merges (role updated, link reissued) — the server answers the
 * message for both paths.
 */
export function inviteMember(payload: {
  email: string;
  role: Role;
}): Promise<{ message: string }> {
  return apiRequest<{ message: string }>('/members/invites', 'POST', payload);
}

/** Regenerate + resend an INVITED row's link (lost mail / expired link). */
export function resendInvite(id: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/members/invites/${encodeURIComponent(id)}/resend`,
    'POST',
  );
}

export function changeMemberRole(
  id: string,
  role: Role,
): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/members/${encodeURIComponent(id)}/role`,
    'PATCH',
    { role },
  );
}

/** 200 { message } — ACTIVE removal also revokes that member's sessions. */
export function removeMember(id: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/members/${encodeURIComponent(id)}`,
    'DELETE',
  );
}

export interface InvitePreview {
  status: 'valid';
  email: string;
  orgName: string;
  role: Role;
  /** none — no account yet; unverified — never confirmed; verified — ready. */
  accountState: 'none' | 'unverified' | 'verified';
}

/** Public — the token IS the capability (404 { status } when dead). */
export function getInvitePreview(token: string): Promise<InvitePreview> {
  return apiRequest<InvitePreview>(
    `/members/invites/${encodeURIComponent(token)}`,
    'GET',
  );
}

/** Accept as the signed-in invitee (403 mismatch/unverified, 409 already). */
export function acceptInvite(token: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/members/invites/${encodeURIComponent(token)}/accept`,
    'POST',
  );
}

// ----------------------------------------------------------------- projects

/** One member row of a project — org role included for the table column. */
export interface ProjectMember {
  /** User id — the handle for lead toggle / removal routes. */
  userId: string;
  name: string;
  email: string;
  /** The member's organization role (users.role). */
  role: Role;
  /** Team-lead flag — a project always keeps ≥1 lead (server invariant). */
  isLead: boolean;
  addedAt: string;
}

/** Full API project shape — members render avatars and counts. */
export interface Project {
  id: string;
  name: string;
  color: string;
  /** Display credit only — the creator keeps no rights once removed. */
  createdByUserId: string;
  createdByName: string;
  /** Leads first, then insertion order. */
  members: ProjectMember[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectPayload {
  name: string;
  color?: string;
  /** Extra members beyond the creator (who is always added). */
  memberUserIds?: string[];
  /** Required, non-empty; each id must be a member (memberUserIds ∪ creator). */
  leadUserIds: string[];
}

/** Admin/HR → all projects; PM/Dev → only projects they belong to. */
export function listProjects(): Promise<{ projects: Project[] }> {
  return apiRequest<{ projects: Project[] }>('/projects', 'GET');
}

/** 404 project_not_found when missing or invisible (indistinguishable). */
export function getProject(id: string): Promise<{ project: Project }> {
  return apiRequest<{ project: Project }>(
    `/projects/${encodeURIComponent(id)}`,
    'GET',
  );
}

/** Admin/PM only — creator is auto-added; ≥1 explicit lead required. */
export function createProject(
  payload: CreateProjectPayload,
): Promise<{ project: Project }> {
  return apiRequest<{ project: Project }>('/projects', 'POST', payload);
}

export function updateProject(
  id: string,
  payload: { name?: string; color?: string },
): Promise<{ project: Project }> {
  return apiRequest<{ project: Project }>(
    `/projects/${encodeURIComponent(id)}`,
    'PATCH',
    payload,
  );
}

/** 200 { message } — memberships cascade with the project. */
export function deleteProject(id: string): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/projects/${encodeURIComponent(id)}`,
    'DELETE',
  );
}

/** Target must be an ACTIVE org member (HR forbidden), not already on it. */
export function addProjectMember(
  projectId: string,
  userId: string,
): Promise<{ project: Project }> {
  return apiRequest<{ project: Project }>(
    `/projects/${encodeURIComponent(projectId)}/members`,
    'POST',
    { userId },
  );
}

/**
 * Self-removal → 403 self_remove_forbidden; PM may remove Dev targets only;
 * last-lead removal → 403 last_lead_required.
 */
export function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<{ project: Project }> {
  return apiRequest<{ project: Project }>(
    `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    'DELETE',
  );
}

/** Demoting the last lead → 403 last_lead_required. */
export function setProjectLead(
  projectId: string,
  userId: string,
  isLead: boolean,
): Promise<{ project: Project }> {
  return apiRequest<{ project: Project }>(
    `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}/lead`,
    'PATCH',
    { isLead },
  );
}
