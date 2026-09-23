/**
 * Runs the fixture company sites for manual checks and for the batch entry
 * point: `npm run fixtures`.
 *
 *   http://localhost:8099/acme/    a normal site, hiring page buried in a handbook
 *   http://localhost:8099/nohire/  a real site with no hiring page anywhere
 *   http://localhost:8099/broken/* routes that fail on purpose
 */
import {
  DEFAULT_FIXTURE_PORT,
  startFixtureServer,
  stopFixtureServer,
} from '../apps/api/src/test-support/fixture-server.js';

const port = Number(process.env['FIXTURE_PORT'] ?? DEFAULT_FIXTURE_PORT);

const server = await startFixtureServer(port);

console.log(`fixture sites listening on http://localhost:${port}`);
console.log(`  http://localhost:${port}/acme/`);
console.log(`  http://localhost:${port}/nohire/`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void stopFixtureServer(server).then(() => process.exit(0));
  });
}
