import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Serves the fixture company sites over real HTTP.
 *
 * Real requests rather than a mocked `fetch`, because the things most worth
 * testing here are exactly what a mock would paper over: relative link
 * resolution, redirects, robots.txt, content types and byte limits.
 *
 * Port 8099 by default, matching the example in Appendix B
 * (`http://localhost:8099/acme/`). Phase 8 reuses this for the batch run.
 */

export const DEFAULT_FIXTURE_PORT = 8099;

const FIXTURES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function serveFile(path: string): Promise<{ body: Buffer; type: string } | null> {
  // Contained to the fixtures directory: this serves from disk, so a traversal
  // attempt must not escape even in a test helper.
  const resolved = resolve(FIXTURES_ROOT, `.${normalize(path)}`);
  if (!resolved.startsWith(FIXTURES_ROOT)) return null;

  for (const candidate of [resolved, join(resolved, 'index.html'), `${resolved}.html`]) {
    try {
      const body = await readFile(candidate);
      const extension = candidate.slice(candidate.lastIndexOf('.'));
      return { body, type: CONTENT_TYPES[extension] ?? 'application/octet-stream' };
    } catch {
      continue;
    }
  }

  return null;
}

export function createFixtureServer(): Server {
  return createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;

    // --- Routes that misbehave on purpose -----------------------------------
    if (path === '/broken/500') {
      response.writeHead(500).end('server error');
      return;
    }

    if (path === '/broken/404') {
      response.writeHead(404).end('not found');
      return;
    }

    if (path === '/broken/hang') {
      // Never responds: exercises the fetch timeout.
      return;
    }

    if (path === '/broken/huge') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<html><body>${'x'.repeat(2_000_000)}</body></html>`);
      return;
    }

    if (path === '/broken/pdf') {
      response.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.4');
      return;
    }

    if (path === '/broken/redirect-loop') {
      response.writeHead(302, { location: '/broken/redirect-loop-2' }).end();
      return;
    }
    if (path === '/broken/redirect-loop-2') {
      response.writeHead(302, { location: '/broken/redirect-loop' }).end();
      return;
    }

    if (path === '/broken/redirect-offsite') {
      response.writeHead(302, { location: 'https://elsewhere.example/landing' }).end();
      return;
    }

    if (path === '/broken/redirect-ok') {
      response.writeHead(302, { location: '/acme/about/' }).end();
      return;
    }

    // --- Static fixture sites ------------------------------------------------
    if (path === '/robots.txt') {
      void serveFile('/robots.txt').then((file) => {
        if (!file) return response.writeHead(404).end();
        response.writeHead(200, { 'content-type': file.type }).end(file.body);
      });
      return;
    }

    void serveFile(join('/sites', path)).then((file) => {
      if (!file) {
        response.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not found</h1>');
        return;
      }
      response.writeHead(200, { 'content-type': file.type }).end(file.body);
    });
  });
}

export function startFixtureServer(port = DEFAULT_FIXTURE_PORT): Promise<Server> {
  const server = createFixtureServer();
  return new Promise((resolvePromise) => {
    server.listen(port, () => resolvePromise(server));
  });
}

export function stopFixtureServer(server: Server): Promise<void> {
  return new Promise((resolvePromise) => {
    server.closeAllConnections();
    server.close(() => resolvePromise());
  });
}
