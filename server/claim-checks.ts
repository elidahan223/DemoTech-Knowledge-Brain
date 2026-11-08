/** Necessary consistency check, NOT a semantic entailment proof. Reject
 * invented numeric values even when the model attached a real source quote. */
export function numbersSupported(statement: string, quote: string) {
  const numbers = (text: string) => text.match(/\d+(?:[.,]\d+)*/g) || [];
  const present = new Set(numbers(quote).map((n) => n.replaceAll(',', '')));
  return numbers(statement).every((n) => present.has(n.replaceAll(',', '')));
}
/** Conservative check for English answers; it rejects unrelated introductions.
 * Hebrew translation needs a bilingual entailment model, so this check does not
 * pretend that English token overlap can validate a Hebrew paraphrase. */
export function englishEvidenceOverlap(statement: string, quote: string) {
  const stop = new Set(
    'the and for with this that from into then what which does have has are was were its not if one'.split(
      ' ',
    ),
  );
  const words = [
    ...new Set((statement.toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !stop.has(w))),
  ];
  const hebrew = (statement.match(/[א-ת]+/g) || []).length;
  if (hebrew >= words.length || words.length < 6) return true;
  const body = quote.toLowerCase();
  return words.filter((w) => body.includes(w)).length / words.length >= 0.2;
}
export function plannedActivity(text: string, quote: string, english = false) {
  return /\bwill\b|\bplans? to\b/i.test(quote)
    ? (english ? 'According to the plan described in the source: ' : 'לפי התכנון המתואר במקור: ') +
        text
    : text;
}
/** Lexical guard for short Hebrew topic labels, not semantic entailment. */
export function topicWordsSupported(topic: string, source: string) {
  if (!/[א-ת]/.test(topic) || !/[א-ת]/.test(source)) return true;
  const generic = new Set(['ניהול', 'תהליך', 'תהליכים', 'מדיניות', 'מסמכים', 'נושא', 'נושאים']);
  const words = (text: string) =>
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length >= 3);
  const forms = (word: string) => {
    const variants = [word];
    if (word.length > 4 && /^[והבכלמש]/.test(word)) variants.push(word.slice(1));
    return variants.flatMap((w) => [w, w.length > 4 ? w.replace(/(?:ים|ות|ת|ה)$/, '') : w]);
  };
  const body = new Set(words(source).flatMap(forms));
  const specific = words(topic).filter((w) => !forms(w).some((v) => generic.has(v)));
  return (
    !specific.length ||
    specific.filter((w) => forms(w).some((v) => body.has(v))).length / specific.length >= 0.75
  );
}
