import type { ApiErrorBody, ErrorCode } from '@prep/shared';

/**
 * A failure the API described deliberately, carrying the code the UI can branch
 * on. Anything the API did not shape this way surfaces as INTERNAL_ERROR.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as ApiErrorBody).error?.code === 'string'
  );
}

/**
 * The single door to the API. Every request is same-origin thanks to the
 * Next.js rewrite, and carries the session cookie.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    // A dead network or a sleeping free-tier backend, not an API response.
    throw new ApiError('INTERNAL_ERROR', 'Could not reach the server. Check your connection.', 0);
  }

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiError(body.error.code, body.error.message, response.status);
    }
    throw new ApiError('INTERNAL_ERROR', 'Something went wrong.', response.status);
  }

  return body as T;
}
