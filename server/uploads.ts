import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { MAX_FILE_BYTES, SERVER_BATCH_FILES } from '../shared/upload-policy.js';
import { enqueue } from './ingest.js';
import { audit, dataDir, db, transaction } from './store.js';

const receiver = multer({
  dest: path.join(dataDir, 'files'),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: SERVER_BATCH_FILES,
    fields: 1,
    fieldSize: 256,
    parts: SERVER_BATCH_FILES + 1,
  },
  fileFilter: (_req, file, callback) =>
    /\.(docx|pdf|txt)$/i.test(file.originalname)
      ? callback(null, true)
      : callback(new Error('נתמכים רק קובצי DOCX, PDF ו־TXT בקידוד UTF-8')),
}).array('files', SERVER_BATCH_FILES);
export function receiveFiles(req: Request, res: Response, next: NextFunction) {
  receiver(req, res, (error) => {
    if (!error) return next();
    const large = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    res.status(large ? 413 : 400).json({
      error: large
        ? 'עד 20MB לקובץ'
        : error instanceof multer.MulterError
          ? `אצווה בודדת יכולה להכיל עד ${SERVER_BATCH_FILES} קבצים; יש להשתמש בהעלאה באצוות`
          : error.message,
    });
  });
}
async function fingerprint(file: string, extension: string) {
  const descriptor = await open(file, 'r');
  const bytes = Buffer.alloc(5);
  try {
    await descriptor.read(bytes, 0, 5, 0);
  } finally {
    await descriptor.close();
  }
  if (
    extension !== '.txt' &&
    (extension === '.pdf'
      ? !bytes.equals(Buffer.from('%PDF-'))
      : bytes[0] !== 0x50 || bytes[1] !== 0x4b)
  )
    throw new Error('חתימת קובץ לא תקינה');
  if (extension === '.txt' && bytes.includes(0)) {
    const stat = await open(file, 'r');
    try {
      const size = (await stat.stat()).size;
      if (size >= 5) throw new Error('TXT מכיל נתונים בינאריים');
    } finally {
      await stat.close();
    }
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function acceptFiles(req: Request, res: Response) {
  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length)
    return res.status(400).json({ error: 'יש לבחור קובצי DOCX, PDF או TXT, עד 20MB לקובץ' });
  const results = [];
  for (const file of files) {
    let uncommitted: string | undefined;
    try {
      const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
      const extension = path.extname(file.originalname).toLowerCase();
      const hash = await fingerprint(file.path, extension);
      const replacement = typeof req.body.replaceId === 'string' ? req.body.replaceId : undefined;
      if (
        replacement &&
        (files.length !== 1 || !db.prepare('SELECT id FROM documents WHERE id=?').get(replacement))
      )
        throw new Error('עדכון דורש מסמך קיים וקובץ יחיד');
      const id = replacement || `DOC-${randomUUID()}`;
      const destination = path.join(dataDir, 'files', `${randomUUID()}${extension}`);
      await rename(file.path, destination);
      uncommitted = destination;
      const result = transaction(() => {
        const duplicate = db.prepare('SELECT documentId FROM fileHashes WHERE hash=?').get(hash) as
          | { documentId: string }
          | undefined;
        if (duplicate && duplicate.documentId !== replacement)
          return { id: duplicate.documentId, name, duplicate: true };
        if (
          db
            .prepare("SELECT id FROM jobs WHERE documentId=? AND status IN ('queued','processing')")
            .get(id)
        )
          throw new Error('המסמך כבר נמצא בעיבוד');
        const old = db.prepare('SELECT path FROM documents WHERE id=?').get(id) as
          | { path: string }
          | undefined;
        db.prepare(
          `INSERT INTO documents VALUES(?,?,?,?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET path=excluded.path,name=excluded.name,status='queued',error=NULL,updated=excluded.updated`,
        ).run(
          id,
          name,
          name.replace(/\.(docx|pdf|txt)$/i, ''),
          '',
          'queued',
          destination,
          new Date().toISOString(),
        );
        db.prepare('DELETE FROM fileHashes WHERE documentId=?').run(id);
        db.prepare('INSERT INTO fileHashes VALUES(?,?)').run(id, hash);
        const jobId = enqueue(id);
        audit(replacement ? 'updated' : 'uploaded', id);
        return { id, name, jobId, oldPath: old?.path };
      });
      if (!('duplicate' in result)) {
        uncommitted = undefined;
        if (result.oldPath) await unlink(result.oldPath).catch(() => {});
      }
      const { oldPath: _, ...receipt } = result as typeof result & { oldPath?: string };
      results.push(receipt);
    } catch (error) {
      results.push({
        name: file.originalname,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await unlink(file.path).catch(() => {});
      if (uncommitted) await unlink(uncommitted).catch(() => {});
    }
  }
  res.status(202).json(results);
}
