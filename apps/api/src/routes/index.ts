import { Router } from 'express';

import { authRouter } from './auth.routes.js';
import { healthRouter } from './health.js';
import { kitRouter } from './kit.routes.js';

/**
 * Everything reachable under `/api`. The web app proxies `/api/*` here, so this
 * is the only prefix the browser ever sees.
 */
export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
apiRouter.use(authRouter);
apiRouter.use(kitRouter);
