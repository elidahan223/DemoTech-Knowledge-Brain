import express from 'express';
import { library, map, nodeDetails, state } from '../catalog.js';
import { explainDocumentLink } from '../document-links.js';
import { db } from '../store.js';
export function createCatalogController() {
  const router = express.Router();
  router.get('/state', (_req, res) => res.json(state()));
  router.get('/library', (req, res) => res.json(library(req.query)));
  router.get('/map', (req, res) => res.json(map(req.query)));
  router.get('/nodes/:id', (req, res) => {
    const details = nodeDetails(req.params.id, req.query);
    res.status(details ? 200 : 404).json(details || { error: 'הצומת לא נמצא' });
  });
  router.get('/edges/:id', (req, res) => {
    const edge = req.params.id.startsWith('related:')
      ? explainDocumentLink(req.params.id)
      : db.prepare('SELECT * FROM edges WHERE id=?').get(req.params.id);
    res.status(edge ? 200 : 404).json(edge || { error: 'הקשר לא נמצא' });
  });
  return router;
}
