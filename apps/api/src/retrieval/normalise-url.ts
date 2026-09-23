/**
 * Two URLs that fetch the same page must compare equal, or the crawler spends
 * its small page budget fetching one document several times.
 */
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|source$)/i;

export function normaliseUrl(url: URL): string {
  const normalised = new URL(url.href);

  normalised.hash = '';
  normalised.hostname = normalised.hostname.toLowerCase();
  normalised.protocol = normalised.protocol.toLowerCase();

  for (const key of [...normalised.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) normalised.searchParams.delete(key);
  }

  // Sorted so ?a=1&b=2 and ?b=2&a=1 are one URL.
  normalised.searchParams.sort();

  // "/about/" and "/about" are the same page; "/" is left alone.
  if (normalised.pathname.length > 1) {
    normalised.pathname = normalised.pathname.replace(/\/+$/, '');
  }

  // The default port is implied, so drop it.
  if (
    (normalised.protocol === 'http:' && normalised.port === '80') ||
    (normalised.protocol === 'https:' && normalised.port === '443')
  ) {
    normalised.port = '';
  }

  return normalised.href;
}
