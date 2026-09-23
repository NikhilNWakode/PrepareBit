import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { getDomain } from 'tldts';

import { env } from '../config/env.js';

/**
 * The application fetches URLs that a user supplies and that crawled pages link
 * to. Without a fence that is a server-side request forgery primitive: an
 * attacker points it at an internal service and reads the response through us.
 *
 * `169.254.169.254` is the one that matters most — the cloud metadata endpoint,
 * which on many providers hands out credentials to anything that can reach it.
 *
 * Known limitation, and it is a real one: this resolves the hostname, and then
 * `fetch` resolves it again. A name that changes between the two calls slips
 * past — classic DNS-rebinding TOCTOU. Closing it means connecting to the
 * validated address with the hostname pinned for TLS, which Node's `fetch` does
 * not expose. Recorded in the README rather than papered over.
 */

export type UrlRejection =
  | 'malformed'
  | 'unsupported-protocol'
  | 'embedded-credentials'
  | 'unresolvable-host'
  | 'private-address'
  | 'off-domain';

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: UrlRejection; detail: string };

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** IPv4 ranges that must never be fetched from a server that accepts user input. */
function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  const [a = 0, b = 0] = parts;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved

  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalised = address.toLowerCase().split('%')[0] ?? '';

  if (normalised === '::' || normalised === '::1') return true; // unspecified, loopback

  // IPv4-mapped (::ffff:127.0.0.1) would otherwise bypass the v4 rules.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised);
  if (mapped?.[1]) return isBlockedIpv4(mapped[1]);

  if (/^f[cd]/.test(normalised)) return true; // fc00::/7 unique local
  if (/^fe[89ab]/.test(normalised)) return true; // fe80::/10 link-local
  if (normalised.startsWith('ff')) return true; // multicast

  return false;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true; // not an address we understand: refuse rather than guess
}

/**
 * Shape and protocol checks only — no DNS. Split out so the crawler can reject
 * obviously unusable links without paying for a lookup on every one.
 */
export function parseFetchableUrl(rawUrl: string, base?: string): UrlCheck {
  let url: URL;

  try {
    url = base ? new URL(rawUrl, base) : new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'malformed', detail: rawUrl };
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    return { ok: false, reason: 'unsupported-protocol', detail: url.protocol };
  }

  // `https://internal@evil.example` reads as a trusted host to a human.
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'embedded-credentials', detail: url.hostname };
  }

  return { ok: true, url };
}

/**
 * Resolves the host and rejects the URL if *any* returned address is blocked.
 * A name resolving to both a public and a private address is still a way in,
 * so one bad answer fails the whole check.
 */
export async function assertPublicUrl(url: URL): Promise<UrlCheck> {
  if (env.allowPrivateUrls) return { ok: true, url };

  const literal = isIP(url.hostname);
  if (literal !== 0) {
    return isBlockedAddress(url.hostname)
      ? { ok: false, reason: 'private-address', detail: url.hostname }
      : { ok: true, url };
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    return { ok: false, reason: 'unresolvable-host', detail: url.hostname };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: 'unresolvable-host', detail: url.hostname };
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      return { ok: false, reason: 'private-address', detail: `${url.hostname} -> ${address}` };
    }
  }

  return { ok: true, url };
}

/** Full check: shape, protocol, credentials, then address. */
export async function checkFetchableUrl(rawUrl: string, base?: string): Promise<UrlCheck> {
  const parsed = parseFetchableUrl(rawUrl, base);
  if (!parsed.ok) return parsed;
  return assertPublicUrl(parsed.url);
}

/**
 * The crawl boundary, by registrable domain from the Public Suffix List rather
 * than by counting labels. `example.co.uk` is a registrable domain while
 * `co.uk` is a suffix, and a two-label guess gets that backwards — which would
 * let a crawl of one `.co.uk` company wander into an unrelated one.
 *
 * Starting at `example.com` therefore also permits `careers.example.com` and
 * `jobs.example.com`, which is where companies actually publish this material.
 */
export function registrableDomain(hostname: string): string | null {
  // Private suffixes (github.io, vercel.app) treated as ordinary domains, so a
  // crawl cannot hop between two unrelated projects on the same host.
  return getDomain(hostname, { allowPrivateDomains: true });
}

export function isSameRegistrableDomain(candidate: URL, origin: URL): boolean {
  const candidateDomain = registrableDomain(candidate.hostname);
  const originDomain = registrableDomain(origin.hostname);

  // A bare host with no public suffix (localhost, a fixture server) has no
  // registrable domain, so fall back to an exact hostname match.
  if (candidateDomain === null || originDomain === null) {
    return candidate.hostname === origin.hostname;
  }

  return candidateDomain === originDomain;
}
