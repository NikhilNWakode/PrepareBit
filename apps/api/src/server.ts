import { createServer } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './logger.js';
import { connectToDatabase, disconnectFromDatabase } from './repositories/connection.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  await connectToDatabase();

  const server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(env.PORT, resolve));
  logger.info('api listening', { port: env.PORT, env: env.NODE_ENV });

  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });

    // Stop waiting on a connection that refuses to close.
    const forceExit = setTimeout(() => {
      logger.error('graceful shutdown timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await disconnectFromDatabase();
      process.exit(0);
    } catch (error) {
      logger.error('shutdown failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error('api failed to start', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
