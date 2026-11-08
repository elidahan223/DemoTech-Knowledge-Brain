import { CLIENT_BATCH_BYTES, CLIENT_BATCH_FILES, MAX_FILE_BYTES } from '../shared/upload-policy';
export type UploadReceipt = {
  id?: string;
  name?: string;
  error?: string;
  duplicate?: boolean;
  jobId?: string;
};
export type UploadProgress = {
  total: number;
  handled: number;
  queued: number;
  duplicates: number;
  failed: number;
  bytes: number;
  batches: number;
  errors: { name: string; error: string }[];
};
type Options = {
  signal: AbortSignal;
  replaceId?: string;
  send: (body: FormData) => Promise<UploadReceipt[]>;
  onProgress: (progress: UploadProgress) => void;
};

export async function uploadFiles(files: readonly File[], options: Options) {
  if (options.replaceId && files.length !== 1) throw new Error('עדכון מסמך דורש קובץ יחיד');
  const progress: UploadProgress = {
    total: files.length,
    handled: 0,
    queued: 0,
    duplicates: 0,
    failed: 0,
    bytes: 0,
    batches: 0,
    errors: [],
  };
  const report = () => options.onProgress({ ...progress, errors: [...progress.errors] });
  const fail = (file: File, error: string) => {
    progress.handled++;
    progress.failed++;
    if (progress.errors.length < 20) progress.errors.push({ name: file.name, error });
  };
  const eligible: File[] = [];
  for (const file of files) {
    if (!/\.(docx|pdf|txt)$/i.test(file.name)) fail(file, 'נתמכים רק קובצי DOCX, PDF ו־TXT');
    else if (file.size > MAX_FILE_BYTES) fail(file, 'הקובץ גדול מ־20MB');
    else eligible.push(file);
  }
  report();
  for (let offset = 0; offset < eligible.length; ) {
    if (options.signal.aborted) break;
    const batch: File[] = [];
    let bytes = 0;
    while (offset < eligible.length && batch.length < CLIENT_BATCH_FILES) {
      const file = eligible[offset];
      if (batch.length && bytes + file.size > CLIENT_BATCH_BYTES) break;
      batch.push(file);
      bytes += file.size;
      offset++;
    }
    const body = new FormData();
    for (const file of batch) body.append('files', file);
    if (options.replaceId) body.append('replaceId', options.replaceId);
    // Cancellation stops future batches. Let the current request finish to keep its receipts reliable.
    const results = await options.send(body);
    if (!Array.isArray(results) || results.length !== batch.length)
      throw new Error(
        'השרת לא החזיר אישור לכל הקבצים באצווה. אפשר לבחור את הקבצים שוב; כפילויות לא יתווספו.',
      );
    results.forEach((result, index) => {
      if (result.error) fail(batch[index], result.error);
      else {
        progress.handled++;
        if (result.duplicate) progress.duplicates++;
        else progress.queued++;
      }
    });
    progress.bytes += bytes;
    progress.batches++;
    report();
  }
  return { progress, stopped: progress.handled < progress.total };
}
