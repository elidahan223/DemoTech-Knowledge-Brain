import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory = mkdtempSync(path.join(tmpdir(), 'demotech-test-'));
process.env.BRAIN_DATA_DIR = directory;
process.env.RAG_EMBED_MODEL = ''; // Unit fixtures exercise extraction/FTS without network inference.
const { db, graph } = await import('../server/store.js');
const { seed, indexDocument, deleteDocument } = await import('../server/ingest.js');
const { retrieve } = await import('../server/rag.js');
await seed();
const csv = await readFile('questions_and_answers.csv', 'utf8');
after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
test('20 real DOCX documents are indexed and graph evidence is traceable', () => {
  assert.equal(db.prepare("SELECT count(*) AS n FROM documents WHERE status='ready'").get()?.n, 20);
  const g = graph();
  assert.ok(g.nodes.some((n) => n.type === 'person'));
  for (const edge of g.edges) {
    assert.ok(edge.documentId);
    assert.ok(edge.evidence);
    if (edge.verified) {
      const doc = db
        .prepare('SELECT text FROM documents WHERE id=?')
        .get(edge.documentId as string);
      assert.ok((doc?.text as string).includes(edge.evidence as string));
    }
  }
});
for (const line of csv.trim().split(/\r?\n/).slice(1)) {
  const cells = (line.match(/("(?:[^"]|"")*"|[^,]+)(?:,|$)/g) || []).map((c) =>
    c.replace(/,$/, '').replace(/^"|"$/g, '').replaceAll('""', '"'),
  );
  test('CSV retrieval: ' + cells[0], () => {
    const found = retrieve(cells[0]).map((s) => s.documentId);
    const expected = cells[2].split(';');
    assert.ok(
      expected.some((id) => found.includes(id)),
      JSON.stringify({ found, expected }),
    );
  });
}
test('unrelated and punctuation-only questions return no sources', () => {
  assert.deepEqual(retrieve('!!'), []);
  assert.deepEqual(retrieve('קנגורו בגלקסיית אנדרומדה'), []);
});
test('replacement removes old chunks and outgoing relations, deletion removes inbound relations', async () => {
  const id = 'TEST-DOC';
  db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,NULL,?)').run(
    id,
    'test.docx',
    'מסמך בדיקה',
    '',
    'queued',
    path.join(directory, 'missing.docx'),
    new Date().toISOString(),
  );
  indexDocument(id, 'מילתבדיקהייחודית הפניה FIN-001');
  assert.ok(retrieve('מילתבדיקהייחודית').some((s) => s.documentId === id));
  assert.ok(graph().edges.some((e) => e.source === id && e.target === 'FIN-001'));
  indexDocument(id, 'מילתעדכוןחדשה ללא הפניות');
  assert.equal(retrieve('מילתבדיקהייחודית').length, 0);
  assert.ok(!graph().edges.some((e) => e.source === id));
  await deleteDocument(id);
  assert.equal(retrieve('מילתעדכוןחדשה').length, 0);
  assert.ok(!graph().nodes.some((n) => n.id === id));
  await deleteDocument('FIN-001');
  assert.ok(
    !graph().edges.some(
      (e) => e.source === 'FIN-001' || e.target === 'FIN-001' || e.documentId === 'FIN-001',
    ),
  );
});
