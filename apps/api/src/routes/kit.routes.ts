import { Router } from 'express';

import { kitController } from '../controllers/kit.controller.js';
import { loadOwnedKit } from '../middleware/load-owned-kit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validateBody } from '../middleware/validate.js';
import { createKitSchema } from '../validators/kit.validators.js';

export const kitRouter: Router = Router();

// Every kit route is authenticated first; ownership is resolved second.
kitRouter.get('/kits', requireAuth, kitController.list);

kitRouter.post('/kits', requireAuth, validateBody(createKitSchema), kitController.create);

// Rows are validated individually inside the controller, so one bad row does
// not reject the whole upload.
kitRouter.post('/kits/batch', requireAuth, kitController.createBatch);

kitRouter.get('/kits/:id', requireAuth, loadOwnedKit, kitController.get);

// Polled while a kit generates, so it stays deliberately cheap.
kitRouter.get('/kits/:id/status', requireAuth, loadOwnedKit, kitController.status);
