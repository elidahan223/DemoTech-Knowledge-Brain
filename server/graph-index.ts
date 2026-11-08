import { randomUUID } from 'node:crypto';
import { extractAI } from './ingest.js';
import { documentMetadata, supportingSnippet } from './metadata.js';
import { audit, cleanOrphans, db, transaction } from './store.js';
type Document = { id: string; text: string; title: string };
function entity(label: string, type: string) {
  const normalized = label.normalize('NFKC').trim();
  const found = db
    .prepare('SELECT id FROM nodes WHERE type=? AND lower(label)=lower(?)')
    .get(type, normalized) as { id: string } | undefined;
  if (found) return found.id;
  const id = `${type}:${normalized}`;
  db.prepare('INSERT OR IGNORE INTO nodes VALUES(?,?,?,NULL)').run(id, normalized, type);
  return id;
}
function relationship(doc: Document, target: string, type: string, evidence: string) {
  if (!evidence || !doc.text.includes(evidence))
    throw new Error('Graph evidence is not in the source document');
  db.prepare('INSERT OR IGNORE INTO edges VALUES(?,?,?,?,?,?,?,1)').run(
    `${doc.id}:${target}:${type}:explicit`,
    doc.id,
    target,
    type,
    doc.id,
    evidence,
    'explicit',
  );
}
export function rebuildExplicitGraph(id: string) {
  const doc = db
    .prepare("SELECT id,title,text FROM documents WHERE id=? AND status='ready'")
    .get(id) as Document | undefined;
  if (!doc) throw new Error('מסמך לא זמין לגרף');
  transaction(() => {
    db.prepare("DELETE FROM edges WHERE documentId=? AND method='explicit'").run(id);
    const metadata = documentMetadata(doc.text);
    if (metadata.sourceType)
      relationship(
        doc,
        entity(metadata.sourceType, 'system'),
        'published_in',
        supportingSnippet(doc.text, `source_type: ${metadata.sourceType}`),
      );
    const identifiers = new Set(
      doc.text.match(/(?:dsid_[a-f0-9]{32}|[A-Z][A-Z0-9]{1,12}-\d+)/g) || [],
    );
    for (const token of identifiers) {
      const target = db
        .prepare(
          'SELECT id FROM documents WHERE id=? OR id=(SELECT documentId FROM document_aliases WHERE alias=?)',
        )
        .get(token, token) as { id: string } | undefined;
      if (target && target.id !== id)
        relationship(doc, target.id, 'references', supportingSnippet(doc.text, token));
      else if (!target && !token.startsWith('dsid_'))
        relationship(
          doc,
          entity(token, 'process'),
          'mentions_ticket',
          supportingSnippet(doc.text, token),
        );
    }
    const titles = new Set(
      [...doc.text.matchAll(/\[([^\]\n]{8,180})\]\([^)]*\)|["“]([^"”\n]{8,180})["”]/g)].map(
        (m) => m[1] || m[2],
      ),
    );
    for (const title of titles) {
      const matches = db.prepare('SELECT id FROM documents WHERE title=? LIMIT 2').all(title) as {
        id: string;
      }[];
      if (matches.length === 1 && matches[0].id !== id)
        relationship(doc, matches[0].id, 'references', supportingSnippet(doc.text, title));
    }
    for (const email of new Set(
      doc.text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [],
    ))
      relationship(
        doc,
        entity(email.toLowerCase(), 'person'),
        'mentions_email',
        supportingSnippet(doc.text, email),
      );
    for (const match of doc.text.matchAll(/https?:\/\/[^\s<>"'\\\])]+/g)) {
      try {
        const host = new URL(match[0]).hostname;
        relationship(
          doc,
          entity(host, 'system'),
          'mentions_host',
          supportingSnippet(doc.text, match[0]),
        );
      } catch {}
    }
    for (const match of doc.text.matchAll(
      /^(?:[-*]\s*)?(?:Owner|Assigned to|Assignee|DRI|בעל תפקיד אחראי)\s*[:：]\s*([^\n]{2,100})/gim,
    )) {
      const label = match[1].trim();
      if (doc.text.includes(label))
        relationship(
          doc,
          entity(label, /\bteam\b|^SRE$/i.test(label) ? 'department' : 'person'),
          'declares_owner',
          match[0],
        );
    }
    audit('explicit-graph', id);
    cleanOrphans();
  });
}
let running = false;
export function queueGraph(ids: string[], method: 'explicit' | 'ai') {
  const statement = db.prepare(
    "INSERT INTO graph_jobs(id,documentId,status,error,method,created) VALUES(?,?,'queued',NULL,?,?)",
  );
  let queued = 0;
  transaction(() => {
    for (const id of new Set(ids)) {
      if (!db.prepare("SELECT id FROM documents WHERE id=? AND status='ready'").get(id)) continue;
      if (
        db
          .prepare(
            "SELECT id FROM graph_jobs WHERE documentId=? AND method=? AND status IN ('queued','processing')",
          )
          .get(id, method)
      )
        continue;
      statement.run(randomUUID(), id, method, new Date().toISOString());
      queued++;
    }
  });
  setImmediate(() => void processGraphJobs());
  return queued;
}
export async function processGraphJobs() {
  if (running || process.env.BRAIN_PAUSE_BACKGROUND === '1') return;
  running = true;
  try {
    for (;;) {
      const job = db
        .prepare("SELECT * FROM graph_jobs WHERE status='queued' ORDER BY created LIMIT 1")
        .get() as { id: string; documentId: string; method: 'ai' | 'explicit' } | undefined;
      if (!job) break;
      db.prepare("UPDATE graph_jobs SET status='processing' WHERE id=?").run(job.id);
      try {
        if (job.method === 'ai') await extractAI(job.documentId, { background: true });
        else rebuildExplicitGraph(job.documentId);
        db.prepare("UPDATE graph_jobs SET status='done' WHERE id=?").run(job.id);
        audit('graph-job-done', job.documentId);
      } catch (error) {
        db.prepare("UPDATE graph_jobs SET status='error',error=? WHERE id=?").run(
          (error as Error).message,
          job.id,
        );
        audit('graph-job-error', job.documentId);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    running = false;
  }
}
