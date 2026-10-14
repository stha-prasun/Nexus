const BASE_URL: string =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export type Role = 'PM' | 'Dev' | 'Admin';

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  role: Role;
}

export interface RegisterResponse {
  message: string;
}

/**
 * Non-2xx response from the API. `messages` always holds at least one
 * human-readable line (Nest sends validation errors as string[]).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly messages: string[];

  constructor(status: number, messages: string[]) {
    super(messages.join(' '));
    this.name = 'ApiError';
    this.status = status;
    this.messages = messages;
  }
}

const parseError = async (response: Response): Promise<ApiError> => {
  let messages: string[] = ['Something went wrong. Please try again.'];
  try {
    const body = (await response.json()) as {
      message?: string | string[];
    };
    if (Array.isArray(body.message) && body.message.length > 0) {
      messages = body.message;
    } else if (typeof body.message === 'string' && body.message) {
      messages = [body.message];
    }
  } catch {
    // Non-JSON error body — keep the generic fallback.
  }
  return new ApiError(response.status, messages);
};

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // fetch rejects on network failure — surface as status 0.
    throw new ApiError(0, [
      "Can't reach the server. Please try again shortly.",
    ]);
  }

  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as T;
}

export function register(payload: RegisterPayload): Promise<RegisterResponse> {
  return apiPost<RegisterResponse>('/auth/register', payload);
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
    response = await fetch(
      `${BASE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`,
      { credentials: 'include' },
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
