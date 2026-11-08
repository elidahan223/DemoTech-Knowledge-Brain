import { supportingSnippet } from './metadata.js';
import { db } from './store.js';
type Doc = { id: string; title: string; text: string };
export type DocumentLink = {
  id: string;
  source: string;
  target: string;
  sourceTitle: string;
  targetTitle: string;
  type: 'shared_entity' | 'shared_topic';
  documentId: string;
  method: 'derived';
  verified: number;
  evidence: string;
  otherEvidence: string;
  otherDocumentId: string;
  reason: string;
  basis: string;
  score: number;
  scoreMeaning: string;
  confidence: null;
  persisted: false;
};
const genericHosts = new Set([
  'github.com',
  'docs.google.com',
  'drive.google.com',
  'example.com',
  'localhost',
]);
const encode = (a: string, b: string, basis: string, type: string) =>
  'related:' + Buffer.from(JSON.stringify([a, b, basis, type])).toString('base64url');
function illustrative(doc: Doc, label: string) {
  const position = doc.text.indexOf(label);
  if (position < 0) return true;
  const line = doc.text.slice(
    doc.text.lastIndexOf('\n', position) + 1,
    doc.text.indexOf('\n', position) < 0 ? undefined : doc.text.indexOf('\n', position),
  );
  const nearby = doc.text.slice(Math.max(0, position - 90), position + label.length + 90);
  return (
    /\b(?:e\.g\.|example|sample|dummy|placeholder|illustrative)\b/i.test(nearby) ||
    (/\|\s*(?:string|email)\s*\|/i.test(line) && /@/.test(label))
  );
}
function topicLines(text: string) {
  return [
    ...new Set(
      [...text.matchAll(/^#{1,4}\s+([^\n]{12,100})\s*$/gm)]
        .map((m) => m[1].trim())
        .filter(
          (s) =>
            !/^(?:purpose|overview|summary|table of contents|references|action items|next steps|preconditions|quick reference|acceptance criteria|background|introduction|סיכום|רקע|תוכן עניינים)$/i.test(
              s,
            ),
        ),
    ),
  ].slice(0, 4);
}
export function documentLinks(id: string, limit = 20): DocumentLink[] {
  const source = db
    .prepare("SELECT id,title,text FROM documents WHERE id=? AND status='ready'")
    .get(id) as Doc | undefined;
  if (!source) return [];
  const result: DocumentLink[] = [];
  const seen = new Set<string>();
  const add = (
    target: Doc,
    type: DocumentLink['type'],
    basis: string,
    quote: string,
    otherQuote: string,
    frequency: number,
  ) => {
    if (
      target.id === id ||
      seen.has(target.id) ||
      !source.text.includes(quote) ||
      !target.text.includes(otherQuote) ||
      !quote ||
      !otherQuote
    )
      return;
    seen.add(target.id);
    result.push({
      id: encode(id, target.id, basis, type),
      source: id,
      target: target.id,
      sourceTitle: source.title,
      targetTitle: target.title,
      type,
      documentId: id,
      method: 'derived',
      verified: 0,
      evidence: quote,
      otherEvidence: otherQuote,
      otherDocumentId: target.id,
      basis,
      reason:
        type === 'shared_entity'
          ? `שני המסמכים מזכירים במפורש את הישות: ${basis}`
          : `כותרת סעיף זהה בשני המסמכים: ${basis}`,
      score: 1 / Math.log2(2 + frequency),
      scoreMeaning: 'rarity ranking weight, not semantic similarity or probability',
      confidence: null,
      persisted: false,
    });
  };
  const rows = db
    .prepare(
      `SELECT n.id,n.label,n.type,count(DISTINCT allEdges.documentId) AS frequency FROM edges e JOIN nodes n ON n.id=e.target JOIN edges allEdges ON allEdges.target=n.id AND allEdges.verified=1 WHERE e.source=? AND e.verified=1 AND e.type!='published_in' AND n.type!='document' GROUP BY n.id HAVING frequency BETWEEN 2 AND 100 ORDER BY frequency,n.id LIMIT 12`,
    )
    .all(id) as { id: string; label: string; type: string; frequency: number }[];
  for (const entity of rows) {
    if (genericHosts.has(entity.label.toLowerCase())) continue;
    if (illustrative(source, entity.label)) continue;
    const first = db
      .prepare(
        "SELECT evidence FROM edges WHERE source=? AND target=? AND verified=1 AND type!='published_in' LIMIT 1",
      )
      .get(id, entity.id) as { evidence: string };
    const others = db
      .prepare(
        `SELECT d.id,d.title,d.text,e.evidence FROM edges e JOIN documents d ON d.id=e.documentId WHERE e.target=? AND e.source=e.documentId AND e.documentId!=? AND e.verified=1 AND d.status='ready' AND e.type!='published_in' GROUP BY d.id ORDER BY d.id LIMIT ?`,
      )
      .all(entity.id, id, limit) as (Doc & { evidence: string })[];
    for (const other of others)
      if (!illustrative(other, entity.label))
        add(other, 'shared_entity', entity.label, first.evidence, other.evidence, entity.frequency);
    if (result.length >= limit) return result.slice(0, limit);
  }
  for (const topic of topicLines(source.text)) {
    const query = '"' + topic.replaceAll('"', '""') + '"';
    const candidates = db
      .prepare('SELECT DISTINCT documentId FROM chunks WHERE chunks MATCH ? LIMIT 61')
      .all(query) as { documentId: string }[];
    if (candidates.length > 60) continue;
    for (const candidate of candidates) {
      if (candidate.documentId === id) continue;
      const other = db
        .prepare("SELECT id,title,text FROM documents WHERE id=? AND status='ready'")
        .get(candidate.documentId) as Doc | undefined;
      if (other && topicLines(other.text).includes(topic))
        add(
          other,
          'shared_topic',
          topic,
          supportingSnippet(source.text, topic),
          supportingSnippet(other.text, topic),
          candidates.length,
        );
    }
    if (result.length >= limit) break;
  }
  return result.slice(0, limit);
}
export function explainDocumentLink(id: string) {
  try {
    if (!id.startsWith('related:') || id.length > 2500) return undefined;
    const data = JSON.parse(Buffer.from(id.slice(8), 'base64url').toString('utf8'));
    if (!Array.isArray(data) || data.length !== 4 || data.some((x) => typeof x !== 'string'))
      return undefined;
    return documentLinks(data[0], 40).find((e) => e.id === id);
  } catch {
    return undefined;
  }
}
