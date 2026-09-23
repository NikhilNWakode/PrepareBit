import { describe, expect, it } from 'vitest';

import {
  isBlockedAddress,
  isSameRegistrableDomain,
  parseFetchableUrl,
  registrableDomain,
} from './url-guard.js';

describe('parseFetchableUrl', () => {
  it('accepts http and https', () => {
    expect(parseFetchableUrl('https://acme.example/about').ok).toBe(true);
    expect(parseFetchableUrl('http://localhost:8099/acme/').ok).toBe(true);
  });

  it.each(['file:///etc/passwd', 'ftp://acme.example', 'javascript:alert(1)', 'data:text/html,x'])(
    'rejects %s',
    (candidate) => {
      const result = parseFetchableUrl(candidate);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('unsupported-protocol');
    },
  );

  it('rejects embedded credentials, which disguise the real host', () => {
    const result = parseFetchableUrl('https://trusted.example@evil.example/');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('embedded-credentials');
  });

  it('rejects a malformed URL', () => {
    const result = parseFetchableUrl('not a url at all');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it('resolves a relative link against its page', () => {
    const result = parseFetchableUrl(
      '../handbook/how-we-hire.html',
      'http://localhost:8099/acme/about/',
    );

    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.url.href).toBe('http://localhost:8099/acme/handbook/how-we-hire.html');
  });
});

describe('isBlockedAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'private class A'],
    ['172.16.0.1', 'private class B'],
    ['172.31.255.255', 'private class B upper bound'],
    ['192.168.1.1', 'private class C'],
    ['169.254.169.254', 'cloud metadata endpoint'],
    ['100.64.0.1', 'carrier-grade NAT'],
    ['0.0.0.0', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'IPv6 loopback'],
    ['fc00::1', 'IPv6 unique local'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
  ])('blocks %s (%s)', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'])(
    'allows public address %s',
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it('refuses anything that is not an address it understands', () => {
    expect(isBlockedAddress('not-an-address')).toBe(true);
  });

  it('allows 172.32.x, which sits just outside the private range', () => {
    expect(isBlockedAddress('172.32.0.1')).toBe(false);
    expect(isBlockedAddress('172.15.0.1')).toBe(false);
  });
});

describe('registrable domain boundary', () => {
  it('treats subdomains of the same company as in scope', () => {
    const origin = new URL('https://example.com/');

    expect(isSameRegistrableDomain(new URL('https://careers.example.com/x'), origin)).toBe(true);
    expect(isSameRegistrableDomain(new URL('https://jobs.example.com/x'), origin)).toBe(true);
    expect(isSameRegistrableDomain(new URL('https://example.com/y'), origin)).toBe(true);
  });

  it('keeps an unrelated site out of scope', () => {
    const origin = new URL('https://example.com/');

    expect(isSameRegistrableDomain(new URL('https://unrelated.example/x'), origin)).toBe(false);
    expect(isSameRegistrableDomain(new URL('https://example.com.evil.test/x'), origin)).toBe(false);
  });

  /** The reason a two-label heuristic is not good enough. */
  it('handles a multi-part public suffix correctly', () => {
    expect(registrableDomain('careers.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('example.co.uk')).toBe('example.co.uk');

    const origin = new URL('https://example.co.uk/');
    expect(isSameRegistrableDomain(new URL('https://careers.example.co.uk/x'), origin)).toBe(true);
    // A naive last-two-labels rule would call this the same site. It is not.
    expect(isSameRegistrableDomain(new URL('https://other.co.uk/x'), origin)).toBe(false);
  });

  it('falls back to an exact host match where there is no public suffix', () => {
    const origin = new URL('http://localhost:8099/acme/');

    expect(isSameRegistrableDomain(new URL('http://localhost:8099/nohire/'), origin)).toBe(true);
    expect(isSameRegistrableDomain(new URL('http://other-host:8099/x'), origin)).toBe(false);
  });
});
