import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extract } from '../server/extractor';
import { documentMetadata, safeSlice, supportingSnippet } from '../server/metadata';

test('organization TXT extraction preserves the actual source and document identity', async () => {
  const filename = 'test-data/demotech-organization/ORG-001.txt';
  const raw = await readFile(filename, 'utf8');
  const text = await extract(path.resolve(filename));
  assert.equal(text, raw.trim());
  const metadata = documentMetadata(text);
  assert.equal(metadata.externalId, 'ORG-001');
  assert.ok(metadata.sourceType);
  assert.equal(metadata.title, 'DemoTech');
  assert.ok(text.includes(supportingSnippet(text, 'DemoTech')));
});
test('TXT decoding rejects invalid UTF-8 and binary files instead of indexing corrupted text', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brain-txt-'));
  try {
    for (const [name, bytes] of [
      ['invalid.txt', Buffer.from([0xc3, 0x28])],
      ['binary.txt', Buffer.from([65, 0, 66])],
    ] as const) {
      const file = path.join(directory, name);
      await writeFile(file, bytes);
      await assert.rejects(extract(file));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('two NUL characters inside otherwise valid UTF-8 prose are preserved visibly rather than rejected as a binary file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brain-nul-'));
  try {
    const file = path.join(directory, 'text.txt');
    await writeFile(file, 'Readable regression text '.repeat(100) + 'trailing null\u0000\u0000');
    const text = await extract(file);
    assert.ok(text.includes('trailing null'));
    assert.ok(text.includes('␀'));
    assert.ok(!text.includes('\u0000'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('overlapping chunks never split a Unicode surrogate pair and preserve evidence', () => {
  const text = 'a'.repeat(849) + '🧠' + 'b'.repeat(300) + '🚀';
  for (let start = 0; start < text.length; start += 850) {
    const chunk = safeSlice(text, start, start + 1100);
    assert.ok(text.includes(chunk));
    assert.ok(!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(chunk));
  }
  assert.equal(supportingSnippet(text, 'missing'), '');
});
