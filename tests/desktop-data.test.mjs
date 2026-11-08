import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrateLegacyData } from '../electron/data.mjs';
const temp = await mkdtemp(path.join(tmpdir(), 'brain-desktop-migration-'));
after(() => rm(temp, { recursive: true, force: true }));
test('snapshot includes uncheckpointed WAL, rebases file paths and never overwrites desktop data', async () => {
  const source = path.join(temp, 'legacy'),
    target = path.join(temp, 'profile', 'data');
  await mkdir(path.join(source, 'files'), { recursive: true });
  await writeFile(path.join(source, 'files', 'document.docx'), 'original document');
  const db = new DatabaseSync(path.join(source, 'brain.sqlite'));
  db.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE documents(id TEXT PRIMARY KEY,path TEXT); CREATE TABLE jobs(status TEXT);',
  );
  db.prepare('INSERT INTO documents VALUES(?,?)').run(
    'CUSTOM-001',
    path.join(source, 'files', 'document.docx'),
  );
  db.exec("INSERT INTO jobs VALUES('processing')");
  try {
    assert.equal((await migrateLegacyData(source, target)).migrated, true);
    const migrated = new DatabaseSync(path.join(target, 'brain.sqlite'));
    try {
      assert.equal(
        migrated.prepare('SELECT path FROM documents').get().path,
        path.join(target, 'files', 'document.docx'),
      );
      assert.equal(migrated.prepare('SELECT status FROM jobs').get().status, 'queued');
    } finally {
      migrated.close();
    }
    assert.equal(
      await readFile(path.join(target, 'files', 'document.docx'), 'utf8'),
      'original document',
    );
    assert.equal(
      db.prepare('SELECT path FROM documents').get().path,
      path.join(source, 'files', 'document.docx'),
    );
    assert.equal(db.prepare('SELECT status FROM jobs').get().status, 'processing');
    await writeFile(path.join(target, 'files', 'document.docx'), 'desktop version');
    assert.equal((await migrateLegacyData(source, target)).reason, 'desktop-data-exists');
    assert.equal(
      await readFile(path.join(target, 'files', 'document.docx'), 'utf8'),
      'desktop version',
    );
  } finally {
    db.close();
  }
});
test('missing source seeds normally; nonempty target is preserved', async () => {
  assert.equal(
    (await migrateLegacyData(path.join(temp, 'absent'), path.join(temp, 'new'))).reason,
    'no-legacy-data',
  );
  const target = path.join(temp, 'occupied');
  await mkdir(target);
  await writeFile(path.join(target, 'keep.txt'), 'do not overwrite');
  await assert.rejects(migrateLegacyData(path.join(temp, 'legacy'), target));
  assert.equal(await readFile(path.join(target, 'keep.txt'), 'utf8'), 'do not overwrite');
});
