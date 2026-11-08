/** Query-dependent, bounded context. A shared title must not make a generic
 * introduction outrank the paragraph containing the actual requested limits. */
export function rankEvidence<T extends { text: string }>(
  question: string,
  paragraphs: T[],
  maxChars = 14000,
) {
  const stop = new Set(
    'what which does the and with for from this that about according answer english impose'.split(
      ' ',
    ),
  );
  const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || [])].filter(
    (t) => !stop.has(t),
  );
  const score = (p: T) => {
    const text = p.text.toLowerCase();
    let value = 0;
    for (const term of terms)
      if (text.includes(term)) {
        const frequency = paragraphs.reduce(
          (n, p) => n + Number(p.text.toLowerCase().includes(term)),
          0,
        );
        value += Math.log(1 + paragraphs.length / (1 + frequency));
      }
    return value * (/\d/.test(text) ? 1.15 : 1);
  };
  const ranked = paragraphs
    .map((p, i) => ({ p, i, score: score(p) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const chosen: T[] = [];
  let chars = 0;
  for (const { p } of ranked) {
    if (chars + p.text.length > maxChars) continue;
    chosen.push(p);
    chars += p.text.length;
    if (chosen.length >= 18) break;
  }
  return chosen;
}
