import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
let worker: Worker | undefined;
let chain: Promise<unknown> = Promise.resolve();
function getWorker() {
  if (!worker) {
    const created = new Worker(new URL('./extract-worker.mjs', import.meta.url), {
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    worker = created;
    created.on('exit', () => {
      if (worker === created) worker = undefined;
    });
    created.on('error', () => {
      if (worker === created) worker = undefined;
    });
    created.unref();
  }
  return worker;
}
export function extract(file: string): Promise<string> {
  const job = chain.then(
    () =>
      new Promise<string>((resolve, reject) => {
        const current = getWorker();
        const id = randomUUID();
        current.ref();
        let settled = false;
        function finish(error: Error | null, text?: string) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          current.removeListener('message', message);
          current.removeListener('error', failed);
          current.removeListener('exit', exited);
          current.unref();
          error ? reject(error) : resolve(text!);
        }
        function message(result: { id: string; text?: string; error?: string }) {
          if (result.id === id) finish(result.error ? new Error(result.error) : null, result.text);
        }
        function failed(error: Error) {
          finish(error);
        }
        function exited() {
          finish(new Error('תהליך חילוץ המסמך נעצר'));
        }
        const timer = setTimeout(() => {
          if (worker === current) worker = undefined;
          void current.terminate();
          finish(new Error('עיבוד המסמך חרג מ־60 שניות'));
        }, 60000);
        current.once('error', failed);
        current.once('exit', exited);
        current.on('message', message);
        try {
          current.postMessage({ id, file });
        } catch (error) {
          if (worker === current) worker = undefined;
          void current.terminate();
          finish(error as Error);
        }
      }),
  );
  chain = job.catch(() => {});
  return job;
}
