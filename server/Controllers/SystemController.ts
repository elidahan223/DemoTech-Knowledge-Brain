import express from 'express';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { health } from '../ollama.js';
import { db, repositoryName } from '../store.js';
import { embeddingModel, embeddingStats } from '../vectors.js';
import { automaticDocumentAnalysis } from '../Services/DocumentAnalysisService.js';
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();
export function createSystemController() {
  const router = express.Router();
  router.get('/health', async (_req, res) =>
    res.json({
      repository: repositoryName,
      ollama: await health(embeddingModel),
      aiProcessing: { localOnly: true, questionUnderstanding: 'ollama', automaticDocumentAnalysis },
      embeddingModel: embeddingModel || null,
      retrieval: embeddingModel ? 'SQLite FTS5 + local exact cosine vectors (RRF)' : 'SQLite FTS5',
      documents: db.prepare('SELECT count(*) AS count FROM documents').get()?.count,
    }),
  );
  router.get('/metrics', (_req, res) =>
    res.json({
      repository: repositoryName,
      pid: process.pid,
      memory: process.memoryUsage(),
      cpuMicroseconds: process.cpuUsage(),
      eventLoopDelayMs: {
        mean: eventLoop.mean / 1e6,
        p95: eventLoop.percentile(95) / 1e6,
        max: eventLoop.max / 1e6,
      },
      documents: db.prepare('SELECT status,count(*) AS count FROM documents GROUP BY status').all(),
      jobs: db.prepare('SELECT status,count(*) AS count FROM jobs GROUP BY status').all(),
      graphJobs: db
        .prepare('SELECT method,status,count(*) AS count FROM graph_jobs GROUP BY method,status')
        .all(),
      chunks: db.prepare('SELECT count(*) AS count FROM chunks').get()?.count,
      embeddings: db.prepare('SELECT count(*) AS count FROM embeddings').get()?.count,
      embeddingStats,
      edges: db
        .prepare('SELECT method,verified,count(*) AS count FROM edges GROUP BY method,verified')
        .all(),
    }),
  );
  router.get('/audit', (_req, res) =>
    res.json(db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all()),
  );
  return router;
}
