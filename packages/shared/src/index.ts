/**
 * The contract surface shared by the API and the web client.
 *
 * Phase 3 adds the Appendix A kit schema and its inferred domain types here.
 * Nothing else belongs in this package: no helpers, no utilities, no logic that
 * only one side needs.
 */

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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** The single error envelope every failing API response uses. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
  };
}
