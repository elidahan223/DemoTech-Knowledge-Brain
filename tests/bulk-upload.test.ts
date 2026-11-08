import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadFiles, type UploadProgress } from '../src/upload-queue';
import { CLIENT_BATCH_BYTES, CLIENT_BATCH_FILES } from '../shared/upload-policy';
import { graphView, GRAPH_VIEW_LIMIT } from '../src/graph-view';
import { extract } from '../server/extractor';
import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('2,505 selected files are all transferred with bounded request sizes and accurate duplicate receipts', async () => {
  const files = Array.from({ length: 2505 }, (_, i) => new File(['fixture'], `document-${i}.docx`));
  let received = 0,
    calls = 0;
  let last: UploadProgress | undefined;
  const result = await uploadFiles(files, {
    signal: new AbortController().signal,
    onProgress: (p) => {
      last = p;
    },
    send: async (body) => {
      const batch = body.getAll('files') as File[];
      assert.ok(batch.length <= CLIENT_BATCH_FILES);
      assert.ok(batch.reduce((sum, f) => sum + f.size, 0) <= CLIENT_BATCH_BYTES);
      received += batch.length;
      calls++;
      return batch.map((_, i) => ({ id: 'doc', duplicate: i === 0 }));
    },
  });
  assert.equal(received, 2505);
  assert.equal(result.stopped, false);
  assert.equal(last?.handled, 2505);
  assert.equal(last?.duplicates, calls);
  assert.equal(last?.queued, 2505 - calls);
});
test('batch bytes are bounded even when each file is valid', async () => {
  const blob = new Blob([new Uint8Array(18 * 1024 * 1024)]);
  const files = Array.from({ length: 4 }, (_, i) => new File([blob], `big-${i}.pdf`));
  const lengths: number[] = [];
  await uploadFiles(files, {
    signal: new AbortController().signal,
    onProgress: () => {},
    send: async (body) => {
      const batch = body.getAll('files') as File[];
      lengths.push(batch.length);
      return batch.map(() => ({ id: 'doc' }));
    },
  });
  assert.deepEqual(lengths, [2, 2]);
});
test('stop finishes the current batch and leaves the remaining files unsent', async () => {
  const control = new AbortController();
  let requests = 0;
  const result = await uploadFiles(
    Array.from({ length: 100 }, (_, i) => new File(['fixture'], `${i}.docx`)),
    {
      signal: control.signal,
      onProgress: () => {},
      send: async (body) => {
        requests++;
        control.abort();
        return body.getAll('files').map(() => ({ id: 'saved' }));
      },
    },
  );
  assert.equal(requests, 1);
  assert.equal(result.stopped, true);
  assert.equal(result.progress.queued, CLIENT_BATCH_FILES);
  assert.equal(result.progress.failed, 0);
});
test('invalid selections and missing receipts do not become successful uploads', async () => {
  const invalid = await uploadFiles([new File(['x'], 'bad.exe'), new File(['x'], 'valid.docx')], {
    signal: new AbortController().signal,
    onProgress: () => {},
    send: async (body) => body.getAll('files').map(() => ({ id: 'saved' })),
  });
  assert.equal(invalid.progress.failed, 1);
  assert.equal(invalid.progress.queued, 1);
  await assert.rejects(
    uploadFiles([new File(['x'], 'valid.docx')], {
      signal: new AbortController().signal,
      onProgress: () => {},
      send: async () => [],
    }),
  );
});
test('large graph views stay bounded while searching and source selection cover the complete library', () => {
  const nodes = Array.from({ length: 3000 }, (_, i) => ({
    id: `DOC-${i}`,
    label: `מסמך ${i}`,
    type: 'document',
  }));
  const snapshot = JSON.stringify(nodes);
  assert.equal(graphView(nodes, [], 'all', '', []).nodes.length, GRAPH_VIEW_LIMIT);
  const focused = graphView(nodes, [], 'all', '', ['DOC-2998'], 'DOC-2999');
  assert.ok(focused.nodes.some((n) => n.id === 'DOC-2998'));
  assert.ok(focused.nodes.some((n) => n.id === 'DOC-2999'));
  const manyNeighbors = nodes.slice(1).map((n) => ({ source: 'DOC-0', target: n.id }));
  assert.ok(
    graphView(nodes, manyNeighbors, 'all', '', ['DOC-2999'], 'DOC-0').nodes.some(
      (n) => n.id === 'DOC-2999',
    ),
    'a cited source stays visible even when the selection has thousands of neighbors',
  );
  assert.equal(graphView(nodes, [], 'all', 'DOC-2999', []).nodes[0]?.id, 'DOC-2999');
  assert.equal(JSON.stringify(nodes), snapshot);
});
test('the reusable extraction worker recovers after a corrupt DOCX', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brain-extract-'));
  const corrupt = path.join(directory, 'corrupt.docx');
  await writeFile(corrupt, 'not a zip');
  try {
    await assert.rejects(extract(corrupt));
    assert.ok((await extract(path.resolve('docs', 'HR-001.docx'))).includes('HR-001'));
  } finally {
    await rm(corrupt);
    await rmdir(directory);
  }
});
