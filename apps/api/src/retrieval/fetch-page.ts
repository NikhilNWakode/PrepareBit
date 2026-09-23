import { assertPublicUrl, isSameRegistrableDomain, parseFetchableUrl } from './url-guard.js';

/**
 * Fetches one document defensively.
 *
 * Returns a result rather than throwing for an expected failure: "skip and
 * report a source that cannot be retrieved, rather than failing the whole run"
 * is a requirement, and a discriminated result makes that path impossible to
 * forget at a call site.
 */

export const USER_AGENT =
  'InterviewPrepKitBot/1.0 (+https://github.com/NikhilNWakode/PrepareBit; research crawler)';

export const REQUEST_TIMEOUT_MS = 8_000;
export const MAX_RESPONSE_BYTES = 1_500_000;
export const MAX_REDIRECTS = 3;

const ALLOWED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];

export interface FetchedPage {
  url: string;
  html: string;
  contentType: string;
}

export type FetchFailureReason =
  | 'blocked-url'
  | 'too-many-redirects'
  | 'http-error'
  | 'unsupported-content-type'
  | 'too-large'
  | 'timeout'
  | 'network-error';

export type FetchResult =
  | { ok: true; page: FetchedPage }
  | { ok: false; url: string; reason: FetchFailureReason; detail: string };

export interface FetchOptions {
  /** When set, every redirect hop must stay inside this URL's registrable domain. */
  confineToDomainOf?: URL;
  signal?: AbortSignal;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Reads the body with a hard byte ceiling, because Content-Length is a claim, not a promise. */
async function readCapped(response: Response): Promise<{ text: string } | { tooLarge: true }> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return { tooLarge: true };

  const reader = response.body?.getReader();
  if (!reader) return { text: '' };

  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }

  return { text: new TextDecoder('utf-8').decode(Buffer.concat(chunks)) };
}

async function fetchOnce(url: URL, options: FetchOptions): Promise<FetchResult> {
  let current = url;

  // Redirects are followed by hand so each hop can be revalidated. A public URL
  // that 302s to 169.254.169.254 defeats a check done only on the input, and a
  // redirect off the company's domain would silently widen the crawl.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;

    try {
      response = await fetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,text/plain' },
        signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && /abort|timeout/i.test(error.name + error.message);
      return {
        ok: false,
        url: current.href,
        reason: timedOut ? 'timeout' : 'network-error',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        return {
          ok: false,
          url: current.href,
          reason: 'http-error',
          detail: 'redirect without location',
        };
      }

      const parsed = parseFetchableUrl(location, current.href);
      if (!parsed.ok) {
        return { ok: false, url: current.href, reason: 'blocked-url', detail: parsed.reason };
      }

      const addressCheck = await assertPublicUrl(parsed.url);
      if (!addressCheck.ok) {
        return {
          ok: false,
          url: parsed.url.href,
          reason: 'blocked-url',
          detail: addressCheck.reason,
        };
      }

      if (
        options.confineToDomainOf &&
        !isSameRegistrableDomain(parsed.url, options.confineToDomainOf)
      ) {
        return {
          ok: false,
          url: parsed.url.href,
          reason: 'blocked-url',
          detail: 'off-domain redirect',
        };
      }

      current = parsed.url;
      continue;
    }

    if (!response.ok) {
      return {
        ok: false,
        url: current.href,
        reason: 'http-error',
        detail: `HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!ALLOWED_CONTENT_TYPES.some((allowed) => contentType.includes(allowed))) {
      return {
        ok: false,
        url: current.href,
        reason: 'unsupported-content-type',
        detail: contentType || 'unknown',
      };
    }

    const body = await readCapped(response);
    if ('tooLarge' in body) {
      return {
        ok: false,
        url: current.href,
        reason: 'too-large',
        detail: `> ${MAX_RESPONSE_BYTES} bytes`,
      };
    }

    return { ok: true, page: { url: current.href, html: body.text, contentType } };
  }

  return {
    ok: false,
    url: current.href,
    reason: 'too-many-redirects',
    detail: `> ${MAX_REDIRECTS}`,
  };
}

/** Retried once: a 5xx or a dropped connection may be transient, a 404 never is. */
function isWorthRetrying(result: FetchResult): boolean {
  if (result.ok) return false;
  if (result.reason === 'network-error' || result.reason === 'timeout') return true;
  return result.reason === 'http-error' && /HTTP 5\d\d/.test(result.detail);
}

export async function fetchPage(url: URL, options: FetchOptions = {}): Promise<FetchResult> {
  const first = await fetchOnce(url, options);
  if (!isWorthRetrying(first)) return first;

  // Backoff with jitter so a struggling server is not hit again immediately.
  const delay = 400 + Math.floor(Math.random() * 300);
  await new Promise((resolve) => setTimeout(resolve, delay));

  return fetchOnce(url, options);
}
