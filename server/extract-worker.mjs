import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';
import pdf from 'pdf-parse/lib/pdf-parse.js';
parentPort.on('message', async ({ id, file }) => {
  try {
    let text;
    if (file.toLowerCase().endsWith('.txt')) {
      const bytes = await readFile(file);
      // Binary files contain many NUL bytes; a rare NUL inside valid UTF-8 text (seen in real exported tickets) is kept
      // visibly as U+2400 instead of rejecting the whole document.
      let nul = 0;
      for (const b of bytes) if (b === 0) nul++;
      if (nul > bytes.length / 1000) throw new Error('TXT מכיל נתונים בינאריים');
      text = new TextDecoder('utf-8', { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/, '')
        .replaceAll('\u0000', '\u2400');
    } else
      text = file.toLowerCase().endsWith('.docx')
        ? (await mammoth.extractRawText({ path: file })).value
        : (await pdf(await readFile(file))).text;
    if (!text.trim()) throw new Error('לא נמצא טקסט. PDF סרוק דורש OCR שאינו כלול בגרסה זו.');
    if (text.length > 2000000) throw new Error('המסמך ארוך מדי');
    parentPort.postMessage({ id, text: text.trim() });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
