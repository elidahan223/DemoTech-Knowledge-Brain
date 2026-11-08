import type { ChatContext } from '../shared/chat';
const questionWords =
  /(?:^|\s)(?:ו?מה|ו?איך|ו?מי|ו?למה|האם|כמה|איפה|מתי|מי אחראי|תסביר|תסכם|ספר|תגיד|תגידי|תוכל|אפשר|what|how|who|why|where|when|please|tell|explain)(?:\s|$)|[?？]/i;
export function normalizeMessage(question: string) {
  const original = question.trim();
  let stripped = original;
  for (let i = 0; i < 6; i++) {
    const next = stripped
      .replace(/^(?:אוקי|אוקיי|אוקייי|טוב|בסדר|כן|תודה|okay|ok|thanks|alright)[\s,.:!–—-]+/i, '')
      .trim();
    if (next === stripped) break;
    stripped = next;
  }
  return questionWords.test(stripped) ? stripped : original;
}
export function parseChatContext(value: unknown): ChatContext | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object') throw Error('הקשר שיחה לא תקין');
  const c = value as Partial<ChatContext>;
  if (
    typeof c.question !== 'string' ||
    c.question.length > 2000 ||
    !Array.isArray(c.evidence) ||
    c.evidence.length > 4 ||
    c.evidence.some(
      (e) =>
        !e ||
        typeof e.documentId !== 'string' ||
        e.documentId.length > 200 ||
        typeof e.quote !== 'string' ||
        !e.quote.trim() ||
        e.quote.length > 2400,
    )
  )
    throw Error('הקשר שיחה לא תקין');
  if (c.subject !== undefined && (typeof c.subject !== 'string' || c.subject.length > 120))
    throw Error('נושא שיחה לא תקין');
  if (c.answer !== undefined && (typeof c.answer !== 'string' || c.answer.length > 4000))
    throw Error('תשובה קודמת לא תקינה');
  return {
    question: c.question,
    ...(c.answer ? { answer: c.answer } : {}),
    ...(c.subject ? { subject: c.subject } : {}),
    ...(c.awaitingOrganization === true ? { awaitingOrganization: true } : {}),
    evidence: c.evidence.map((e) => ({ documentId: e.documentId, quote: e.quote })),
  };
}
export function feedbackRequest(question: string) {
  return /^(?:לא תשובה טובה|לא נכון|זה לא נכון|התשובה לא נכונה|לא ענית|זה לא מה ששאלתי|wrong|bad answer|that is incorrect)(?:[.!?,:]|\s|$)/i.test(
    question.trim(),
  );
}
export function organizationQuestion(question: string) {
  return (
    /מה ניתן לומר על הארגון|מה זה הארגון|איזה ארגון|מי הארגון|מהו הארגון|מי החברה|מה החברה עושה|מה הארגון עושה|מה פעילות|מה הפעילות העסקית|מה תחום הפעילות|company profile|business activity|^מה חברת .+ עושה|^פרופיל /i.test(
      question,
    ) || overviewRequest(question)
  );
}
export function pronounQuestion(question: string) {
  return /^(?:ו?מה (?:הוא|היא|הם|זה|הארגון|החברה) (?:עושה|עושים|עושות|מספק|מוכר)|ו?מי (?:הוא|היא)|what does (?:it|they) do)[?!\s]*$/i.test(
    question.trim(),
  );
}
export function namedOrganization(question: string, context?: ChatContext) {
  const q = question.trim().replace(/[?!.,]+$/, '');
  const hebrew = q.match(/^מה (?:חברת |ארגון )?(.+?) (?:עושה|מייצרת|מספקת)$/);
  if (hebrew && !pronounQuestion(q)) return hebrew[1].trim();
  const explicit = q.match(
    /^(?:what does (.+) do|(?:מה (?:הפעילות העסקית|תחום הפעילות) של|ספר(?:י)? לי על|פרופיל (?:של )?)\s*(.+))$/i,
  );
  if (explicit) return (explicit[1] || explicit[2]).trim();
  if (context?.awaitingOrganization && organizationNameReply(q)) return q;
  return context?.subject;
}
export function corpusQuestion(question: string) {
  return (
    /(?:קבצים|הקבצים|מסמכים|המסמכים|מאגר|המאגר|files|documents|corpus)/i.test(question) &&
    /(?:נושא|נודשא|נושאים|תוכן|עוסקים|עוסק|מדברים|על מה|מה יש|מה נמצא|סקירה|סיכום|topics?|about|contents?)/i.test(
      question,
    )
  );
}
export function organizationNameReply(question: string) {
  const q = normalizeMessage(question);
  return (
    /^[\p{L}\p{N}][\p{L}\p{N} .&'-]{1,100}$/u.test(q) &&
    !questionWords.test(q) &&
    !organizationQuestion(q) &&
    !pronounQuestion(q) &&
    !feedbackRequest(q) &&
    !translationRequest(q) &&
    !corpusQuestion(q)
  );
}
export function translationRequest(question: string) {
  return /^(?:(?:בבקשה|אפשר|נא)\s+)?(?:ב[עא]י?ברית|בעברית|תתרגם|תרגם|תרגמי|תרגום|תתרגמי|translate(?:\s+(?:it|that|this|the (?:last |previous )?answer))?)(?:\s+(?:את זה|את התשובה|לעברית|בעברית|to Hebrew|in Hebrew|please))*[.!?\s]*$/i.test(
    question.trim(),
  );
}
export function overviewRequest(question: string) {
  return /^(?:מה (?:אתה |את |אתם )?יודע(?:ת|ים)? על (?:הארגון|החברה)|ספר(?:י)? (?:לי )?על (?:הארגון|החברה)|(?:תן|תני|אפשר) (?:לי )?(?:סקירה|תקציר) (?:על )?(?:הארגון|החברה)|what do you know about (?:the organization|the company))[.!?\s]*$/i.test(
    question.trim(),
  );
}
export function contextualQuestion(question: string, context?: ChatContext) {
  return context &&
    /^(?:ומה|ואיך|ולמה|ומי|וכמה|ומה לגבי|מה לגבי|תפרט|תפרטי|הרחב|הרחיבי|עוד פרטים|למה|מה המשמעות|what about|and what|why|tell me more)(?:\s|[?!.,]|$)/i.test(
      question.trim(),
    )
    ? `${context.question}\nשאלת המשך: ${question}`
    : question;
}
