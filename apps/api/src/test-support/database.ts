import { createHash } from 'node:crypto';

import mongoose from 'mongoose';

/**
 * Integration suites run against a real MongoDB rather than an in-memory
 * replacement. `mongodb-memory-server` downloads a ~100MB server binary on
 * install, which stalls or fails outright on a restricted network — including,
 * potentially, whoever runs `npm install` on this repository next.
 *
 * So: use a database if one is reachable, and skip cleanly if not. The
 * deterministic logic the brief actually asks to be tested — schedule
 * allocation, coverage checking, structure validation — is pure and never
 * depends on this.
 */
const BASE_URI =
  process.env['MONGODB_TEST_URI'] ?? 'mongodb://127.0.0.1:27017/interview-prep-kit-test';

export interface TestDatabase {
  available: boolean;
}

/**
 * Each test file gets its own database, named from its module URL.
 *
 * Vitest runs files in parallel workers, and these suites clear collections
 * between tests — so on a shared database one file wipes another's fixtures
 * mid-test. That failure only appears in a full run, never when a file is run
 * alone, which makes it exactly the kind of flake worth designing out.
 */
function databaseUriFor(moduleUrl: string): { uri: string; name: string } {
  const url = new URL(BASE_URI);
  const baseName = url.pathname.replace(/^\//, '');

  // This module deletes collections, so it refuses to touch anything that is
  // not plainly a test database.
  if (!baseName.includes('test')) {
    throw new Error(
      `Refusing to run tests against "${baseName}": the database name must contain "test".`,
    );
  }

  const suffix = createHash('sha256').update(moduleUrl).digest('hex').slice(0, 8);
  const name = `${baseName}-${suffix}`;
  url.pathname = `/${name}`;

  return { uri: url.toString(), name };
}

/** Pass `import.meta.url` so the suite gets a database of its own. */
export async function connectTestDatabase(moduleUrl: string): Promise<TestDatabase> {
  const { uri } = databaseUriFor(moduleUrl);

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
    return { available: true };
  } catch {
    console.warn(
      `\n  SKIPPED: database suites need MongoDB at ${BASE_URI}\n` +
        `  Start a local server or set MONGODB_TEST_URI to run them.\n`,
    );
    return { available: false };
  }
}

export async function clearTestDatabase(): Promise<void> {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

/** Drops the per-file database so runs do not accumulate databases over time. */
export async function disconnectTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
