import express from 'express';
import { contentHash, traceAI, traceChat } from '../ai-trace.js';
import { parseChatContext } from '../chat-context.js';
import { requestAccess, serverTiming } from '../Middleware/RequestContext.js';
import { answer } from '../rag.js';
import { interactive } from '../scheduler.js';
import { aiExecution } from '../Services/AiExecutionService.js';
export function createChatController() {
  const router = express.Router();
  router.post('/chat', traceChat, async (req, res) => {
    const question = req.body?.question;
    if (typeof question !== 'string' || question.trim().length < 2 || question.length > 2000)
      return res.status(400).json({ error: 'שאלה חייבת להכיל 2–2000 תווים' });
    let context;
    try {
      context = parseChatContext(req.body.context);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }
    if (aiExecution.busy)
      return res.status(429).json({ error: 'המודל עסוק; נסה שוב לאחר סיום הבקשה' });
    aiExecution.busy = true;
    try {
      const result = await interactive(() => answer(question.trim(), context, requestAccess(req)));
      if ('timings' in result && result.timings)
        res.setHeader('Server-Timing', serverTiming(result.timings));
      traceAI('chat.answer', {
        mode: result.mode,
        answerKind: result.mode === 'ollama' ? 'ai' : 'system',
        contentHash: contentHash(result.answer),
        statements: result.evidence.length,
      });
      res.json({ ...result, answerKind: result.mode === 'ollama' ? 'ai' : 'system' });
    } finally {
      aiExecution.busy = false;
    }
  });
  return router;
}
