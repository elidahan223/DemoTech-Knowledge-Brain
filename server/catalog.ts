import { GRAPH_VIEW_LIMIT } from '../shared/graph-policy.js';
import { documentLinks } from './document-links.js';
import { db } from './store.js';
const integer = (v: unknown, fallback: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};
export function state() {
  const documents = db
    .prepare('SELECT status,count(*) AS count FROM documents GROUP BY status')
    .all() as { status: string; count: number }[];
  return {
    revision: Number(db.prepare('SELECT coalesce(max(id),0) AS n FROM audit').get()?.n),
    documents,
    totalDocuments: documents.reduce((s, d) => s + d.count, 0),
    readyDocuments: documents.find((d) => d.status === 'ready')?.count || 0,
    totalNodes: Number(db.prepare('SELECT count(*) AS n FROM nodes').get()?.n),
    totalEdges: Number(db.prepare('SELECT count(*) AS n FROM edges').get()?.n),
    verifiedEdges: Number(db.prepare('SELECT count(*) AS n FROM edges WHERE verified=1').get()?.n),
    backgroundPaused: process.env.BRAIN_PAUSE_BACKGROUND === '1',
  };
}
export function library(query: Record<string, unknown>) {
  const page = integer(query.page, 0, 100000),
    limit = Math.max(1, integer(query.limit, 100, 100));
  const search = String(query.search || '').slice(0, 200);
  const status = String(query.status || '');
  const where = ["(title LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')"];
  const term = '%' + search.replace(/[\\%_]/g, '\\$&') + '%';
  const args: (string | number)[] = [term, term, term];
  if (status) {
    where.push('status=?');
    args.push(status);
  }
  const total = Number(
    db.prepare(`SELECT count(*) AS n FROM documents WHERE ${where.join(' AND ')}`).get(...args)?.n,
  );
  const items = db
    .prepare(
      `SELECT id,name,title,status,error,length(text) AS characters,updated,
       (SELECT j.status FROM graph_jobs j WHERE j.documentId=documents.id AND j.method='ai' ORDER BY j.created DESC,j.rowid DESC LIMIT 1) AS aiStatus,
       (SELECT j.error FROM graph_jobs j WHERE j.documentId=documents.id AND j.method='ai' ORDER BY j.created DESC,j.rowid DESC LIMIT 1) AS aiError
       FROM documents WHERE ${where.join(' AND ')} ORDER BY id LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, page * limit);
  return { items, total, page, limit, state: state() };
}
const groupExpression =
  "CASE WHEN m.sourceType IS NOT NULL THEN 'source:'||m.sourceType WHEN n.department IS NOT NULL THEN 'department:'||n.department ELSE 'unclassified' END";
const joins =
  'FROM documents d LEFT JOIN document_metadata m ON m.documentId=d.id LEFT JOIN nodes n ON n.id=d.id';
const groupTable = `WITH g AS (SELECT d.id AS id,${groupExpression} AS key ${joins})`;
const edgeColumns = "id,source,target,type,documentId,method,verified,'' AS evidence";
const groupLabel = (key: string, count: number) =>
  (key === 'unclassified' ? 'מסמכים ללא סיווג' : key.slice(key.indexOf(':') + 1)) +
  ' · ' +
  count.toLocaleString('he-IL');
const placeholders = (values: unknown[]) => values.map(() => '?').join(',');
/** Edges whose two endpoints are both visible. Evidence is fetched only when a relationship is inspected. */
function edgesAmong(ids: string[], limit = 600) {
  return ids.length
    ? db
        .prepare(
          `SELECT ${edgeColumns} FROM edges WHERE source IN (${placeholders(ids)}) AND target IN (${placeholders(ids)}) ORDER BY verified DESC,id LIMIT ?`,
        )
        .all(...ids, ...ids, limit)
    : [];
}
/** Non-document entities (people, systems, processes) linked from the given documents, most connected first. */
function linkedEntities(documentIds: string[], limit: number) {
  return documentIds.length && limit > 0
    ? (db
        .prepare(
          `SELECT n.id,n.label,n.type,n.department,count(*) AS degree FROM edges e JOIN nodes n ON n.id=e.target WHERE e.source IN (${placeholders(documentIds)}) AND n.type!='document' AND e.type!='published_in' GROUP BY n.id ORDER BY degree DESC,n.id LIMIT ?`,
        )
        .all(...documentIds, limit) as Record<string, unknown>[])
    : [];
}

/**
 * Level-of-detail map API. The client never receives the whole graph of a large repository:
 *  - overview: one community node per source/department with aggregated inter-community links and the most connected entities;
 *  - group: one community's documents (paged) plus the entities they reference;
 *  - center: a node and its direct neighbours (lazy expansion);
 *  - ids: chat sources and their neighbours;
 *  - search/type: matching nodes.
 * A repository whose whole graph fits within GRAPH_VIEW_LIMIT nodes is returned as-is.
 */
export function map(query: Record<string, unknown>) {
  const limit = Math.max(1, integer(query.limit, 60, GRAPH_VIEW_LIMIT)),
    offset = integer(query.offset, 0, 100000);
  const search = String(query.search || '')
      .trim()
      .slice(0, 200),
    type = String(query.type || 'all');
  const group = String(query.group || '');
  const center = String(query.center || '');
  const ids = String(query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
  const totals = state();
  if (!search && !group && !center && !ids.length && type === 'all') {
    if (query.overview !== '1')
      return {
        mode: 'focused-empty',
        nodes: [],
        edges: [],
        totalMatching: 0,
        hasMore: false,
        groups: false,
        ...totals,
      };
    if (totals.totalNodes <= GRAPH_VIEW_LIMIT) {
      const nodes = db.prepare('SELECT * FROM nodes ORDER BY type,id').all();
      return {
        mode: 'full',
        nodes,
        edges: db
          .prepare(`SELECT ${edgeColumns} FROM edges ORDER BY verified DESC,id LIMIT 2000`)
          .all(),
        totalMatching: nodes.length,
        hasMore: false,
        groups: false,
        ...totals,
      };
    }
    const groups = db
      .prepare(
        `SELECT ${groupExpression} AS key,count(*) AS count ${joins} GROUP BY key ORDER BY count DESC LIMIT 100`,
      )
      .all() as { key: string; count: number }[];
    const nodes: Record<string, unknown>[] = groups.map((g) => ({
      id: 'group:' + g.key,
      label: groupLabel(g.key, g.count),
      type: 'community',
      count: g.count,
      group: g.key,
    }));
    const links = db
      .prepare(
        `${groupTable} SELECT gs.key AS source,gt.key AS target,count(*) AS weight FROM edges e JOIN g gs ON gs.id=e.source JOIN g gt ON gt.id=e.target WHERE gs.key<>gt.key GROUP BY gs.key,gt.key ORDER BY weight DESC LIMIT 300`,
      )
      .all() as { source: string; target: string; weight: number }[];
    const hubs = db
      .prepare(
        "SELECT n.id,n.label,n.type,n.department,count(*) AS degree FROM edges e JOIN nodes n ON n.id=e.target WHERE n.type!='document' AND e.type!='published_in' GROUP BY n.id ORDER BY degree DESC,n.id LIMIT 24",
      )
      .all() as { id: string; degree: number }[];
    const hubLinks = hubs.length
      ? (db
          .prepare(
            `${groupTable} SELECT g.key AS source,e.target AS target,count(*) AS weight FROM edges e JOIN g ON g.id=e.source WHERE e.target IN (${placeholders(hubs)}) GROUP BY g.key,e.target`,
          )
          .all(...hubs.map((h) => h.id)) as { source: string; target: string; weight: number }[])
      : [];
    const aggregate = (source: string, target: string, weight: number) => ({
      id: `aggregate:${source}->${target}`,
      source,
      target,
      type: 'aggregate',
      documentId: '',
      method: 'aggregate',
      verified: 1,
      evidence: '',
      weight,
    });
    const edges = [
      ...links.map((l) => aggregate('group:' + l.source, 'group:' + l.target, l.weight)),
      ...hubLinks.map((l) => aggregate('group:' + l.source, l.target, l.weight)),
    ];
    return {
      mode: 'overview',
      nodes: [...nodes, ...hubs],
      edges,
      totalMatching: totals.totalDocuments,
      hasMore: false,
      groups: true,
      ...totals,
    };
  }
  let nodes: Record<string, unknown>[];
  let matching = 0;
  let mode = 'search';
  if (group) {
    mode = 'group';
    matching = Number(
      db.prepare(`SELECT count(*) AS n ${joins} WHERE ${groupExpression}=?`).get(group)?.n,
    );
    const documents = db
      .prepare(
        `SELECT d.id,d.title AS label,'document' AS type,n.department ${joins} WHERE ${groupExpression}=? ORDER BY d.id LIMIT ? OFFSET ?`,
      )
      .all(group, limit, offset) as Record<string, unknown>[];
    nodes = [
      ...documents,
      ...linkedEntities(
        documents.map((d) => d.id as string),
        Math.min(40, GRAPH_VIEW_LIMIT - documents.length),
      ),
    ];
  } else if (center) {
    mode = 'center';
    const selected = db.prepare('SELECT * FROM nodes WHERE id=?').get(center);
    const neighbors = db
      .prepare(
        `SELECT DISTINCT n.* FROM edges e JOIN nodes n ON n.id=CASE WHEN e.source=? THEN e.target ELSE e.source END WHERE (e.source=? OR e.target=?) AND n.id!=? ORDER BY n.type,n.id LIMIT ?`,
      )
      .all(center, center, center, center, Math.max(0, limit - 1));
    nodes = selected ? [selected, ...neighbors] : [];
    matching = selected
      ? 1 +
        Number(
          db
            .prepare(
              'SELECT count(DISTINCT CASE WHEN source=? THEN target ELSE source END) AS n FROM edges WHERE (source=? OR target=?) AND source!=target',
            )
            .get(center, center, center)?.n,
        )
      : 0;
  } else if (ids.length) {
    mode = 'focus';
    const focus = db
      .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders(ids)})`)
      .all(...ids) as Record<string, unknown>[];
    const neighbors = db
      .prepare(
        `SELECT DISTINCT n.* FROM edges e JOIN nodes n ON n.id=CASE WHEN e.source IN (${placeholders(ids)}) THEN e.target ELSE e.source END WHERE (e.source IN (${placeholders(ids)}) OR e.target IN (${placeholders(ids)})) AND e.type!='published_in' LIMIT ?`,
      )
      .all(...ids, ...ids, ...ids, Math.max(0, limit - focus.length)) as Record<string, unknown>[];
    const seen = new Set(focus.map((n) => n.id));
    nodes = [...focus, ...neighbors.filter((n) => !seen.has(n.id))];
    matching = nodes.length;
  } else {
    const clauses = ['(label LIKE ? OR id LIKE ?)'];
    const term = '%' + search + '%';
    const args: (string | number)[] = [term, term];
    if (type !== 'all') {
      clauses.push('type=?');
      args.push(type);
    }
    matching = Number(
      db.prepare(`SELECT count(*) AS n FROM nodes WHERE ${clauses.join(' AND ')}`).get(...args)?.n,
    );
    nodes = db
      .prepare(
        `SELECT * FROM nodes WHERE ${clauses.join(' AND ')} ORDER BY type,id LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as Record<string, unknown>[];
  }
  const matches = nodes.length;
  // Search hits need their real neighbours; otherwise filtering hides both ends
  // of every edge and falsely makes a connected document look isolated.
  if (mode === 'search') {
    const seen = new Set(nodes.map((n) => n.id));
    for (const n of linkedEntities(
      nodes.filter((n) => n.type === 'document').map((n) => String(n.id)),
      Math.min(25, GRAPH_VIEW_LIMIT - nodes.length),
    ))
      if (!seen.has(n.id)) {
        nodes.push(n);
        seen.add(n.id);
      }
    for (const doc of nodes.filter((n) => n.type === 'document').slice(0, 10)) {
      const neighbors = db
        .prepare(
          "SELECT DISTINCT n.* FROM edges e JOIN nodes n ON n.id=CASE WHEN e.source=? THEN e.target ELSE e.source END WHERE (e.source=? OR e.target=?) AND e.type!='published_in' LIMIT 10",
        )
        .all(String(doc.id), String(doc.id), String(doc.id));
      for (const n of neighbors)
        if (!seen.has(n.id) && nodes.length < GRAPH_VIEW_LIMIT) {
          nodes.push(n);
          seen.add(n.id);
        }
    }
  }
  const derived =
    mode === 'center' || mode === 'focus' || mode === 'search'
      ? nodes
          .filter((n) => n.type === 'document')
          .slice(0, 5)
          .flatMap((n) => documentLinks(String(n.id), 10))
      : [];
  const seen = new Set(nodes.map((n) => n.id));
  for (const e of derived)
    if (!seen.has(e.target) && nodes.length < GRAPH_VIEW_LIMIT) {
      const n = db.prepare('SELECT * FROM nodes WHERE id=?').get(e.target);
      if (n) {
        nodes.push(n);
        seen.add(e.target);
      }
    }
  const edges = [
    ...edgesAmong(nodes.map((n) => n.id as string)),
    ...derived.filter((e) => seen.has(e.source) && seen.has(e.target)),
  ];
  const uniqueEdges = [...new Map(edges.map((e) => [String(e.id), e])).values()];
  return {
    mode,
    nodes,
    edges: uniqueEdges,
    totalMatching: matching,
    matchingNodes: matches,
    storedVisibleEdges: uniqueEdges.filter((e) => e.method !== 'derived').length,
    derivedVisibleEdges: uniqueEdges.filter((e) => e.method === 'derived').length,
    hasMore: mode === 'group' || mode === 'search' ? offset + limit < matching : false,
    omittedNeighbors: mode === 'center' ? Math.max(0, matching - matches) : 0,
    groups: false,
    ...totals,
  };
}
/** One node with its relationships (paged), for the details panel. Evidence is truncated; the full text is at /api/edges/:id. */
export function nodeDetails(id: string, query: Record<string, unknown> = {}) {
  const node = db.prepare('SELECT * FROM nodes WHERE id=?').get(id);
  if (!node) return undefined;
  const limit = Math.max(1, integer(query.limit, 100, 200)),
    offset = integer(query.offset, 0, 100000);
  const total = Number(
    db.prepare('SELECT count(*) AS n FROM edges WHERE source=? OR target=?').get(id, id)?.n,
  );
  const relationships = db
    .prepare(
      `SELECT e.id,e.source,e.target,e.type,e.documentId,e.method,e.verified,substr(e.evidence,1,600) AS evidence,o.id AS otherId,o.label AS otherLabel,o.type AS otherType FROM edges e LEFT JOIN nodes o ON o.id=CASE WHEN e.source=? THEN e.target ELSE e.source END WHERE e.source=? OR e.target=? ORDER BY e.verified DESC,e.id LIMIT ? OFFSET ?`,
    )
    .all(id, id, id, limit, offset);
  const relatedDocuments = documentLinks(id);
  return {
    node,
    relationships,
    relatedDocuments,
    total,
    hasMore: offset + relationships.length < total,
  };
}
