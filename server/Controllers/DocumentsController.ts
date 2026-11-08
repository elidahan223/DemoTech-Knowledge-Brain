import express from 'express';
import { deleteDocument } from '../ingest.js';
import { analyzeDocumentNow } from '../Services/DocumentAnalysisService.js';
import { aiExecution } from '../Services/AiExecutionService.js';
import { db, listDocuments } from '../store.js';
import { acceptFiles, receiveFiles } from '../uploads.js';
export function createDocumentsController() {
  const router = express.Router();
  router.get('/documents', (_req, res) => res.json(listDocuments()));
  router.get('/documents/:id', (req, res) => {
    const doc = db
      .prepare('SELECT id,name,title,text,status,error FROM documents WHERE id=?')
      .get(req.params.id);
    if (!doc) return res.status(404).json({ error: 'מסמך לא נמצא' });
    res.json(doc);
  });
  router.post('/documents', receiveFiles, acceptFiles);
  router.delete('/documents/:id', async (req, res) => {
    if (
      db
        .prepare("SELECT id FROM jobs WHERE documentId=? AND status IN ('queued','processing')")
        .get(req.params.id)
    )
      return res.status(409).json({ error: 'יש להמתין לסיום עיבוד המסמך' });
    res.status((await deleteDocument(req.params.id)) ? 200 : 404).json({ ok: true });
  });
  router.post('/documents/:id/extract', async (req, res) => {
    if (aiExecution.busy)
      return res.status(429).json({ error: 'המודל עסוק; נסה שוב לאחר סיום הבקשה' });
    aiExecution.busy = true;
    try {
      await analyzeDocumentNow(req.params.id);
      res.json({ ok: true });
    } finally {
      aiExecution.busy = false;
    }
  });
  return router;
}
