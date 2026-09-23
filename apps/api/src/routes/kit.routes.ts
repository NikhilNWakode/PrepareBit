import { Router } from 'express';

import { kitController } from '../controllers/kit.controller.js';
import { loadOwnedKit } from '../middleware/load-owned-kit.js';
import { requireAuth } from '../middleware/require-auth.js';

export const kitRouter: Router = Router();

// Every kit route is authenticated first; ownership is resolved second.
kitRouter.get('/kits', requireAuth, kitController.list);
kitRouter.get('/kits/:id', requireAuth, loadOwnedKit, kitController.get);
