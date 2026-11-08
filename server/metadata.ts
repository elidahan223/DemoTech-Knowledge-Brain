export function documentMetadata(text: string) {
  const separator = text.indexOf('\n---');
  if (separator < 0 || separator > 4096)
    return {
      externalId: text.match(/(?:^|\n)מזהה מסמך:\s*([A-Z][A-Z0-9_-]{2,80})(?=\s|$)/)?.[1],
      title: undefined,
      sourceType: undefined,
    };
  const header = text.slice(0, separator);
  const value = (key: string) => header.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim();
  return { externalId: value('doc_id'), title: value('title'), sourceType: value('source_type') };
}
export function safeSlice(text: string, start: number, end: number) {
  start = Math.max(0, start);
  end = Math.min(text.length, end);
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text[start]) && /[\uD800-\uDBFF]/.test(text[start - 1]))
    start--;
  if (
    end < text.length &&
    /[\uDC00-\uDFFF]/.test(text[end]) &&
    /[\uD800-\uDBFF]/.test(text[end - 1])
  )
    end++;
  return text.slice(start, end);
}
export function supportingSnippet(text: string, term: string, radius = 160) {
  const position = text.indexOf(term);
  return position < 0 ? '' : safeSlice(text, position - radius, position + term.length + radius);
}
