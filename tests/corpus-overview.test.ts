import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory = mkdtempSync(path.join(tmpdir(), 'brain-corpus-'));
process.env.BRAIN_DATA_DIR = directory;
process.env.RAG_EMBED_MODEL = ''; // No network inference in source-selection unit tests.
const { db } = await import('../server/store');
const { indexDocument } = await import('../server/ingest');
const { corpusContext, organizationSources, previousContext, matchQuotedEvidence, previousPerson } =
  await import('../server/answer-context');
after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
test('a verbatim quote identifies a source, while invented or ambiguous quotes cannot repair an ID', () => {
  const a = { id: 'E1', text: 'Exact source about company products.' },
    b = { id: 'E2', text: 'A different source about finance.' };
  assert.equal(matchQuotedEvidence([a, b], 'E2', 'Exact source about company products.'), a);
  assert.equal(matchQuotedEvidence([a, b], 'E1', 'fabricated source text'), undefined);
  assert.equal(matchQuotedEvidence([a, { ...a, id: 'E3' }], 'E8', a.text), undefined);
});
test('corpus context supplies real excerpts with exact provenance rather than business answer templates', () => {
  const file = path.resolve('test-data/demotech-organization/ORG-001.txt');
  const text = readFileSync(file, 'utf8');
  db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,NULL,?)').run(
    'REAL',
    'real.txt',
    'DemoTech',
    '',
    'queued',
    file,
    new Date().toISOString(),
  );
  indexDocument('REAL', text);
  const r = corpusContext();
  assert.equal(r.total, 1);
  assert.equal(r.sources.length, 1);
  assert.ok(text.includes(r.sources[0].text));
  assert.ok(!r.sources[0].text.startsWith('doc_id:'));
  assert.equal('answer' in r, false);
});
test('corpus context applies ACLs before excerpts and counts', () => {
  db.prepare('INSERT INTO document_acl VALUES(?,?)').run('REAL', 'alice');
  assert.deepEqual(corpusContext({ principals: ['bob'] }), { total: 0, sources: [] });
  assert.equal(corpusContext({ principals: ['alice'] }).total, 1);
});
test('organization context never substitutes a similar company', () => {
  assert.equal(organizationSources('Other Company').length, 0);
  assert.equal(organizationSources('DemoTech')[0].documentId, 'REAL');
  assert.equal(organizationSources('DemoTech', { principals: ['bob'] }).length, 0);
});
test('previous evidence must still exist and remain accessible', () => {
  const quote = organizationSources('DemoTech')[0].text;
  assert.equal(
    previousContext([{ documentId: 'REAL', quote }], { principals: ['alice'] }).length,
    1,
  );
  assert.equal(previousContext([{ documentId: 'REAL', quote }], { principals: ['bob'] }).length, 0);
  assert.equal(previousContext([{ documentId: 'REAL', quote: 'invented quotation' }]).length, 0);
});

test('ordinary AI answers require an exact quote and validate numbers against that quote alone', async () => {
  const { validateModelAnswer } = await import('../server/Services/AnswerValidationService');
  const quote = 'רונית לוי היא מנהלת הכספים של DemoTech.';
  const text = quote + '\n\nמחיר אחר במסמך: 9000.';
  db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,NULL,?)').run(
    'QUOTE-TEST',
    'quote.txt',
    'Quote test',
    text,
    'ready',
    'unused',
    new Date().toISOString(),
  );
  const sources = [{ documentId: 'QUOTE-TEST', title: 'Quote test', text, citation: 1 }];
  const evidence = [{ id: 'E1', source: 1, text }];
  const validate = (statement: object) =>
    validateModelAnswer(
      JSON.stringify({ statements: [statement] }),
      sources,
      evidence,
      false,
      false,
      false,
    );
  assert.equal(validate({ text: 'רונית לוי היא מנהלת הכספים.', evidence: 'E1' }).length, 0);
  assert.equal(
    validate({
      text: 'רונית לוי היא מנהלת הכספים.',
      evidence: 'E1',
      quote: 'ציטוט מומצא שאינו במסמך',
    }).length,
    0,
  );
  assert.equal(validate({ text: 'רונית לוי מאשרת 9000.', evidence: 'E1', quote }).length, 0);
  const accepted = validate({ text: 'רונית לוי היא מנהלת הכספים.', evidence: 'E1', quote });
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].quote, quote);
  assert.equal(text.slice(accepted[0].startOffset, accepted[0].endOffset), quote);
  db.prepare('DELETE FROM documents WHERE id=?').run('QUOTE-TEST');
});
test('person follow-ups resolve only one explicitly supported person in accessible prior evidence', () => {
  db.prepare('INSERT INTO nodes VALUES(?,?,?,NULL)').run('test-person', 'רונית לוי', 'person');
  db.prepare('INSERT INTO edges VALUES(?,?,?,?,?,?,?,?)').run(
    'test-owner',
    'REAL',
    'test-person',
    'owner',
    'REAL',
    'מנהלת הכספים: רונית לוי',
    'explicit',
    1,
  );
  const quote = organizationSources('DemoTech')[0].text;
  const prior = previousContext([{ documentId: 'REAL', quote }], { principals: ['alice'] });
  assert.equal(previousPerson('רונית לוי היא מנהלת הכספים', prior), 'רונית לוי');
  assert.equal(
    previousPerson(
      'רונית לוי',
      previousContext([{ documentId: 'REAL', quote }], { principals: ['bob'] }),
    ),
    undefined,
  );
  assert.equal(previousPerson('יעל ארז', prior), undefined);
  db.prepare('UPDATE edges SET verified=0 WHERE id=?').run('test-owner');
  assert.equal(previousPerson('רונית לוי', prior), undefined);
});
