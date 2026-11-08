import type { ChatContext } from '../../shared/chat';
import { previousContext } from '../answer-context.js';
import { normalizeMessage } from '../chat-context.js';
import type { QuestionPlan } from '../Models/ChatModels.js';
import { ollama } from '../ollama.js';
import { buildQuestionUnderstandingRequest } from '../Prompts/QuestionUnderstandingPrompt.js';
import { getPrimaryOrganization } from '../Repositories/ChatRepository.js';
import type { Access } from '../store.js';
import { parseQuestionPlan } from './QuestionPlanValidation.js';

export async function understandQuestion(
  input: string,
  conversation: ChatContext | undefined,
  access: Access,
  timings: Record<string, number>,
): Promise<QuestionPlan> {
  const question = normalizeMessage(input);
  const subject = conversation?.subject || getPrimaryOrganization()?.value;
  const prior = previousContext(conversation?.evidence || [], access);
  const allEvidenceAccessible = prior.length === (conversation?.evidence.length || 0);
  const history: ChatContext = {
    question: conversation?.question || question,
    ...(allEvidenceAccessible && conversation?.answer ? { answer: conversation.answer } : {}),
    ...(subject ? { subject } : {}),
    ...(conversation?.awaitingOrganization ? { awaitingOrganization: true } : {}),
    evidence: prior.map((s) => ({ documentId: s.documentId, quote: s.text })),
  };
  const request = buildQuestionUnderstandingRequest(
    question,
    history,
    prior.map((s) => s.text),
  );
  const started = performance.now();
  const raw = await ollama(request.messages, request.schema);
  timings.understandingMs = performance.now() - started;
  const parsed = parseQuestionPlan(raw, question);
  // A model-proposed organization must already occur in the user's supplied context.
  const allowedNames = [question, subject || ''].join('\n').toLowerCase();
  const organization =
    parsed.organization && allowedNames.includes(parsed.organization.toLowerCase())
      ? parsed.organization
      : subject;
  return {
    question,
    subject,
    history,
    feedback: parsed.intent === 'feedback',
    translating: parsed.intent === 'translate',
    query: parsed.intent === 'feedback' ? history.question : parsed.question,
    currentQuestion: parsed.intent === 'feedback' ? history.question : parsed.question,
    modelCalls: 1,
    global: parsed.intent === 'corpus',
    profile: parsed.intent === 'profile',
    organization,
    tasks: parsed.tasks,
  };
}
