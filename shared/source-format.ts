/** Presentation only. Storage, exact quotes and UTF-16 offsets stay unchanged. */
export function readableSource(text: string) {
  return text.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, '\t');
}
