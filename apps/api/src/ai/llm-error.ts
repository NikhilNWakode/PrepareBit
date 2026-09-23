/**
 * Why a model call failed, and whether trying again could possibly help.
 *
 * Retrying the wrong thing is how a free-tier budget disappears: the daily cap
 * is 1,000 requests per model, so three attempts at a request that can never
 * succeed is three requests wasted.
 */
export type LlmFailureKind =
  | 'RATE_LIMITED'
  | 'TRANSIENT_PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'INVALID_REQUEST'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_MODEL_RESPONSE'
  | 'UNSUPPORTED_CAPABILITY';

const RETRYABLE: ReadonlySet<LlmFailureKind> = new Set<LlmFailureKind>([
  'RATE_LIMITED',
  'TRANSIENT_PROVIDER_ERROR',
  'TIMEOUT',
]);

export class LlmError extends Error {
  readonly kind: LlmFailureKind;
  readonly status: number | undefined;
  /** Present when the provider told us exactly how long to wait. */
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: LlmFailureKind,
    message: string,
    options: { status?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}

export function classifyStatus(status: number): LlmFailureKind {
  if (status === 429) return 'RATE_LIMITED';
  if (status === 408) return 'TIMEOUT';

  // A bad or revoked key will not fix itself, and each retry costs a request
  // against the daily cap.
  if (status === 401 || status === 403) return 'PROVIDER_UNAVAILABLE';

  // The same malformed request fails the same way every time.
  if (status >= 400 && status < 500) return 'INVALID_REQUEST';

  return 'TRANSIENT_PROVIDER_ERROR';
}

/**
 * `Retry-After` is either a number of seconds or an HTTP date. Both appear in
 * the wild, so both are handled; anything else is ignored in favour of the
 * caller's own backoff.
 */
export function parseRetryAfter(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!header) return undefined;

  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const at = Date.parse(header);
  if (Number.isNaN(at)) return undefined;

  return Math.max(0, at - now);
}
