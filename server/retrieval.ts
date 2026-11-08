import { accessPredicate, accessSql, db, type Access } from './store.js';
import { embeddingModel, vectorCandidates } from './vectors.js';
const stop = new Set(
  'מי מה של את על עם איך האם הוא היא הם הן זה זו או לא כל יש לי כמה עושים נדרש מהו ב ל ה ו the a an and or what which does do is are of to in on for organization company'.split(
    ' ',
  ),
);
export function terms(question: string) {
  return [
    ...new Set(
      (question.normalize('NFKC').match(/[\p{L}\p{N}-]+/gu) || [])
        .filter((t) => t.length > 1 && !stop.has(t))
        .flatMap((t) => {
          const variants = [t];
          if (t.length > 3 && /^[ובלהמכש]/.test(t)) variants.push(t.slice(1));
          return variants;
        }),
    ),
  ].slice(0, 35);
}
export type SearchOptions = { access?: Access; timings?: Record<string, number> };
export function retrieve(question: string, limit = 6, options: SearchOptions = {}) {
  const start = performance.now();
  const tokens = terms(question);
  if (!tokens.length) return [];
  const query = tokens.map((t) => '"' + t.replaceAll('"', '') + '"*').join(' OR ');
  const access = accessSql(options.access);
  const rows = db
    .prepare(
      `SELECT chunks.rowid AS chunkId,chunks.documentId,chunks.text,bm25(chunks) AS score,documents.title FROM chunks JOIN documents ON documents.id=chunks.documentId WHERE chunks MATCH ? AND documents.status='ready'${access.sql} ORDER BY score LIMIT 300`,
    )
    .all(query, ...access.args) as {
    chunkId: number;
    documentId: string;
    text: string;
    score: number;
    title: string;
  }[];
  const threshold = Math.max(0.00001, -(rows[0]?.score || 0) * 0.2);
  const seen = new Set<string>();
  const result = rows
    .filter((r) => {
      if (-r.score < threshold || seen.has(r.documentId)) return false;
      seen.add(r.documentId);
      return true;
    })
    .slice(0, limit)
    .map((r, i) => ({ ...r, citation: i + 1 }));
  if (options.timings) options.timings.lexicalMs = performance.now() - start;
  return result;
}
/** Hybrid retrieval: BM25 (FTS5) and exact vector search fused with Reciprocal Rank Fusion (k=60, Cormack et al. 2009). */
export async function searchSources(question: string, limit = 6, options: SearchOptions = {}) {
  if (!embeddingModel) return retrieve(question, limit, options);
  const lexical = retrieve(question, Math.max(limit, 15), options);
  const vectors = await vectorCandidates(question, 40, {
    allow: accessPredicate(options.access),
    timings: options.timings,
  });
  const start = performance.now();
  const ranked = new Map<
    number,
    {
      documentId: string;
      text: string;
      score: number;
      title: string;
      chunkId: number;
      similarity?: number;
    }
  >();
  const chunk = db.prepare(
    "SELECT chunks.documentId,chunks.text,documents.title FROM chunks JOIN documents ON documents.id=chunks.documentId WHERE chunks.rowid=? AND documents.status='ready'",
  );
  for (const [rank, item] of vectors.entries()) {
    const row = chunk.get(item.chunkId) as
      | { documentId: string; text: string; title: string }
      | undefined;
    if (row)
      ranked.set(item.chunkId, {
        ...row,
        chunkId: item.chunkId,
        score: 1 / (60 + rank),
        similarity: item.similarity,
      });
  }
  // The lexical query already returns the FTS rowid; no per-result lookup by text is needed.
  for (const [rank, item] of lexical.entries()) {
    const old = ranked.get(item.chunkId);
    ranked.set(item.chunkId, {
      ...item,
      score: (old?.score || 0) + 1 / (60 + rank),
      similarity: old?.similarity,
    });
  }
  const groups = new Map<string, typeof ranked extends Map<number, infer V> ? V[] : never>();
  for (const row of [...ranked.values()].sort((a, b) => b.score - a.score)) {
    const group = groups.get(row.documentId) || [];
    group.push(row);
    groups.set(row.documentId, group);
  }
  const next = db.prepare(
    'SELECT c.rowid AS chunkId,c.text FROM chunk_documents m JOIN chunks c ON c.rowid=m.chunkId WHERE m.documentId=? AND m.chunkId>? ORDER BY m.chunkId LIMIT 1',
  );
  const result = [...groups.values()]
    .sort((a, b) => b[0].score - a[0].score)
    .slice(0, limit)
    .map((rows, i) => {
      const chosen = rows.slice(0, 2);
      if (chosen.length === 1) {
        const neighbor = next.get(chosen[0].documentId, chosen[0].chunkId) as
          | { chunkId: number; text: string }
          | undefined;
        if (neighbor) chosen.push({ ...chosen[0], ...neighbor });
      }
      return {
        ...rows[0],
        text: chosen
          .sort((a, b) => a.chunkId - b.chunkId)
          .map((s) => s.text)
          .join('\n\n'),
        chunks: chosen.map((c) => ({ chunkId: c.chunkId, text: c.text })),
        citation: i + 1,
      };
    });
  if (options.timings) options.timings.fusionMs = performance.now() - start;
  return result;
}
