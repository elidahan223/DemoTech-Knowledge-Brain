import express from 'express';
import { cancelJobs, jobSummary, resumeJobs } from '../ingest.js';
import { db } from '../store.js';
export function createJobsController() {
  const router = express.Router();
  router.get('/jobs/summary', (_req, res) => res.json(jobSummary()));
  router.post('/jobs/cancel', (req, res) => {
    const ids = req.body?.documentIds;
    if (
      ids !== undefined &&
      (!Array.isArray(ids) ||
        ids.length > 5000 ||
        ids.some((id: unknown) => typeof id !== 'string'))
    )
      return res.status(400).json({ error: 'Invalid document IDs' });
    res.json({ cancelled: cancelJobs(ids) });
  });
  router.post('/jobs/resume', (req, res) => {
    const resumed = resumeJobs(req.body?.includeErrors === true);
    res.json({ resumed });
  });
  router.get('/jobs', (_req, res) =>
    res.json(db.prepare('SELECT * FROM jobs ORDER BY created DESC LIMIT 300').all()),
  );
  return router;
}
