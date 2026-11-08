import { OllamaError, url } from './ollama.js';
import { interactiveIdle } from './scheduler.js';
import { db, transaction } from './store.js';
import { runLocalModel } from './Services/LocalModelQueue.js';
import { assertLocalModelName } from './Settings/LocalAiPolicy.js';
export const embeddingModel = process.env.RAG_EMBED_MODEL ?? 'embeddinggemma:latest';
if (embeddingModel) assertLocalModelName(embeddingModel);
export const embeddingStats = {
  requests: 0,
  inputs: 0,
  providerMs: 0,
  vectors: 0,
  indexBytes: 0,
  searches: 0,
  searchMs: 0,
};

// Exact cosine search over one contiguous Float32Array of L2-normalised vectors.
// Measured on the Enterprise-3000 copy (17,285 × 768): 51 MB instead of 144 MB of JS heap for the previous
// Orama index, 0.09 s instead of 0.52 s to load, 13 ms instead of 18 ms per query, identical top-10 results.
// Exact search is linear (~0.8 µs per vector here): below ~100 ms up to ~100k chunks. An ANN index (HNSW)
// trades recall for speed and is only justified beyond that scale.
let dimensions = 0,
  count = 0;
let matrix = new Float32Array(0),
  slotChunk = new Int32Array(0);
const slotDocument: string[] = [];
const slotOf = new Map<number, number>();
const documentChunks = new Map<string, Set<number>>();
let loading: Promise<void> | undefined;

// exact=true when the final size is known (startup load); otherwise grow by 25% to amortise copies without doubling memory.
function reserve(rows: number, exact = false) {
  if (slotChunk.length >= rows) return;
  const capacity = exact ? rows : Math.max(rows, 1024, Math.ceil(slotChunk.length * 1.25));
  const nextMatrix = new Float32Array(capacity * dimensions);
  nextMatrix.set(matrix.subarray(0, count * dimensions));
  matrix = nextMatrix;
  const nextChunks = new Int32Array(capacity);
  nextChunks.set(slotChunk.subarray(0, count));
  slotChunk = nextChunks;
  embeddingStats.indexBytes = matrix.byteLength;
}
function drop(chunkId: number) {
  const slot = slotOf.get(chunkId);
  if (slot === undefined) return;
  const last = count - 1;
  documentChunks.get(slotDocument[slot])?.delete(chunkId);
  if (slot !== last) {
    matrix.copyWithin(slot * dimensions, last * dimensions, (last + 1) * dimensions);
    slotChunk[slot] = slotChunk[last];
    slotDocument[slot] = slotDocument[last];
    slotOf.set(slotChunk[slot], slot);
  }
  slotOf.delete(chunkId);
  slotDocument.length = last;
  count = last;
  embeddingStats.vectors = count;
}
function add(chunkId: number, documentId: string, vector: ArrayLike<number>) {
  if (!dimensions) dimensions = vector.length;
  if (vector.length !== dimensions) throw new Error('Embedding dimensions changed');
  drop(chunkId);
  reserve(count + 1);
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += vector[i] * vector[i];
  norm = Math.sqrt(norm) || 1;
  const offset = count * dimensions;
  for (let i = 0; i < dimensions; i++) matrix[offset + i] = vector[i] / norm;
  slotChunk[count] = chunkId;
  slotDocument[count] = documentId;
  slotOf.set(chunkId, count);
  let chunks = documentChunks.get(documentId);
  if (!chunks) {
    chunks = new Set();
    documentChunks.set(documentId, chunks);
  }
  chunks.add(chunkId);
  count++;
  embeddingStats.vectors = count;
}
const floats = (blob: Uint8Array) =>
  new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));

