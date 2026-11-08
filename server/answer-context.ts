import { safeSlice } from './metadata.js';
import { accessSql, db, type Access } from './store.js';
export type AnswerSource = {
  documentId: string;
  title: string;
  text: string;
  citation: number;
  score?: number;
};
/** A quote may repair a mistaken model evidence ID only when its source is unambiguous. */
export function matchQuotedEvidence<T extends { id: string; text: string }>(
  evidence: T[],
  id: unknown,
  quote: unknown,
) {
  if (typeof quote !== 'string' || quote.trim().length < 12) return undefined;
  const text = quote.trim(),
    hint = evidence.find((e) => e.id === id && e.text.includes(text));
  if (hint) return hint;
  const matches = evidence.filter((e) => e.text.includes(text));
  return matches.length === 1 ? matches[0] : undefined;
}
export function previousPerson(answer: string, sources: AnswerSource[]) {
  if (!sources.length) return undefined;
  // Names are returned only if already present in BOTH the previous answer and
  // its currently accessible, validated quotes. No graph-only name is exposed.
  const rows = db
    .prepare(
      `SELECT DISTINCT n.label FROM nodes n JOIN edges e ON (e.source=n.id OR e.target=n.id) WHERE n.type='person' AND e.method='explicit' AND e.verified=1`,
    )
    .all() as { label: string }[];
  const people = rows
    .filter((p) => answer.includes(p.label) && sources.some((s) => s.text.includes(p.label)))
    .map((p) => p.label);
  return people.length === 1 ? people[0] : undefined;
}
export function contentExcerpt(text: string, limit: number) {
  const procedure = text.indexOf('הוראות ופרטי התהליך');
  if (procedure >= 0) text = text.slice(procedure + 'הוראות ופרטי התהליך'.length).trim();
  else if (/^doc_id:/m.test(text) && text.includes('\n---'))
    text = text.slice(text.indexOf('\n---') + 4).trim();
  return safeSlice(text, 0, limit).trim();
}
/** Collect context, never manufacture an answer. ACLs apply before selection. */
export function corpusContext(access?: Access) {
  const allowed = accessSql(access);
  const total = Number(
    db
      .prepare(`SELECT count(*) AS n FROM documents WHERE status='ready'${allowed.sql}`)
      .get(...allowed.args)?.n || 0,
  );
  const rows = db
    .prepare(
      `SELECT id,title,text FROM documents WHERE status='ready'${allowed.sql} ORDER BY title,id LIMIT 40`,
    )
    .all(...allowed.args) as { id: string; title: string; text: string }[];
  const budget = Math.max(160, Math.min(1600, Math.floor(11000 / Math.max(1, rows.length))));
  return {
    total,
    sources: rows.map((d, i) => ({
      documentId: d.id,
      title: d.title,
      text: contentExcerpt(d.text, budget),
      citation: i + 1,
    })),
  };
}
export function organizationSources(name: string, access?: Access): AnswerSource[] {
  const allowed = accessSql(access);
  return (
    db
      .prepare(
        `SELECT id,title,text FROM documents WHERE status='ready' AND title=? COLLATE NOCASE${allowed.sql} LIMIT 3`,
      )
      .all(name, ...allowed.args) as { id: string; title: string; text: string }[]
  ).map((d, i) => ({
    documentId: d.id,
    title: d.title,
    text: contentExcerpt(d.text, 1800),
    citation: i + 1,
  }));
}
export function previousContext(
  evidence: { documentId: string; quote: string }[],
  access?: Access,
): AnswerSource[] {
  const allowed = accessSql(access);
  return evidence
    .flatMap((e) => {
      const d = db
        .prepare(`SELECT id,title,text FROM documents WHERE id=? AND status='ready'${allowed.sql}`)
        .get(e.documentId, ...allowed.args) as
        | { id: string; title: string; text: string }
        | undefined;
      return d?.text.includes(e.quote)
        ? [{ documentId: d.id, title: d.title, text: e.quote, citation: 0 }]
        : [];
    })
    .map((s, i) => ({ ...s, citation: i + 1 }));
}
