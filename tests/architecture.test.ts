import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory = mkdtempSync(path.join(tmpdir(), 'demotech-architecture-'));
process.env.BRAIN_DATA_DIR = directory;
process.env.BRAIN_SEED_DEMO = '0';
process.env.RAG_EMBED_MODEL = 'test-embedding';
const { db } = await import('../server/store.js');
const {
  indexDocument,
  deleteDocument,
  enqueue,
  cancelJobs,
  resumeJobs,
  jobSummary,
  transientError,
  retryDelayMs,
} = await import('../server/ingest.js');
const { retrieve } = await import('../server/rag.js');
const { loadVectors, nearest, removeVectors } = await import('../server/vectors.js');
const { map, nodeDetails } = await import('../server/catalog.js');
const { interactive, interactiveIdle, interactiveActive } = await import('../server/scheduler.js');
after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
const now = () => new Date().toISOString();
function addDocument(id: string, text: string, status = 'queued') {
  db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,NULL,?)').run(
    id,
    id + '.txt',
    id,
    '',
    status,
    path.join(directory, 'files', id + '.txt'),
    now(),
  );
  indexDocument(id, text);
  db.prepare("UPDATE documents SET status='ready' WHERE id=?").run(id);
}
const frontMatter = (id: string, type: string, body: string) =>
  `doc_id: ext-${id}\ntitle: Title ${id}\nsource_type: ${type}\n---\n${body}`;

