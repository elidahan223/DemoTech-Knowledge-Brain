import type { ChatContext } from '../../shared/chat';
import { model, ollama } from '../ollama.js';
import { requiredIdentifiers } from '../query-constraints.js';
import { recordChat } from '../Repositories/ChatRepository.js';
import { type Access } from '../store.js';
import { previousContext, previousPerson } from '../answer-context.js';
import { translationRequest } from '../chat-context.js';

import { buildAnswerRequest } from '../Prompts/ChatPrompts.js';
import { prepareAnswerEvidence, selectAnswerSources } from './AnswerContextService.js';
import { validateModelAnswer } from './AnswerValidationService.js';
import { understandQuestion } from './ConversationService.js';
import { relevantStatements } from './AnswerRelevanceService.js';
export async function answer(input: string, conversation?: ChatContext, access?: Access) {
  // Reject inaccessible previous evidence before sending any private context to the model.
  if (
    conversation?.evidence.length &&
    translationRequest(input) &&
    !previousContext(conversation.evidence, access).length
  ) {
    return {
      answer: 'אין מקורות נגישים לתרגום התשובה הקודמת.',
      sources: [],
      highlighted: [],
      evidence: [],
      mode: 'no-sources',
    };
  }
  const timings: Record<string, number> = {};
  const start = performance.now();
  const plan = await understandQuestion(input, conversation, access, timings);
  timings.modelCalls = plan.modelCalls;
  let { question, history, feedback, query, currentQuestion, modelCalls, global, organization } =
    plan;
  const selection = await selectAnswerSources(plan, access, timings);
  modelCalls = plan.modelCalls;
  timings.modelCalls = modelCalls;
  if (selection.kind === 'clarification') return selection.response;
  const { sources, eligibleDocuments } = selection;
  timings.retrievalMs = performance.now() - start;
  const conversationContext = {
    question: currentQuestion,
    ...(organization ? { subject: organization } : {}),
    evidence: [],
  };
  const empty = {
    sources: [],
    highlighted: [],
    evidence: [],
    mode: 'no-sources',
    timings,
    conversationContext,
  };
  if (!sources.length)
    return { ...empty, answer: 'לא נמצאו קטעי מקור מתאימים לשאלה. אין מספיק מידע לתשובה מבוססת.' };
  const years = currentQuestion.match(/\b(?:19|20)\d{2}\b/g) || [];
  if (years.some((year) => !sources.some((s) => s.text.includes(year))))
    return {
      ...empty,
      answer: 'לא נמצא במקורות מידע על השנה שנשאלה. אין מספיק מידע לתשובה מבוססת.',
    };
  if (
    requiredIdentifiers(query).some(
      (id) => !sources.some((s) => s.text.toLowerCase().includes(id.toLowerCase())),
    )
  )
    return { ...empty, answer: 'לא נמצא במקורות מידע על המזהה המדויק שבשאלה.' };
  const { evidence, context } = prepareAnswerEvidence(sources, query, global);
  if (!evidence.length) return { ...empty, answer: 'לא נמצאו קטעי מקור מתאימים לשאלה.' };
  const generationStart = performance.now();
  const request = buildAnswerRequest({
    question,
    currentQuestion,
    query,
    organization,
    global,
    feedback,
    translating: plan.translating,
    conversation: history,
    context,
    evidence,
    tasks: plan.tasks,
  });
  const raw = await ollama(request.messages, request.schema);
  timings.generationMs = performance.now() - generationStart;
  timings.modelCalls = ++modelCalls;
  timings.contextChars = context.length;
  const generation = { provider: 'ollama', model, modelCalls };
  const coverage = {
    eligibleDocuments: eligibleDocuments ?? null,
    contextDocuments: sources.length,
    scope: global ? 'bounded excerpts across the corpus' : 'retrieved relevant excerpts',
  };
  let statements = validateModelAnswer(
    raw,
    sources,
    evidence,
    global,
    request.tasks,
    request.english,
    plan.tasks ? previousPerson(currentQuestion, sources) : undefined,
  );
  if (statements.length && !global) {
    const started = performance.now();
    statements = await relevantStatements(currentQuestion, statements);
    timings.relevanceMs = performance.now() - started;
    timings.modelCalls = ++modelCalls;
    generation.modelCalls = modelCalls;
  }
  if (!statements.length)
    return {
      answer:
        'המודל לא הפיק תשובה שניתן לתמוך בה בקטעי המקור. אפשר לעיין במקורות או למקד את השאלה.',
      sources,
      highlighted: sources.map((s) => s.documentId),
      evidence: [],
      mode: 'no-supported-answer',
      conversationContext,
      generation,
      coverage,
      timings,
    };
  const used = sources.filter((s) => statements.some((e) => e.source === s.citation));
  recordChat();
  return {
    answer: statements.map((s) => `${s.text} [${s.source}]`).join('\n\n'),
    sources: used,
    highlighted: used.map((s) => s.documentId),
    evidence: statements,
    mode: 'ollama',
    generation,
    coverage,
    timings,
    conversationContext: {
      question: currentQuestion,
      answer: statements
        .map((s) => s.text)
        .join('\n')
        .slice(0, 4000),
      ...(organization ? { subject: organization } : {}),
      evidence: statements.slice(0, 4).map((e) => ({ documentId: e.documentId, quote: e.quote })),
    },
  };
}