export async function embed(input: string[], options: { background?: boolean } = {}) {
  return runLocalModel(async () => {
    if (!embeddingModel) throw new Error('No local embedding model configured');
    const start = Date.now();
    let response: Response;
    try {
      response = await fetch(new URL('/api/embed', url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: embeddingModel, input, truncate: false, keep_alive: '30m' }),
        signal: AbortSignal.timeout(300000),
      });
    } catch {
      throw new OllamaError();
    }
    if (!response.ok)
      throw new OllamaError(
        `מודל ה-Embeddings המקומי ${embeddingModel} אינו זמין: HTTP ${response.status}.`,
        response.status === 429 || response.status >= 500,
      );
    const result = (await response.json()) as { embeddings?: number[][] };
    const vectors = result.embeddings;
    if (
      !Array.isArray(vectors) ||
      vectors.length !== input.length ||
      vectors.some((v) => !v.length || v.some((x) => !Number.isFinite(x)))
    )
      throw new Error('Invalid embedding response');
    embeddingStats.requests++;
    embeddingStats.inputs += input.length;
    embeddingStats.providerMs += Date.now() - start;
    return vectors;
  }, options.background);
}
export function loadVectors() {
  if (!embeddingModel) return Promise.resolve();
  // A shared promise: concurrent callers must not load (and insert) the same vectors twice.
  loading ??= (async () => {
    const existing = db.prepare('SELECT DISTINCT model,dimensions FROM embeddings').all() as {
      model: string;
      dimensions: number;
    }[];
    if (existing.some((e) => e.model !== embeddingModel))
      throw new Error(
        'The repository contains a different embedding model; rebuild the vector index explicitly',
      );
    if (existing.length > 1)
      throw new Error('The vector index contains mixed dimensions; rebuild it explicitly');
    if (existing[0]) {
      dimensions = existing[0].dimensions;
      reserve(
        Number((db.prepare('SELECT count(*) AS n FROM embeddings').get() as { n: number }).n),
        true,
      );
    }
    const page = db.prepare(
      'SELECT chunkId,documentId,vector FROM embeddings WHERE chunkId>? ORDER BY chunkId LIMIT 2000',
    );
    for (let last = -1; ; ) {
      const rows = page.all(last) as unknown as {
        chunkId: number;
        documentId: string;
        vector: Uint8Array;
      }[];
      if (!rows.length) break;
      for (const row of rows) {
        add(row.chunkId, row.documentId, floats(row.vector));
        last = row.chunkId;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();
  return loading;
}
export async function removeVectors(documentId: string) {
  await loadVectors();
  for (const id of [...(documentChunks.get(documentId) || [])]) drop(id);
  documentChunks.delete(documentId);
  db.prepare('DELETE FROM embeddings WHERE documentId=?').run(documentId);
}
export async function indexVectors(documentId: string, title: string) {
  if (!embeddingModel) return;
  await loadVectors();
  const chunks = db
    .prepare(
      'SELECT c.rowid AS id,c.text FROM chunk_documents m JOIN chunks c ON c.rowid=m.chunkId WHERE m.documentId=? ORDER BY m.chunkId',
    )
    .all(documentId) as { id: number; text: string }[];
  const complete: { id: number; vector: number[] }[] = [];
  for (let start = 0; start < chunks.length; start += 16) {
    await interactiveIdle();
    const part = chunks.slice(start, start + 16);
    const vectors = await embed(
      part.map((c) => `title: ${title} | text: ${c.text}`),
      { background: true },
    );
    part.forEach((c, i) => complete.push({ id: c.id, vector: vectors[i] }));
  }
  const insert = db.prepare('INSERT INTO embeddings VALUES(?,?,?,?,?)');
  transaction(() => {
    db.prepare('DELETE FROM embeddings WHERE documentId=?').run(documentId);
    for (const item of complete)
      insert.run(
        item.id,
        documentId,
        embeddingModel,
        item.vector.length,
        Buffer.from(Float32Array.from(item.vector).buffer),
      );
  });
  for (const id of [...(documentChunks.get(documentId) || [])]) drop(id);
  for (const item of complete) add(item.id, documentId, item.vector);
}
/** Exact top-k cosine search. `allow` filters documents before ranking (permissions). */
export function nearest(
  query: ArrayLike<number>,
  limit = 40,
  minimum = 0.2,
  allow?: (documentId: string) => boolean,
) {
  const start = performance.now();
  if (!count || query.length !== dimensions) return [];
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += query[i] * query[i];
  norm = Math.sqrt(norm) || 1;
  const q = new Float32Array(dimensions);
  for (let i = 0; i < dimensions; i++) q[i] = query[i] / norm;
  const k = Math.max(1, limit),
    scores = new Float64Array(k).fill(-Infinity),
    slots = new Int32Array(k).fill(-1);
  let weakest = 0;
  for (let slot = 0; slot < count; slot++) {
    if (allow && !allow(slotDocument[slot])) continue;
    let dot = 0;
    const offset = slot * dimensions;
    for (let i = 0; i < dimensions; i++) dot += matrix[offset + i] * q[i];
    if (dot > scores[weakest]) {
      scores[weakest] = dot;
      slots[weakest] = slot;
      weakest = 0;
      for (let j = 1; j < k; j++) if (scores[j] < scores[weakest]) weakest = j;
    }
  }
  const hits = [];
  for (let j = 0; j < k; j++)
    if (slots[j] >= 0 && scores[j] >= minimum)
      hits.push({
        chunkId: slotChunk[slots[j]],
        documentId: slotDocument[slots[j]],
        similarity: scores[j],
      });
  embeddingStats.searches++;
  embeddingStats.searchMs += performance.now() - start;
  return hits.sort((a, b) => b.similarity - a.similarity);
}
export async function vectorCandidates(
  question: string,
  limit = 40,
  options: { allow?: (documentId: string) => boolean; timings?: Record<string, number> } = {},
) {
  if (!embeddingModel) return [];
  await loadVectors();
  if (!count) return [];
  let t = performance.now();
  const vector = (await embed([`task: search result | query: ${question}`]))[0];
  if (options.timings) options.timings.queryEmbedMs = performance.now() - t;
  t = performance.now();
  const hits = nearest(vector, limit, 0.2, options.allow);
  if (options.timings) options.timings.vectorSearchMs = performance.now() - t;
  return hits;
}