test('exact vector index returns the brute-force top-k, honours removal and filters before ranking', async () => {
  const dims = 32;
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const vectors = new Map<number, number[]>();
  for (let d = 0; d < 20; d++) {
    addDocument(`VEC-${d}`, `vector document ${d}`);
    const chunkId = (
      db.prepare('SELECT chunkId FROM chunk_documents WHERE documentId=?').get(`VEC-${d}`) as {
        chunkId: number;
      }
    ).chunkId;
    const v = Array.from({ length: dims }, random);
    vectors.set(chunkId, v);
    db.prepare('INSERT INTO embeddings VALUES(?,?,?,?,?)').run(
      chunkId,
      `VEC-${d}`,
      'test-embedding',
      dims,
      Buffer.from(Float32Array.from(v).buffer),
    );
  }
  await loadVectors();
  await loadVectors(); // a second call must not duplicate vectors
  const cosine = (a: number[], b: number[]) => {
    let dot = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / Math.sqrt(na * nb);
  };
  const query = Array.from({ length: dims }, random);
  const expected = [...vectors]
    .map(([id, v]) => ({ id, s: cosine(query, v) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  const hits = nearest(query, 5, -1);
  assert.deepEqual(
    hits.map((h) => h.chunkId),
    expected.map((e) => e.id),
  );
  for (const [i, h] of hits.entries()) assert.ok(Math.abs(h.similarity - expected[i].s) < 1e-5);
  assert.equal(new Set(nearest(query, 40, -1).map((h) => h.chunkId)).size, 20);
  const top = hits[0].documentId;
  await removeVectors(top);
  assert.ok(!nearest(query, 40, -1).some((h) => h.documentId === top));
  assert.ok(nearest(query, 40, -1, (id) => id === 'VEC-3').every((h) => h.documentId === 'VEC-3'));
});

test('chunk→document map stays consistent through indexing, replacement and deletion', async () => {
  addDocument('MAP-1', 'alpha '.repeat(600));
  const mapped = () =>
    Number(
      (
        db.prepare("SELECT count(*) AS n FROM chunk_documents WHERE documentId='MAP-1'").get() as {
          n: number;
        }
      ).n,
    );
  const fts = () =>
    Number(
      (
        db.prepare("SELECT count(*) AS n FROM chunks WHERE documentId='MAP-1'").get() as {
          n: number;
        }
      ).n,
    );
  assert.ok(mapped() > 1);
  assert.equal(mapped(), fts());
  indexDocument('MAP-1', 'short replacement text');
  assert.equal(mapped(), 1);
  assert.equal(fts(), 1);
  await deleteDocument('MAP-1');
  assert.equal(mapped(), 0);
  assert.equal(fts(), 0);
  assert.equal(
    Number(
      (
        db
          .prepare(
            'SELECT count(*) AS n FROM chunk_documents WHERE chunkId NOT IN (SELECT rowid FROM chunks)',
          )
          .get() as { n: number }
      ).n,
    ),
    0,
  );
});

test('document ACLs filter lexical retrieval before ranking; the local desktop keeps full access', () => {
  addDocument('ACL-OPEN', 'zebracode public procedure');
  addDocument('ACL-HR', 'zebracode restricted salary procedure');
  db.prepare("INSERT INTO document_acl VALUES('ACL-HR','group:hr')").run();
  const ids = (access?: { principals: string[] }) =>
    retrieve('zebracode', 6, { access })
      .map((s) => s.documentId)
      .sort();
  assert.deepEqual(ids(), ['ACL-HR', 'ACL-OPEN']);
  assert.deepEqual(ids({ principals: ['user:dana'] }), ['ACL-OPEN']);
  assert.deepEqual(ids({ principals: ['user:dana', 'group:hr'] }), ['ACL-HR', 'ACL-OPEN']);
});

test('queue: no duplicate active jobs, cancellation, resume and transient-error classification', async () => {
  db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,NULL,?)').run(
    'JOB-1',
    'job.txt',
    'job',
    '',
    'queued',
    path.join(directory, 'files', 'missing.txt'),
    now(),
  );
  const first = enqueue('JOB-1');
  assert.equal(enqueue('JOB-1'), first);
  assert.equal(cancelJobs(['JOB-1']), 1);
  assert.equal(
    (db.prepare("SELECT status FROM documents WHERE id='JOB-1'").get() as { status: string })
      .status,
    'cancelled',
  );
  assert.equal(jobSummary().counts.cancelled, 1);
  assert.equal(resumeJobs(), 1);
  for (
    let i = 0;
    i < 100 &&
    (db.prepare("SELECT status FROM documents WHERE id='JOB-1'").get() as { status: string })
      .status !== 'error';
    i++
  )
    await new Promise((r) => setTimeout(r, 20));
  const failed = db
    .prepare("SELECT status,attempts FROM jobs WHERE documentId='JOB-1' AND status='error'")
    .get() as { status: string; attempts: number };
  assert.equal(failed.attempts, 1, 'a missing file is permanent and must not be retried');
  assert.ok(transientError(new Error('fetch failed')));
  assert.ok(transientError(new Error('Embeddings HTTP 503: busy')));
  assert.ok(!transientError(new Error('Invalid embedding response')));
  assert.equal(retryDelayMs(1), 5000);
  assert.equal(retryDelayMs(3), 20000);
  assert.equal(retryDelayMs(20), 300000);
});

test('map API starts focused; explicit overview and community expansion remain available', () => {
  assert.equal(map({}).mode, 'focused-empty');
  assert.equal(map({ overview: '1' }).mode, 'full');
  for (let i = 0; i < 270; i++)
    addDocument(
      `BULK-${i}`,
      frontMatter(
        String(i),
        i % 3 === 0 ? 'slack' : i % 3 === 1 ? 'jira' : 'gmail',
        `body ${i} owner: Dana Levi\nOwner: Dana Levi`,
      ),
    );
  const overview = map({ overview: '1' }) as unknown as {
    mode: string;
    nodes: { id: string; type: string; count?: number }[];
    edges: unknown[];
  };
  assert.equal(overview.mode, 'overview');
  const communities = overview.nodes.filter((n) => n.type === 'community');
  assert.ok(communities.some((n) => n.id === 'group:source:slack' && n.count === 90));
  assert.ok(overview.nodes.length < 60, 'overview must not list documents');
  const group = map({ group: 'source:jira', limit: '50' }) as unknown as {
    mode: string;
    nodes: { type: string }[];
    hasMore: boolean;
    totalMatching: number;
  };
  assert.equal(group.mode, 'group');
  assert.equal(group.nodes.filter((n) => n.type === 'document').length, 50);
  assert.ok(group.hasMore);
  assert.equal(group.totalMatching, 90);
  const focus = map({ ids: 'BULK-1,BULK-2' }) as unknown as {
    mode: string;
    nodes: { id: string }[];
  };
  assert.equal(focus.mode, 'focus');
  assert.ok(focus.nodes.some((n) => n.id === 'BULK-1'));
  const details = nodeDetails('BULK-1')!;
  assert.ok(details.total >= 1);
  assert.ok(details.relationships.every((r) => typeof r.evidence === 'string'));
});

test('background work waits while an interactive request is running', async () => {
  let release!: () => void;
  const blocker = new Promise<void>((r) => (release = r));
  const request = interactive(() => blocker);
  assert.equal(interactiveActive(), 1);
  let resumed = false;
  const background = interactiveIdle().then(() => {
    resumed = true;
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(resumed, false);
  release();
  await request;
  await background;
  assert.equal(resumed, true);
  assert.equal(interactiveActive(), 0);
});
