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
const TEST_URI =
  process.env['MONGODB_TEST_URI'] ?? 'mongodb://127.0.0.1:27017/interview-prep-kit-test';

export interface TestDatabase {
  available: boolean;
}

export async function connectTestDatabase(): Promise<TestDatabase> {
  // Refuses to touch anything not clearly a test database, because this module
  // deletes collections between tests.
  const databaseName = new URL(TEST_URI).pathname.replace(/^\//, '');
  if (!databaseName.includes('test')) {
    throw new Error(
      `Refusing to run tests against "${databaseName}": the database name must contain "test".`,
    );
  }

  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2000 });
    return { available: true };
  } catch {
    console.warn(
      `\n  SKIPPED: database suites need MongoDB at ${TEST_URI}\n` +
        `  Start a local server or set MONGODB_TEST_URI to run them.\n`,
    );
    return { available: false };
  }
}

export async function clearTestDatabase(): Promise<void> {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

export async function disconnectTestDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
