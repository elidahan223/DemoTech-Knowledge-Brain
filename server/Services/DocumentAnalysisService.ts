export const automaticDocumentAnalysis = process.env.BRAIN_AUTO_AI_ANALYSIS !== '0';

/** Only the newly indexed document is queued; existing repositories are never bulk-reprocessed. */
export async function enqueueDocumentAnalysis(documentId: string) {
  if (!automaticDocumentAnalysis) return 0;
  const { queueGraph } = await import('../graph-index.js');
  return queueGraph([documentId], 'ai');
}
import { randomUUID } from 'node:crypto';
import { db, audit } from '../store.js';

export async function analyzeDocumentNow(documentId: string) {
  const jobId = randomUUID();
  db.prepare(
    "INSERT INTO graph_jobs(id,documentId,status,error,method,created) VALUES(?,?,'processing',NULL,'ai',?)",
  ).run(jobId, documentId, new Date().toISOString());
  try {
    const { extractAI } = await import('../ingest.js');
    await extractAI(documentId);
    db.prepare("UPDATE graph_jobs SET status='done',error=NULL WHERE id=?").run(jobId);
    audit('graph-job-done', documentId);
  } catch (error) {
    db.prepare("UPDATE graph_jobs SET status='error',error=? WHERE id=?").run(
      (error as Error).message,
      jobId,
    );
    audit('graph-job-error', documentId);
    throw error;
  }
}
