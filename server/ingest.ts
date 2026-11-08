import { extractDocumentEntities } from './Services/DocumentEntityExtraction.js';
import { randomUUID } from 'node:crypto';
import { copyFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { extract } from './extractor.js';
import { documentMetadata, safeSlice, supportingSnippet } from './metadata.js';
import { ollama, OllamaError } from './ollama.js';
import { audit, cleanOrphans, dataDir, db, resolveStoredPath, root, transaction } from './store.js';
import { embeddingModel, indexVectors, removeVectors } from './vectors.js';
import { enqueueDocumentAnalysis } from './Services/DocumentAnalysisService.js';
export { extract } from './extractor.js';
export type Doc = {
  id: string;
  name: string;
  title: string;
  text: string;
  status: string;
  path: string;
  error?: string;
};
function edge(
  source: string,
  target: string,
  type: string,
  documentId: string,
  evidence: string,
  method = 'explicit',
  verified = true,
) {
  db.prepare('INSERT OR IGNORE INTO edges VALUES(?,?,?,?,?,?,?,?)').run(
    `${documentId}:${source}:${target}:${type}:${method}`,
    source,
    target,
    type,
    documentId,
    evidence,
    method,
    verified ? 1 : 0,
  );
}
function node(id: string, label: string, type: string, department: string | null = null) {
  const existing = db
    .prepare('SELECT id FROM nodes WHERE type=? AND lower(label)=lower(?)')
    .get(type, label.normalize('NFKC').trim()) as { id: string } | undefined;
  if (existing && type !== 'document') return existing.id;
  db.prepare('INSERT OR IGNORE INTO nodes VALUES(?,?,?,?)').run(id, label, type, department);
  return id;
}
function snippet(text: string, term: string) {
  return supportingSnippet(text, term);
}
/** Deletes a document's FTS chunks through the indexed map instead of scanning the FTS table. */
function deleteChunks(id: string) {
  const remove = db.prepare('DELETE FROM chunks WHERE rowid=?');
  for (const row of db
    .prepare('SELECT chunkId FROM chunk_documents WHERE documentId=?')
    .all(id) as { chunkId: number }[])
    remove.run(row.chunkId);
  db.prepare('DELETE FROM chunk_documents WHERE documentId=?').run(id);
}
export function indexDocument(id: string, text: string) {
  const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(id) as unknown as Doc;
  transaction(() => {
    const metadata = documentMetadata(text);
    if (metadata.title) {
      db.prepare('UPDATE documents SET title=? WHERE id=?').run(metadata.title, id);
      doc.title = metadata.title;
    }
    if (metadata.externalId) {
      const existing = db
        .prepare('SELECT documentId FROM document_aliases WHERE alias=?')
        .get(metadata.externalId) as { documentId: string } | undefined;
      if (existing && existing.documentId !== id)
        throw new Error('מזהה המסמך החיצוני כבר שייך למסמך אחר');
    }
    db.prepare('DELETE FROM document_aliases WHERE documentId=?').run(id);
    db.prepare('DELETE FROM document_metadata WHERE documentId=?').run(id);
    if (metadata.externalId) {
      db.prepare('INSERT OR IGNORE INTO document_aliases VALUES(?,?)').run(metadata.externalId, id);
      db.prepare(
        'INSERT INTO document_metadata VALUES(?,?,?) ON CONFLICT(documentId) DO UPDATE SET externalId=excluded.externalId,sourceType=excluded.sourceType',
      ).run(id, metadata.externalId, metadata.sourceType || null);
    }
    deleteChunks(id);
    db.prepare('DELETE FROM edges WHERE documentId=?').run(id);
    db.prepare(
      'INSERT INTO nodes(id,label,type) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label',
    ).run(id, doc.title, 'document');
    // Controlled chunking: 1,100-character windows with 250 characters of overlap, never splitting a surrogate pair.
    const insertChunk = db.prepare('INSERT INTO chunks(documentId,text) VALUES(?,?)'),
      mapChunk = db.prepare(
        'INSERT OR REPLACE INTO chunk_documents(chunkId,documentId) VALUES(?,?)',
      );
    for (let start = 0; start < text.length; start += 850) {
      const row = insertChunk.run(id, safeSlice(text, start, start + 1100));
      mapChunk.run(row.lastInsertRowid, id);
    }
    const department = id.match(/^(HR|IT|FIN|SEC|OPS)-/)?.[1];
    if (department) {
      const dep = node(`department:${department}`, department, 'department');
      edge(
        id,
        dep,
        'belongs_to',
        id,
        snippet(text, department),
        'explicit',
        text.includes(department),
      );
    }
    const candidates = new Set(text.match(/[A-Za-z0-9][A-Za-z0-9_-]{2,}/g) || []);
    const findDocument = db.prepare(
      'SELECT id,title FROM documents WHERE id=? OR id=(SELECT documentId FROM document_aliases WHERE alias=?)',
    );
    for (const candidate of candidates) {
      const target = findDocument.get(candidate, candidate) as
        | { id: string; title: string }
        | undefined;
      if (target && target.id !== id) {
        node(target.id, target.title, 'document');
        edge(id, target.id, 'references', id, snippet(text, candidate));
      }
    }
    if (metadata.sourceType) {
      const target = node(`system:${metadata.sourceType}`, metadata.sourceType, 'system');
      edge(
        id,
        target,
        'published_in',
        id,
        supportingSnippet(text, `source_type: ${metadata.sourceType}`),
      );
    }
    // Only explicit, labeled fields become entities. No inferred people or departments.
    const owner = text.match(/בעל תפקיד אחראי\s*\n+\s*([^\n]+)/);
    if (owner) {
      const label = owner[1].split(/[—–]/)[0].normalize('NFKC').trim();
      const entity = node(`person:${label}`, label, 'person');
      edge(id, entity, 'owner', id, owner[0]);
    }
    for (const line of text.split('\n').map((x) => x.trim())) {
      const match = line.match(
        /^(?:בעל הנוהל|בעל תפקיד|אחראי|אחראית|מנהל התהליך)\s*[:：]\s*(.{2,70})$/,
      );
      if (match) {
        const label = match[1].normalize('NFKC').trim();
        const entity = node(`person:${label}`, label, 'person');
        edge(id, entity, 'owner', id, line);
      }
      for (const system of ['VPN', 'ERP', 'CRM', 'Active Directory', 'Microsoft 365'])
        if (line.includes(system)) {
          const entity = node(`system:${system.toLowerCase()}`, system, 'system');
          edge(id, entity, 'mentions', id, line.slice(0, 500));
        }
    }
    db.prepare('UPDATE documents SET text=?,status=?,error=NULL,updated=? WHERE id=?').run(
      text,
      embeddingModel ? 'embedding' : 'ready',
      new Date().toISOString(),
      id,
    );
    cleanOrphans();
    audit('text-indexed', id);
    // Resolve literal inbound references when the referenced document arrives later.
    // FTS finds candidate documents; the original text must contain the exact ID.
    for (const identifier of [id, metadata.externalId].filter((v): v is string => Boolean(v))) {
      const query = '"' + identifier.replaceAll('"', '""') + '"';
      const incoming = db
        .prepare(
          "SELECT DISTINCT d.id,d.text FROM chunks c JOIN documents d ON d.id=c.documentId WHERE chunks MATCH ? AND d.id!=? AND d.status='ready'",
        )
        .all(query, id) as { id: string; text: string }[];
      for (const source of incoming)
        if (source.text.includes(identifier))
          edge(source.id, id, 'references', source.id, snippet(source.text, identifier));
    }
  });
}
let running = false;
let wakeTimer: NodeJS.Timeout | undefined;
export const RETRY_LIMIT = 5;
/** Connection failures, timeouts and 5xx/429 from the local model are transient; parse/format errors are not. */
export function transientError(error: unknown) {
  if (error instanceof OllamaError) return error.retryable;
  return /fetch failed|ECONNREFUSED|ECONNRESET|EPIPE|socket hang up|timed? ?out|TimeoutError|aborted|HTTP (?:429|5\d\d)/i.test(
    error instanceof Error ? `${error.name} ${error.message}` : String(error),
  );
}
export function retryDelayMs(attempt: number) {
  return Math.min(300000, 5000 * 2 ** Math.max(0, attempt - 1));
}
function scheduleWake() {
  const next = (
    db
      .prepare(
        "SELECT min(nextAttempt) AS at FROM jobs WHERE status='queued' AND nextAttempt IS NOT NULL",
      )
      .get() as { at: string | null }
  ).at;
  if (!next) return;
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => void processJobs(), Math.max(250, Date.parse(next) - Date.now()));
  wakeTimer.unref();
}
// One document at a time on purpose: extraction runs in a worker thread and Ollama embedding throughput does not
// improve with parallel requests (measured), so a single pipeline keeps CPU/GPU free for the interface and chat.
export async function processJobs() {
  if (running || process.env.BRAIN_PAUSE_BACKGROUND === '1') return;
  running = true;
  try {
    for (;;) {
      const now = new Date().toISOString();
      const job = db
        .prepare(
          "SELECT * FROM jobs WHERE status='queued' AND (nextAttempt IS NULL OR nextAttempt<=?) ORDER BY created LIMIT 1",
        )
        .get(now) as { id: string; documentId: string; attempts: number } | undefined;
      if (!job) {
        scheduleWake();
        break;
      }
      // Claim atomically: a job cancelled after selection is skipped.
      if (
        !Number(
          db
            .prepare("UPDATE jobs SET status='processing',updated=? WHERE id=? AND status='queued'")
            .run(now, job.id).changes,
        )
      )
        continue;
      try {
        const doc = db
          .prepare('SELECT * FROM documents WHERE id=?')
          .get(job.documentId) as unknown as Doc;
        if (doc) {
          db.prepare("UPDATE documents SET status='processing' WHERE id=?").run(doc.id);
          const text = await extract(resolveStoredPath(doc.path));
          await removeVectors(doc.id);
          indexDocument(doc.id, text);
          const current = db.prepare('SELECT title FROM documents WHERE id=?').get(doc.id) as {
            title: string;
          };
          await indexVectors(doc.id, current.title);
          db.prepare("UPDATE documents SET status='ready',error=NULL WHERE id=?").run(doc.id);
          await enqueueDocumentAnalysis(doc.id);
          audit('indexed', doc.id);
        }
        db.prepare("UPDATE jobs SET status='done',error=NULL,updated=? WHERE id=?").run(
          new Date().toISOString(),
          job.id,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const attempts = Number(job.attempts || 0) + 1;
        const at = new Date().toISOString();
        if (transientError(e) && attempts < RETRY_LIMIT) {
          const nextAttempt = new Date(Date.now() + retryDelayMs(attempts)).toISOString();
          db.prepare(
            "UPDATE jobs SET status='queued',attempts=?,nextAttempt=?,error=?,updated=? WHERE id=?",
          ).run(attempts, nextAttempt, message, at, job.id);
          db.prepare("UPDATE documents SET status='queued',error=? WHERE id=?").run(
            `תקלה זמנית; ניסיון חוזר ${attempts}/${RETRY_LIMIT - 1}: ${message}`.slice(0, 500),
            job.documentId,
          );
        } else {
          db.prepare("UPDATE jobs SET status='error',attempts=?,error=?,updated=? WHERE id=?").run(
            attempts,
            message,
            at,
            job.id,
          );
          db.prepare("UPDATE documents SET status='error',error=? WHERE id=?").run(
            message,
            job.documentId,
          );
        }
      }
      // Yield between documents so HTTP requests are served promptly during long imports.
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    running = false;
  }
}
/** Never creates a second active job for the same document (prevents double indexing). */
export function enqueue(id: string) {
  const active = db
    .prepare("SELECT id FROM jobs WHERE documentId=? AND status IN ('queued','processing')")
    .get(id) as { id: string } | undefined;
  if (active) return active.id;
  const jobId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO jobs(id,documentId,status,error,created,attempts,updated) VALUES(?,?,?,NULL,?,0,?)',
  ).run(jobId, id, 'queued', now, now);
  setImmediate(() => void processJobs());
  return jobId;
}
export function recoverPendingJobs() {
  transaction(() => {
    db.exec(
      "UPDATE jobs SET status='queued' WHERE status='processing'; UPDATE documents SET status='queued' WHERE status IN ('processing','embedding') AND id IN (SELECT documentId FROM jobs WHERE status='queued')",
    );
  });
}
/** Cancels queued work. The document currently being processed finishes, so no half-indexed state is left behind. */
export function cancelJobs(documentIds?: string[]) {
  return transaction(() => {
    const now = new Date().toISOString();
    const filter = documentIds
      ? ` AND documentId IN (${documentIds.map(() => '?').join(',') || "''"})`
      : '';
    const ids = db
      .prepare(`SELECT documentId FROM jobs WHERE status='queued'${filter}`)
      .all(...(documentIds || [])) as { documentId: string }[];
    db.prepare(`UPDATE jobs SET status='cancelled',updated=? WHERE status='queued'${filter}`).run(
      now,
      ...(documentIds || []),
    );
    const mark = db.prepare(
      "UPDATE documents SET status='cancelled',error=NULL WHERE id=? AND status IN ('queued','error')",
    );
    for (const row of ids) mark.run(row.documentId);
    if (ids.length) audit('jobs-cancelled');
    return ids.length;
  });
}
/** Re-queues cancelled documents and, optionally, documents whose processing failed. */
export function resumeJobs(includeErrors = false) {
  const statuses = includeErrors ? "('cancelled','error')" : "('cancelled')";
  const ids = (
    db.prepare(`SELECT id FROM documents WHERE status IN ${statuses}`).all() as { id: string }[]
  ).map((r) => r.id);
  transaction(() => {
    const reset = db.prepare("UPDATE documents SET status='queued',error=NULL WHERE id=?");
    for (const id of ids) {
      reset.run(id);
      enqueue(id);
    }
    if (ids.length) audit('jobs-resumed');
  });
  return ids.length;
}
export function jobSummary() {
  const counts = Object.fromEntries(
    (
      db.prepare('SELECT status,count(*) AS n FROM jobs GROUP BY status').all() as {
        status: string;
        n: number;
      }[]
    ).map((r) => [r.status, Number(r.n)]),
  );
  // Throughput over the last 5 minutes, divided by the time actually covered (a run that started 1 minute ago is not averaged over 5).
  const windowMs = 300000;
  const recentRow = db
    .prepare(
      "SELECT count(*) AS n,min(updated) AS first FROM jobs WHERE status='done' AND updated>=?",
    )
    .get(new Date(Date.now() - windowMs).toISOString()) as { n: number; first: string | null };
  const recent = Number(recentRow.n);
  const covered = recentRow.first
    ? Math.max(30000, Math.min(windowMs, Date.now() - Date.parse(recentRow.first)))
    : windowMs;
  const remaining = (counts.queued || 0) + (counts.processing || 0);
  const perMinute = recent / (covered / 60000);
  const current = db
    .prepare(
      "SELECT j.documentId,d.title,d.status FROM jobs j JOIN documents d ON d.id=j.documentId WHERE j.status='processing' LIMIT 1",
    )
    .get() as { documentId: string; title: string; status: string } | undefined;
  const retrying = Number(
    (
      db.prepare("SELECT count(*) AS n FROM jobs WHERE status='queued' AND attempts>0").get() as {
        n: number;
      }
    ).n,
  );
  return {
    counts,
    remaining,
    retrying,
    current: current || null,
    throughputPerMinute: +perMinute.toFixed(1),
    etaSeconds: perMinute > 0 ? Math.round((remaining / perMinute) * 60) : null,
    running,
    paused: process.env.BRAIN_PAUSE_BACKGROUND === '1',
  };
}
export async function seed() {
  if (process.env.BRAIN_SEED_DEMO === '0') return;
  if (db.prepare("SELECT value FROM metadata WHERE key='seeded'").get()) return;
  const original = JSON.parse(await readFile(path.join(root, 'knowledge_graph.json'), 'utf8')) as {
    nodes: { id: string; label: string; type: string; department: string }[];
    edges: { source: string; target: string; type: string }[];
  };
  for (const n of original.nodes) {
    const file = path.join(dataDir, 'files', `${n.id}.docx`);
    await copyFile(path.join(root, 'docs', `${n.id}.docx`), file);
    db.prepare('INSERT OR IGNORE INTO documents VALUES(?,?,?,?,?,?,NULL,?)').run(
      n.id,
      `${n.id}.docx`,
      n.label,
      '',
      'queued',
      file,
      new Date().toISOString(),
    );
    node(n.id, n.label, n.type, n.department);
  }
  for (const n of original.nodes) {
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(n.id) as unknown as Doc;
    await removeVectors(doc.id);
    indexDocument(doc.id, await extract(doc.path));
    await indexVectors(doc.id, doc.title);
    db.prepare("UPDATE documents SET status='ready' WHERE id=?").run(doc.id);
  }
  // Preserve original edges, but only verify them if their target ID actually appears in source text.
  for (const e of original.edges) {
    const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(e.source) as unknown as Doc;
    edge(
      e.source,
      e.target,
      e.type,
      e.source,
      doc.text.includes(e.target)
        ? snippet(doc.text, e.target)
        : 'הפניה מתוך knowledge_graph.json; לא נמצאה ראיה בטקסט',
      'explicit',
      doc.text.includes(e.target),
    );
  }
  db.prepare("INSERT INTO metadata VALUES('seeded','1')").run();
}
export async function deleteDocument(id: string) {
  const doc = db.prepare('SELECT * FROM documents WHERE id=?').get(id) as unknown as
    | Doc
    | undefined;
  if (!doc) return false;
  await removeVectors(id);
  transaction(() => {
    deleteChunks(id);
    db.prepare('DELETE FROM jobs WHERE documentId=?').run(id);
    db.prepare('DELETE FROM nodes WHERE id=?').run(id);
    db.prepare('DELETE FROM documents WHERE id=?').run(id);
    cleanOrphans();
    audit('deleted', id);
  });
  await unlink(resolveStoredPath(doc.path)).catch(() => {});
  return true;
}
export async function extractAI(id: string, options: { background?: boolean } = {}) {
  const doc = db
    .prepare("SELECT * FROM documents WHERE id=? AND status='ready'")
    .get(id) as unknown as Doc | undefined;
  if (!doc) throw new Error('מסמך לא זמין');
  const entities = await extractDocumentEntities(doc.text, options);
  transaction(() => {
    if (
      !db
        .prepare('SELECT id FROM documents WHERE id=? AND updated=?')
        .get(id, (doc as Doc & { updated: string }).updated)
    )
      throw new Error('המסמך השתנה במהלך החילוץ');
    for (const e of entities) {
      if (
        typeof e.label !== 'string' ||
        typeof e.evidence !== 'string' ||
        !e.evidence.trim() ||
        !e.evidence.includes(e.label) ||
        !doc.text.includes(e.evidence) ||
        !['person', 'department', 'process', 'system'].includes(e.type) ||
        e.label.length > 100
      )
        continue;
      const label = e.label.normalize('NFKC').trim();
      if (!label || !doc.text.includes(label)) continue;
      const target = node(`${e.type}:${label}`, label, e.type);
      edge(id, target, 'mentions', id, e.evidence, 'ai', false);
    }
    audit('ai-extracted', id);
  });
}
