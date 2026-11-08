import express from 'express';
import { queueGraph } from '../graph-index.js';
import { db, graph } from '../store.js';
export function createGraphController() {
  const router = express.Router();
  router.post('/graph/rebuild', (req, res) => {
    const method = req.body?.method ?? 'ai';
    if (!['explicit', 'ai'].includes(method))
      return res.status(400).json({ error: 'Invalid graph extraction method' });
    const ids =
      req.body?.documentIds ||
      db
        .prepare("SELECT id FROM documents WHERE status='ready'")
        .all()
        .map((d) => d.id);
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))
      return res.status(400).json({ error: 'Invalid document IDs' });
    res.status(202).json({
      queued: queueGraph(ids, method),
      method,
      provider: method === 'ai' ? 'ollama' : null,
    });
  });
  router.get('/graph', (_req, res) => res.json(graph()));
  return router;
}
