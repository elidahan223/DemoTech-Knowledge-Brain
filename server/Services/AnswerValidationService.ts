import { matchQuotedEvidence, type AnswerSource } from '../answer-context.js';
import { englishEvidenceOverlap, numbersSupported, topicWordsSupported } from '../claim-checks.js';
import type { Evidence, ValidatedStatement } from '../Models/ChatModels.js';
import { getCitationDocument } from '../Repositories/ChatRepository.js';

export function validateModelAnswer(
  raw: string,
  sources: AnswerSource[],
  evidence: Evidence[],
  global: boolean,
  tasks: boolean,
  english: boolean,
  requiredPerson?: string,
): ValidatedStatement[] {
  let parsed: {
    statements?: { text: unknown; evidence: unknown; quote?: unknown }[];
    topics?: { topic: unknown; evidence: unknown; quote: unknown }[];
    responsibilities?: { task: unknown; evidence: unknown; quote?: unknown }[];
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }
  if (global)
    parsed.statements = Array.isArray(parsed.topics)
      ? parsed.topics.map((t) => ({ text: t.topic, evidence: t.evidence, quote: t.quote }))
      : [];
  else if (tasks)
    parsed.statements = Array.isArray(parsed.responsibilities)
      ? parsed.responsibilities.map((t) => ({ text: t.task, evidence: t.evidence, quote: t.quote }))
      : [];
  const statements = (Array.isArray(parsed.statements) ? parsed.statements : [])
    .slice(0, 8)
    .flatMap((s) => {
      if (
        typeof s.text !== 'string' ||
        !s.text.trim() ||
        s.text.length > 900 ||
        (!english && !/[א-ת]{2}/.test(s.text))
      )
        return [];
      const e = matchQuotedEvidence(evidence, s.evidence, s.quote);
      if (!e) return [];
      const source = sources.find((s) => s.citation === e.source)!;
      const quote = (s.quote as string).trim();
      const d = getCitationDocument(source.documentId);
      const offset = d.text.indexOf(quote);
      const text = s.text
        .trim()
        .replace(/\s*[([]E\d+(?:,\s*E\d+)*[)\]]|\[\d+(?:\.\d+)?\]|\bE\d+\b/g, '')
        .replace(/\s+([.,])/g, '$1')
        .trim();
      if (offset < 0 || !numbersSupported(text, quote) || !englishEvidenceOverlap(text, quote))
        return [];
      if (global && !topicWordsSupported(text, source.title + ' ' + quote)) return [];
      if (tasks && requiredPerson && !quote.includes(requiredPerson)) return [];
      if (tasks && /עד\s*\d/.test(text) && /מעל\s*\d/.test(quote) && !/עד\s*\d/.test(quote))
        return [];
      if (tasks && /מעל\s*\d/.test(text) && /עד\s*\d/.test(quote) && !/מעל\s*\d/.test(quote))
        return [];
      return [
        {
          text,
          source: e.source,
          quote,
          documentId: source.documentId,
          startOffset: offset,
          endOffset: offset + quote.length,
        },
      ];
    });
  return statements;
}
