import mongoose from 'mongoose';

import { env } from '../config/env.js';
import { logger } from '../logger.js';

/**
 * A single connection opened at startup and closed on shutdown. No retry
 * supervisor: mongoose already buffers and reconnects, and anything more would
 * be infrastructure this project does not need.
 */
export async function connectToDatabase(): Promise<void> {
  mongoose.connection.on('error', (error: Error) => {
    logger.error('mongodb connection error', { message: error.message });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('mongodb disconnected');
  });

  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  logger.info('mongodb connected');
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('mongodb disconnected cleanly');
}
