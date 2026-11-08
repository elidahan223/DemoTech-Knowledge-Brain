import type express from 'express';
import { OllamaError } from '../ollama.js';
import { AiResponseError } from '../Services/QuestionPlanValidation.js';
export const errorMiddleware: express.ErrorRequestHandler = (
  error: Error,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  if (error instanceof OllamaError || error instanceof AiResponseError)
    return res
      .status(error.status)
      .json({ error: error.message, code: error.code, answerKind: 'error' });
  console.error(error.message);
  res.status(500).json({ error: error.message });
};
