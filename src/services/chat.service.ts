import type { AnswerEvidence, ChatContext } from '../../shared/chat';
import type { Generation, Source } from '../types/app.types';
import { api } from './api.service';
export type ChatResponse = {
  answer: string;
  answerKind: 'ai' | 'system';
  generation?: Generation;
  sources: Source[];
  highlighted: string[];
  evidence?: AnswerEvidence[];
  contextQuestion?: string;
  conversationContext?: ChatContext;
};
export function sendChat(question: string, context?: ChatContext) {
  return api<ChatResponse>('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context }),
  });
}
export function nextChatContext(response: ChatResponse, question: string): ChatContext {
  return (
    response.conversationContext || {
      question: (response.contextQuestion || question).slice(-2000),
      evidence: (response.evidence || []).slice(0, 4).flatMap((e) => {
        const source = response.sources.find((s) => s.citation === e.source);
        return source && e.quote.length <= 2400
          ? [{ documentId: source.documentId, quote: e.quote }]
          : [];
      }),
    }
  );
}
