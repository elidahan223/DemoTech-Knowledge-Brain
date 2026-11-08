import {
  contentExcerpt,
  corpusContext,
  organizationSources,
  previousContext,
  type AnswerSource,
} from '../answer-context.js';
import { rankEvidence } from '../evidence-ranking.js';
import type { QuestionPlan } from '../Models/ChatModels.js';
import { searchSources } from '../retrieval.js';
import { type Access } from '../store.js';
import { rankAnswerSources } from './SourceRankingService.js';

export async function selectAnswerSources(
  plan: QuestionPlan,
  access: Access,
  timings: Record<string, number>,
) {
  const { question, subject, history, translating, global, profile, organization, query } = plan;
  let sources: AnswerSource[] = [];
  let eligibleDocuments: number | undefined;
  if (translating) sources = previousContext(history.evidence, access);
  else if (global) {
    const context = corpusContext(access);
    sources = context.sources;
    eligibleDocuments = context.total;
  } else {
    const anchors = organization ? organizationSources(organization, access) : [];
    if (profile && !anchors.length)
      return {
        kind: 'clarification' as const,
        response: {
          answer: 'לאיזה ארגון הכוונה? אין במקורות פרופיל שתואם באופן מבוסס לארגון שנשאל עליו.',
          sources: [],
          highlighted: [],
          evidence: [],
          mode: 'clarify-organization',
          conversationContext: { question, awaitingOrganization: true, evidence: [] },
        },
      };
    sources = [...(await searchSources(query, 16, { access, timings })), ...anchors];
    const seen = new Set<string>();
    sources = sources
      .filter((s) => {
        if (seen.has(s.documentId)) return false;
        seen.add(s.documentId);
        return true;
      })
      .slice(0, 16)
      .map((s, i) => ({ ...s, text: contentExcerpt(s.text, 2000), citation: i + 1 }));
    if (sources.length) {
      const started = performance.now();
      sources = await rankAnswerSources(plan.currentQuestion, sources);
      timings.rerankingMs = performance.now() - started;
      plan.modelCalls++;
    }
  }
  return { kind: 'sources' as const, sources, eligibleDocuments };
}
export function prepareAnswerEvidence(sources: AnswerSource[], query: string, global: boolean) {
  const paragraphs = sources.flatMap((s) =>
    global
      ? [{ text: s.text, source: s.citation }]
      : s.text
          .split(/\n\s*\n/)
          .flatMap((p) => p.split(/(?<=[.!?;])\s+/))
          .filter((p) => p.trim().length >= 12)
          .map((p) => ({ text: p.trim(), source: s.citation })),
  );
  const selected = global ? paragraphs : rankEvidence(query, paragraphs, 12000);
  const evidence = selected.map((p, i) => ({ ...p, id: `E${i + 1}` }));

  const context = evidence
    .map(
      (e) =>
        `[${e.id}] Document: ${sources.find((s) => s.citation === e.source)!.title}\n${e.text}`,
    )
    .join('\n\n');
  return { evidence, context };
}
