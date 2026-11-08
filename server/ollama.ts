import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { contentHash, currentRequestId, traceAI } from './ai-trace.js';
import { runLocalModel } from './Services/LocalModelQueue.js';
import { localOllamaUrl, assertLocalModelName } from './Settings/LocalAiPolicy.js';
export const url = localOllamaUrl(process.env.OLLAMA_URL || 'http://127.0.0.1:11434');
export const model = assertLocalModelName(process.env.OLLAMA_MODEL || 'gemma3:4b');
export class OllamaError extends Error {
  readonly status = 503;
  readonly code = 'OLLAMA_UNAVAILABLE';
  readonly retryable: boolean;
  constructor(
    message = 'שירות Ollama אינו זמין. בדקו שהשירות פועל ושהמודל המקומי מותקן, ונסו שוב.',
    retryable = true,
  ) {
    super(message);
    this.retryable = retryable;
  }
}
export async function ollama(
  messages: { role: string; content: string }[],
  json: boolean | Record<string, unknown> = false,
  options: { background?: boolean } = {},
) {
  return runLocalModel(async () => {
    const callId = randomUUID(),
      started = performance.now();
    let httpStatus: number | null = null;
    traceAI('ollama.request', { callId, model });
    try {
      const response = await fetch(new URL('/api/chat', url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Brain-Request-ID': currentRequestId() || callId,
        },
        body: JSON.stringify({
          model,
          stream: false,
          messages,
          ...(json ? { format: json === true ? 'json' : json } : {}),
          options: { temperature: 0, num_ctx: 8192, num_predict: 1200 },
        }),
        signal: AbortSignal.timeout(180000),
      });
      httpStatus = response.status;
      if (!response.ok)
        throw new OllamaError(
          `Ollama החזיר שגיאה ${response.status}. בדקו שהמודל ${model} מותקן וזמין.`,
          response.status === 429 || response.status >= 500,
        );
      const result = (await response.json()) as { model?: string; message?: { content: string } };
      if (typeof result.message?.content !== 'string' || !result.message.content.trim())
        throw new OllamaError('Ollama לא החזיר תוכן תשובה. נסו שוב.');
      traceAI('ollama.response', {
        callId,
        model,
        responseModel: result.model || null,
        httpStatus,
        durationMs: Math.round(performance.now() - started),
        receivedContent: true,
        contentHash: contentHash(result.message.content),
      });
      return result.message.content;
    } catch (error) {
      traceAI('ollama.failure', {
        callId,
        model,
        httpStatus,
        durationMs: Math.round(performance.now() - started),
        receivedContent: false,
      });
      throw error instanceof OllamaError ? error : new OllamaError();
    }
  }, options.background);
}
export async function health(embedding?: string) {
  try {
    const r = await fetch(new URL('/api/tags', url), { signal: AbortSignal.timeout(2500) });
    const x = (await r.json()) as { models: { name: string }[] };
    return {
      online: r.ok,
      model,
      available: x.models.some((m) => m.name === model),
      localOnly: true,
      embedding: {
        model: embedding || null,
        configured: Boolean(embedding),
        available: Boolean(embedding && x.models.some((m) => m.name === embedding)),
      },
    };
  } catch {
    return {
      online: false,
      model,
      available: false,
      localOnly: true,
      embedding: { model: embedding || null, configured: Boolean(embedding), available: false },
    };
  }
}
