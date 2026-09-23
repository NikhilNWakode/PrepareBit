import { Router } from 'express';

import { env } from '../config/env.js';
import { authController } from '../controllers/auth.controller.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validateBody } from '../middleware/validate.js';
import { loginSchema, registerSchema } from '../validators/auth.validators.js';

export const authRouter: Router = Router();

/**
 * Credential endpoints are the ones worth throttling (brief §11). The budget is
 * lifted under test so a suite that registers a dozen users is not throttled by
 * the thing it is not testing; the limiter itself has its own unit test.
 */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.isTest ? Number.MAX_SAFE_INTEGER : 20,
});

authRouter.post(
  '/auth/register',
  credentialLimiter,
  validateBody(registerSchema),
  authController.register,
);

authRouter.post('/auth/login', credentialLimiter, validateBody(loginSchema), authController.login);

authRouter.post('/auth/logout', authController.logout);

authRouter.get('/auth/me', requireAuth, authController.me);
