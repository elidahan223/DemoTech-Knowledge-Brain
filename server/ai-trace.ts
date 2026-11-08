import type { RequestHandler } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
const requests = new AsyncLocalStorage<{ requestId: string }>();
export const contentHash = (text: string) => createHash('sha256').update(text).digest('hex');
export function traceAI(event: string, details: Record<string, unknown>) {
  if (process.env.BRAIN_TRACE_AI === '1')
    console.log(
      JSON.stringify({ event, requestId: requests.getStore()?.requestId || null, ...details }),
    );
}
export const traceChat: RequestHandler = (_req, res, next) => {
  const requestId = randomUUID(),
    started = performance.now();
  res.setHeader('X-Brain-Request-ID', requestId);
  requests.run({ requestId }, () => {
    res.once('finish', () =>
      traceAI('chat.complete', {
        requestId,
        httpStatus: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    );
    next();
  });
};
export const currentRequestId = () => requests.getStore()?.requestId;
