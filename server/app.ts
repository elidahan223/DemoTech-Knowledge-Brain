import express from 'express';
import { rateLimitMiddleware } from './Middleware/RateLimitMiddleware.js';
import { securityMiddleware } from './Middleware/SecurityMiddleware.js';
import { createApiRouter } from './Routes/api.routes.js';
import type { ServerSettings } from './Settings/ServerSettings.js';
export function createApp(settings: ServerSettings) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityMiddleware(settings));
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', rateLimitMiddleware());
  app.use('/api', createApiRouter());
  return app;
}
