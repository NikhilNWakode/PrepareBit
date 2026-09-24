/**
 * The contract surface shared by the API and the web client.
 *
 * Nothing else belongs in this package: no helpers, no utilities, no logic that
 * only one side needs.
 */

export * from './kit.schema.js';

/**
 * Every error code the API is allowed to return. Fixed up front so the HTTP
 * layer and the web client cannot drift apart on spelling, and so a client can
 * branch on a code rather than parsing a message.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'KIT_NOT_FOUND',
  'INVALID_URL',
  'COMPANY_UNREACHABLE',
  'ROBOTS_BLOCKED',
  'LLM_RATE_LIMITED',
  'LLM_INVALID_RESPONSE',
  'KIT_VALIDATION_FAILED',
  'GENERATION_FAILED',
  /** The kit changed since the client last read it, or is busy generating. */
  'CONFLICT',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** The single error envelope every failing API response uses. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
  };
}

/** The authenticated user as the API represents it to the client. */
export interface AuthUser {
  id: string;
  email: string;
}

/** Body accepted by POST /api/auth/register and POST /api/auth/login. */
export interface CredentialsBody {
  email: string;
  password: string;
}

/** Body returned by register, login and GET /api/auth/me. */
export interface AuthUserResponse {
  user: AuthUser;
}
