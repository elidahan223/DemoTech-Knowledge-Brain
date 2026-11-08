import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { processGraphJobs } from '../graph-index.js';
import { processJobs, recoverPendingJobs, seed } from '../ingest.js';
import { db, resolveStoredPath } from '../store.js';
import { loadVectors } from '../vectors.js';
export async function initializeRepository() {
  await seed();
  await loadVectors();
  for (const d of db
    .prepare('SELECT id,path FROM documents WHERE id NOT IN (SELECT documentId FROM fileHashes)')
    .all()) {
    try {
      const bytes = await readFile(resolveStoredPath(d.path as string));
      db.prepare('INSERT OR IGNORE INTO fileHashes VALUES(?,?)').run(
        d.id as string,
        createHash('sha256').update(bytes).digest('hex'),
      );
    } catch {
      /* A missing file is reported when it is reprocessed. */
    }
  }
  recoverPendingJobs();
  if (process.env.BRAIN_PAUSE_BACKGROUND !== '1') void processJobs();
  db.exec("UPDATE graph_jobs SET status='queued' WHERE status='processing'");
  if (process.env.BRAIN_PAUSE_BACKGROUND !== '1') void processGraphJobs();
}
