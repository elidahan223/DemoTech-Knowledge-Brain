import express from 'express';
import path from 'node:path';
import { root } from '../store.js';
export async function configureFrontend(app: express.Express) {
  if (process.env.NODE_ENV === 'production') {
    const staticDir = path.resolve(process.env.BRAIN_STATIC_DIR || path.join(root, 'dist'));
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
}
