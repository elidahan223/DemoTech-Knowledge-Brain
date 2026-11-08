import express from 'express';
import { requestAccess, serverTiming } from '../Middleware/RequestContext.js';
import { retrieve, searchSources } from '../rag.js';
import { interactive } from '../scheduler.js';
export function createSearchController() {
  const router = express.Router();
  router.post('/search', async (req, res) => {
    if (
      typeof req.body?.question !== 'string' ||
      req.body.question.length > 2000 ||
      (req.body.strategy && !['lexical', 'hybrid'].includes(req.body.strategy))
    )
      return res.status(400).json({ error: 'שאלה לא תקינה' });
    const timings: Record<string, number> = {};
    const start = performance.now();
    const options = { access: requestAccess(req), timings };
    const result = await interactive(() =>
      req.body.strategy === 'lexical'
        ? retrieve(req.body.question, 6, options)
        : searchSources(req.body.question, 6, options),
    );
    timings.totalMs = performance.now() - start;
    res.setHeader('Server-Timing', serverTiming(timings));
    res.setHeader('X-Brain-Response-Kind', 'document-search');
    res.json(result);
  });
  return router;
}
