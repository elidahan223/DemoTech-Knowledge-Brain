import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { graphStatistics } from '../server/graph-audit';
const directory = mkdtempSync(path.join(tmpdir(), 'brain-graph-audit-'));
process.env.BRAIN_DATA_DIR = directory;
process.env.BRAIN_SEED_DEMO = '0';
process.env.RAG_EMBED_MODEL = ''; // No network inference in graph unit tests.
const { db } = await import('../server/store');
const { indexDocument } = await import('../server/ingest');
const { map } = await import('../server/catalog');
const { documentLinks, explainDocumentLink } = await import('../server/document-links');
const { answer } = await import('../server/rag');
after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
function add(id: string, text: string) {
  db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,NULL,?)').run(
    id,
    id + '.txt',
    id,
    '',
    'queued',
    path.join(directory, id + '.txt'),
    new Date().toISOString(),
  );
  indexDocument(id, text);
}
test('graph statistics distinguish isolated nodes, disconnected components and dangling edges', () => {
  const s = graphStatistics(
    ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'document' })),
    [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
      { source: 'b', target: 'missing' },
    ],
  );
  assert.equal(s.isolatedNodes, 2);
  assert.equal(s.connectedComponents, 3);
  assert.equal(s.largestComponent, 2);
  assert.equal(s.danglingEdges, 1);
  assert.deepEqual(s.degreeDistribution, { '0': 2, '1': 2 });
});
test('map never drops a lexicographically late center when neighbours exceed the cap', () => {
  add('ZZZ-CENTER', 'center');
  for (let i = 0; i < 8; i++) {
    add('AAA-' + i, 'references ZZZ-CENTER');
  }
  const view = map({ center: 'ZZZ-CENTER', limit: '2' });
  assert.ok(view.nodes.some((n) => n.id === 'ZZZ-CENTER'));
  assert.equal(view.nodes.length, 2);
  assert.equal(view.totalMatching, 9);
  assert.ok('omittedNeighbors' in view);
  assert.equal(view.omittedNeighbors, 7);
});
test('document aliases change atomically and late document arrivals resolve literal references', () => {
  add('ALIAS-A', 'doc_id: ext-old\nsource_type: jira\n---\ntext');
  indexDocument('ALIAS-A', 'doc_id: ext-new\nsource_type: slack\n---\nupdated');
  assert.equal(
    db.prepare("SELECT documentId FROM document_aliases WHERE alias='ext-old'").get(),
    undefined,
  );
  add('BEFORE', 'Reference ext-later in this source.');
  add('AFTER', 'doc_id: ext-later\n---\nTarget document.');
  assert.ok(
    db
      .prepare(
        "SELECT id FROM edges WHERE source='BEFORE' AND target='AFTER' AND type='references'",
      )
      .get(),
  );
  assert.throws(() => indexDocument('ALIAS-A', 'doc_id: ext-later\n---\nwrong identity'));
  assert.ok(db.prepare("SELECT documentId FROM document_aliases WHERE alias='ext-new'").get());
});
test('a declared DOCX document ID maps imported GUIDs to literal cross-document references', () => {
  add('UPLOADED-GUID-A', 'מזהה מסמך: DOCX-REF-001 | מחלקה: IT\nRelated: DOCX-REF-002');
  add('UPLOADED-GUID-B', 'מזהה מסמך: DOCX-REF-002 | מחלקה: IT\nTarget body');
  assert.equal(
    db.prepare("SELECT documentId FROM document_aliases WHERE alias='DOCX-REF-002'").get()
      ?.documentId,
    'UPLOADED-GUID-B',
  );
  assert.ok(
    db
      .prepare(
        "SELECT id FROM edges WHERE source='UPLOADED-GUID-A' AND target='UPLOADED-GUID-B' AND type='references'",
      )
      .get(),
  );
});
test('shared topics have two exact quotes and are not claimed to be verified or semantic similarity', () => {
  add('TOPIC-A', '## Region-specific recovery policy\nKeep a local recovery log.');
  add('TOPIC-B', '## Region-specific recovery policy\nRecord each restore attempt.');
  add('TOPIC-C', 'Unrelated information.');
  const links = documentLinks('TOPIC-A');
  const e = links.find((e) => e.target === 'TOPIC-B')!;
  assert.ok(e);
  assert.equal(e.type, 'shared_topic');
  assert.equal(e.verified, 0);
  assert.equal(e.confidence, null);
  assert.equal(e.persisted, false);
  assert.equal(explainDocumentLink(e.id)?.id, e.id);
  assert.ok(!links.some((e) => e.target === 'TOPIC-C'));
  for (const [id, quote] of [
    [e.source, e.evidence],
    [e.target, e.otherEvidence],
  ])
    assert.ok(
      String(db.prepare('SELECT text FROM documents WHERE id=?').get(id)?.text).includes(quote),
    );
});
test('search includes real neighbours instead of falsely isolating the matching document', () => {
  const view = map({ search: 'AAA-0' });
  assert.ok(view.edges.length > 0);
  assert.ok(view.nodes.some((n) => n.id === 'ZZZ-CENTER'));
});
test('restricted prior-answer context is rejected before calling the model', async () => {
  add('PRIVATE-DOC', 'Private phrase not for translation');
  db.prepare('INSERT INTO document_acl VALUES(?,?)').run('PRIVATE-DOC', 'alice');
  const result = await answer(
    'תתרגם',
    {
      question: 'previous',
      evidence: [{ documentId: 'PRIVATE-DOC', quote: 'Private phrase not for translation' }],
    },
    { principals: ['bob'] },
  );
  assert.equal(result.mode, 'no-sources');
  assert.deepEqual(result.sources, []);
});
test('enqueue does not restart background processing when the server is paused', async () => {
  process.env.BRAIN_PAUSE_BACKGROUND = '1';
  try {
    db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,NULL,?)').run(
      'PAUSED',
      'paused.txt',
      'paused',
      '',
      'queued',
      path.join(directory, 'missing.txt'),
      new Date().toISOString(),
    );
    const { enqueue } = await import('../server/ingest');
    enqueue('PAUSED');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(
      db.prepare("SELECT status FROM documents WHERE id='PAUSED'").get()?.status,
      'queued',
    );
  } finally {
    delete process.env.BRAIN_PAUSE_BACKGROUND;
  }
});
test('an illustrative email value is not evidence of a real shared person', async () => {
  const { rebuildExplicitGraph } = await import('../server/graph-index');
  add('EXAMPLE-A', '| user_email | string | alice@acme.com | PII |');
  add('EXAMPLE-B', 'Contact: alice@acme.com');
  rebuildExplicitGraph('EXAMPLE-A');
  rebuildExplicitGraph('EXAMPLE-B');
  assert.ok(!documentLinks('EXAMPLE-A').some((e) => e.target === 'EXAMPLE-B'));
});
test('restart recovery clears stale processing badges without deleting text or retry history', async () => {
  const { recoverPendingJobs } = await import('../server/ingest');
  db.prepare(
    "UPDATE documents SET status='embedding',text='preserved text' WHERE id='PAUSED'",
  ).run();
  db.prepare("UPDATE jobs SET status='processing',attempts=2 WHERE documentId='PAUSED'").run();
  recoverPendingJobs();
  assert.equal(
    db.prepare("SELECT status FROM documents WHERE id='PAUSED'").get()?.status,
    'queued',
  );
  assert.equal(
    db.prepare("SELECT text FROM documents WHERE id='PAUSED'").get()?.text,
    'preserved text',
  );
  assert.equal(
    db.prepare("SELECT attempts FROM jobs WHERE documentId='PAUSED'").get()?.attempts,
    2,
  );
});
