import 'dotenv/config';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export const root = path.resolve(process.env.BRAIN_APP_ROOT || process.cwd());
export const dataDir = path.resolve(process.env.BRAIN_DATA_DIR || path.join(root, 'data'));
mkdirSync(path.join(dataDir, 'files'), { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, 'brain.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,name TEXT NOT NULL,title TEXT NOT NULL,text TEXT NOT NULL DEFAULT '',status TEXT NOT NULL,path TEXT NOT NULL,error TEXT,updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY,label TEXT NOT NULL,type TEXT NOT NULL,department TEXT);
CREATE TABLE IF NOT EXISTS edges(id TEXT PRIMARY KEY,source TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,target TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,type TEXT NOT NULL,documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,evidence TEXT NOT NULL,method TEXT NOT NULL,verified INTEGER NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(documentId UNINDEXED, text, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,documentId TEXT NOT NULL,status TEXT NOT NULL,error TEXT,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,action TEXT NOT NULL,documentId TEXT,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
db.exec(`CREATE TABLE IF NOT EXISTS document_aliases(alias TEXT PRIMARY KEY,documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS aliases_document ON document_aliases(documentId);
CREATE TABLE IF NOT EXISTS document_metadata(documentId TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,externalId TEXT,sourceType TEXT);
CREATE TABLE IF NOT EXISTS embeddings(chunkId INTEGER PRIMARY KEY,documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,model TEXT NOT NULL,dimensions INTEGER NOT NULL,vector BLOB NOT NULL);
CREATE INDEX IF NOT EXISTS embeddings_document ON embeddings(documentId);
CREATE TABLE IF NOT EXISTS graph_jobs(id TEXT PRIMARY KEY,documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,status TEXT NOT NULL,error TEXT,method TEXT NOT NULL DEFAULT 'explicit',created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS graph_jobs_queue ON graph_jobs(status,created);`);
export const repositoryName = process.env.BRAIN_REPOSITORY_NAME || 'DemoTech';
const savedRepository = db
  .prepare("SELECT value FROM metadata WHERE key='repositoryName'")
  .get() as { value: string } | undefined;
if (savedRepository && savedRepository.value !== repositoryName)
  throw new Error('Repository name does not match its data directory');
db.prepare("INSERT OR IGNORE INTO metadata VALUES('repositoryName',?)").run(repositoryName);
db.exec(
  'CREATE TABLE IF NOT EXISTS fileHashes(documentId TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE, hash TEXT NOT NULL UNIQUE)',
);
db.exec(`CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,created);
CREATE INDEX IF NOT EXISTS jobs_document ON jobs(documentId,status);
CREATE INDEX IF NOT EXISTS edges_document ON edges(documentId);
CREATE INDEX IF NOT EXISTS edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS nodes_identity ON nodes(type,lower(label));
CREATE INDEX IF NOT EXISTS documents_status ON documents(status);`);
// FTS5 cannot index its UNINDEXED documentId column, so "chunks WHERE documentId=?" scans every chunk
// (measured: ~20 ms per lookup at 17k chunks, linear in corpus size). This table is the indexed chunk→document map.
db.exec(`CREATE TABLE IF NOT EXISTS chunk_documents(chunkId INTEGER PRIMARY KEY,documentId TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chunk_documents_document ON chunk_documents(documentId,chunkId);
CREATE TABLE IF NOT EXISTS document_acl(documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,principal TEXT NOT NULL,PRIMARY KEY(documentId,principal));
CREATE INDEX IF NOT EXISTS document_acl_principal ON document_acl(principal);`);
if (!db.prepare("SELECT value FROM metadata WHERE key='chunkDocumentsBuilt'").get())
  transaction(() => {
    db.exec(
      'DELETE FROM chunk_documents; INSERT INTO chunk_documents(chunkId,documentId) SELECT rowid,documentId FROM chunks',
    );
    db.prepare("INSERT INTO metadata VALUES('chunkDocumentsBuilt','1')").run();
  });
const jobColumns = new Set(
  (db.prepare('PRAGMA table_info(jobs)').all() as { name: string }[]).map((c) => c.name),
);
for (const [name, type] of [
  ['attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['nextAttempt', 'TEXT'],
  ['updated', 'TEXT'],
])
  if (!jobColumns.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
/** Stored paths are absolute for backward compatibility; if the data directory moved (another machine or a central server), resolve by file name inside it. */
export function resolveStoredPath(stored: string) {
  if (existsSync(stored)) return stored;
  const relocated = path.join(dataDir, 'files', path.basename(stored));
  return existsSync(relocated) ? relocated : stored;
}
/**
 * Permission filter applied BEFORE ranking, so restricted text can never reach the model.
 * undefined = the local single-user desktop (full access). A document without ACL rows is visible to everyone;
 * a document with ACL rows is visible only to the listed principals (user or group IDs from a future auth layer).
 */
export type Access = { principals: string[] } | undefined;
export function accessSql(access: Access, column = 'documents.id') {
  if (!access) return { sql: '', args: [] as string[] };
  const list = access.principals.length ? access.principals : [''];
  return {
    sql: ` AND (NOT EXISTS (SELECT 1 FROM document_acl a WHERE a.documentId=${column}) OR EXISTS (SELECT 1 FROM document_acl a WHERE a.documentId=${column} AND a.principal IN (${list.map(() => '?').join(',')})))`,
    args: list,
  };
}
export function accessPredicate(access: Access): ((documentId: string) => boolean) | undefined {
  if (!access) return undefined;
  const allowed = new Set(access.principals);
  const denied = new Set<string>();
  const rules = new Map<string, string[]>();
  for (const row of db.prepare('SELECT documentId,principal FROM document_acl').all() as {
    documentId: string;
    principal: string;
  }[])
    rules.set(row.documentId, [...(rules.get(row.documentId) || []), row.principal]);
  for (const [id, principals] of rules) if (!principals.some((p) => allowed.has(p))) denied.add(id);
  return (id) => !denied.has(id);
}
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
export function audit(action: string, id?: string) {
  db.prepare('INSERT INTO audit(action,documentId,created) VALUES(?,?,?)').run(
    action,
    id || null,
    new Date().toISOString(),
  );
}
export function graph() {
  return {
    nodes: db.prepare('SELECT * FROM nodes').all(),
    edges: db.prepare('SELECT * FROM edges').all(),
  };
}
export function listDocuments() {
  return db
    .prepare(
      'SELECT id,name,title,status,error,updated,length(text) AS characters FROM documents ORDER BY id',
    )
    .all();
}
export function cleanOrphans() {
  db.exec(
    `DELETE FROM nodes WHERE type!='document' AND NOT EXISTS (SELECT 1 FROM edges WHERE source=nodes.id OR target=nodes.id)`,
  );
}
