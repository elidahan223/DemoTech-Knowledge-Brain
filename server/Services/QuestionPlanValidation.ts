import { numbersSupported } from '../claim-checks.js';
import { requiredIdentifiers } from '../query-constraints.js';

export class AiResponseError extends Error {
  readonly status = 502;
  readonly code = 'LOCAL_AI_INVALID_RESPONSE';
  constructor() {
    super('המודל המקומי לא החזיר תוכנית חיפוש תקינה. נסו לנסח את השאלה מחדש.');
  }
}

export function parseQuestionPlan(raw: string, original: string) {
  let plan: Record<string, unknown>;
  try {
    plan = JSON.parse(raw);
  } catch {
    throw new AiResponseError();
  }
  if (
    !plan ||
    !['search', 'corpus', 'profile', 'translate', 'feedback', 'responsibilities'].includes(
      String(plan.intent),
    ) ||
    typeof plan.question !== 'string' ||
    plan.question.trim().length < 2 ||
    plan.question.length > 2000 ||
    !(
      plan.organization === null ||
      (typeof plan.organization === 'string' && plan.organization.length <= 120)
    ) ||
    !numbersSupported(original, plan.question) ||
    requiredIdentifiers(original).some(
      (id) => !String(plan.question).toLowerCase().includes(id.toLowerCase()),
    )
  ) {
    throw new AiResponseError();
  }
  return {
    intent: plan.intent as
      | 'search'
      | 'corpus'
      | 'profile'
      | 'translate'
      | 'feedback'
      | 'responsibilities',
    question: plan.question.trim(),
    organization: typeof plan.organization === 'string' ? plan.organization.trim() : undefined,
    tasks: plan.intent === 'responsibilities',
  };
}
