import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';

import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { requestLogger } from './middleware/request-logger.js';
import { healthRouter } from './routes/health.js';
import { apiRouter } from './routes/index.js';

/**
 * Builds the Express application without binding a port, so tests can drive it
 * directly and `server.ts` stays a thin entrypoint.
 */
export function createApp(): Express {
  const app = express();

  // Render and Vercel both sit in front of this process.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  // Secret enables signed cookies; see config/cookies.ts for why they are signed.
  app.use(cookieParser(env.COOKIE_SECRET));

  if (!env.isTest) app.use(requestLogger);

  // `/health` for uptime checks, `/api/health` for the web app's own reachability
  // probe, which can only see the proxied `/api` prefix.
  app.use(healthRouter);
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
