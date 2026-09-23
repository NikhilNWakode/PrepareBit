import { Router } from 'express';

import { healthRouter } from './health.js';

/**
 * Everything reachable under `/api`. The web app proxies `/api/*` here, so this
 * is the only prefix the browser ever sees.
 */
export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
