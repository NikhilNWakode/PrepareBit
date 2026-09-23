import type { Server } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startFixtureServer, stopFixtureServer } from '../test-support/fixture-server.js';
import { createCompanyCrawler } from './company-crawler.js';
import { fetchPage } from './fetch-page.js';
import { clearRobotsCache } from './robots.js';

/**
 * Driven against real HTTP rather than a mocked `fetch`, because the things
 * most worth proving here are exactly what a mock would paper over: relative
 * link resolution, redirects, robots.txt, content types and byte caps.
 */
const PORT = 8123; // not 8099, so a fixture server left running does not collide
const BASE = `http://localhost:${PORT}`;

let server: Server;

beforeAll(async () => {
  server = await startFixtureServer(PORT);
});

afterAll(async () => {
  await stopFixtureServer(server);
});

beforeEach(() => {
  // The policy is cached per origin; without this one test's robots.txt leaks.
  clearRobotsCache();
});

describe('fetchPage', () => {
  it('fetches an ordinary page', async () => {
    const result = await fetchPage(new URL(`${BASE}/acme/`));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.html).toContain('Acme Freight');
  });

  it('reports a 404 as a failure rather than throwing', async () => {
    const result = await fetchPage(new URL(`${BASE}/broken/404`));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('http-error');
  });

  it('gives up on a 500 after retrying', async () => {
    const result = await fetchPage(new URL(`${BASE}/broken/500`));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain('500');
  });

  it('times out on a route that never responds', async () => {
    const result = await fetchPage(new URL(`${BASE}/broken/hang`), {
      signal: AbortSignal.timeout(700),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(['timeout', 'network-error']).toContain(result.reason);
  }, 20_000);

  it('refuses a response larger than the cap', async () => {
    const result = await fetchPage(new URL(`${BASE}/broken/huge`));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-large');
  });

  it('refuses a content type it cannot read', async () => {
    const result = await fetchPage(new URL(`${BASE}/broken/pdf`));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-content-type');
  });

  it('follows a redirect that stays on the site', async () => {
    const result = await fetchPage(new URL(`${BASE}/broken/redirect-ok`), {
      confineToDomainOf: new URL(BASE),
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.html).toContain('About Acme Freight');
  });

  it('blocks a redirect that leaves the company’s domain', async () => {
    const result = await fetchPage(new URL(`${BASE}/broken/redirect-offsite`), {
      confineToDomainOf: new URL(BASE),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('blocked-url');
      expect(result.detail).toBe('off-domain redirect');
    }
  });

  it('stops a redirect loop instead of following it forever', async () => {
    const result = await fetchPage(new URL(`${BASE}/broken/redirect-loop`), {
      confineToDomainOf: new URL(BASE),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('too-many-redirects');
  });
});

describe('company crawler', () => {
  it('finds a hiring page buried where no fixed path list would look', async () => {
    const result = await createCompanyCrawler().crawl(`${BASE}/acme/`);

    // Reached only by following the homepage -> handbook -> how-we-hire trail.
    expect(result.hiringPagesFound).toHaveLength(1);
    expect(result.hiringPagesFound[0]).toContain('/acme/handbook/how-we-hire');

    const hiringPage = result.pages.find((page) => page.url.includes('how-we-hire'));
    expect(hiringPage?.text).toMatch(/take-home/i);
    expect(hiringPage?.text).toMatch(/system design/i);
  }, 30_000);

  it('collects the company’s own description of itself', async () => {
    const result = await createCompanyCrawler().crawl(`${BASE}/acme/`);
    const combined = result.pages.map((page) => page.text).join('\n');

    expect(combined).toContain('route optimisation');
    expect(result.pages.some((page) => page.url.includes('/about'))).toBe(true);
  }, 30_000);

  it('stays inside the registrable domain', async () => {
    const result = await createCompanyCrawler().crawl(`${BASE}/acme/`);

    // The homepage links to unrelated.example; it must not have been fetched.
    expect(result.pages.every((page) => page.url.startsWith(BASE))).toBe(true);
  }, 30_000);

  it('never fetches the same page twice', async () => {
    const result = await createCompanyCrawler().crawl(`${BASE}/acme/`);
    const urls = result.pages.map((page) => page.url);

    expect(new Set(urls).size).toBe(urls.length);
  }, 30_000);

  it('respects the page budget', async () => {
    const result = await createCompanyCrawler({ maxPages: 2, maxDepth: 2 }).crawl(`${BASE}/acme/`);

    expect(result.pages.length).toBeLessThanOrEqual(2);
  }, 30_000);

  /** The case the brief explicitly tests. */
  it('says so honestly when a site has no hiring page anywhere', async () => {
    const result = await createCompanyCrawler().crawl(`${BASE}/nohire/`);

    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.hiringPagesFound).toEqual([]);
    expect(result.notes.join(' ')).toMatch(/no page describing the hiring/i);
  }, 30_000);

  it('obeys robots.txt', async () => {
    const result = await createCompanyCrawler().crawl(`${BASE}/nohire/`);

    expect(result.pages.every((page) => !page.url.includes('/private/'))).toBe(true);
    expect(result.notes.join(' ')).toMatch(/robots\.txt disallowed/i);
  }, 30_000);

  it('records an unusable company URL instead of throwing', async () => {
    const result = await createCompanyCrawler().crawl('not-a-url');

    expect(result.pages).toEqual([]);
    expect(result.pagesFailed).toHaveLength(1);
    expect(result.notes.join(' ')).toMatch(/could not be used/i);
  });

  it('returns a result for a host that does not answer at all', async () => {
    const result = await createCompanyCrawler().crawl('http://localhost:9/');

    expect(result.pages).toEqual([]);
    expect(result.pagesFailed.length).toBeGreaterThan(0);
    expect(result.notes.join(' ')).toMatch(/no pages could be retrieved/i);
  }, 30_000);
});
