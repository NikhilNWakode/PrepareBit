import { createHash } from 'node:crypto';

/**
 * Identifies "the same request submitted twice" (brief §10) so a duplicate does
 * not start a second expensive generation run.
 *
 * Normalising first means cosmetic differences — a trailing newline pasted into
 * the textarea, HTTPS vs https, a trailing slash — do not produce a different
 * fingerprint. A different day count genuinely is a different kit, because the
 * schedule is built around it, so `days` is part of the hash.
 */
function normaliseJobDescription(jd: string): string {
  return jd.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normaliseUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.protocol = url.protocol.toLowerCase();

    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}${url.search}`;
  } catch {
    // Not parseable: fall back to the raw value rather than throwing. URL
    // validity is the retrieval layer's decision, not this function's.
    return rawUrl.trim().toLowerCase();
  }
}

export function fingerprintKitInput(jd: string, companyUrl: string, days: number): string {
  const canonical = [normaliseJobDescription(jd), normaliseUrl(companyUrl), String(days)].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}
