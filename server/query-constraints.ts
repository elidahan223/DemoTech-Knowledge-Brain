/** An explicit ticket/asset/deal identifier is a constraint, not an optional
 * keyword. A semantically similar document about another identifier cannot answer it. */
export function requiredIdentifiers(question: string) {
  return [...new Set(question.match(/\b[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+\b/g) || [])].filter((id) =>
    /\d/.test(id),
  );
}
