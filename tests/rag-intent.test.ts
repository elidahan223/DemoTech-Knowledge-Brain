import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  organizationQuestion,
  pronounQuestion,
  feedbackRequest,
  namedOrganization,
  parseChatContext,
  corpusQuestion,
  organizationNameReply,
  normalizeMessage,
} from '../server/chat-context';
import { readableSource } from '../shared/source-format';
import { plannedActivity } from '../server/claim-checks';
test('real reported conversation is routed as organization, pronoun and feedback intents', () => {
  assert.ok(organizationQuestion('מה ניתן לומר על הארגון?'));
  assert.ok(organizationQuestion('מה זה הארגון שאנחנו עובדים איתו?'));
  assert.ok(pronounQuestion('ומה הוא עושה?'));
  assert.ok(feedbackRequest('לא תשובה טובה'));
  assert.ok(feedbackRequest('לא נכון'));
});
test('product requests are not company clarifications and natural corpus questions cover the collection', () => {
  for (const q of ['ספר לי על ServiceDesk', 'מה ServiceDesk עושה?', 'What does AssetTrack do?'])
    assert.equal(organizationQuestion(q), false, q);
  assert.equal(corpusQuestion('על מה המסמכים מדברים?'), true);
  assert.equal(corpusQuestion('מה קוד הבקרה של מסמך הרכש?'), false);
});

test('questions with conversational prefixes are never organization-name replies', () => {
  const context = { question: 'which organization?', awaitingOrganization: true, evidence: [] };
  for (const q of [
    'אוקי מי אחראי על הכספים',
    'כן, אוקיי, מי אחראי על הכספים?',
    'אני רוצה לדעת מי אחראי על הכספים',
    'okay who handles finance',
    'תודה תסביר את הנוהל',
  ]) {
    assert.equal(organizationNameReply(q), false, q);
    assert.equal(namedOrganization(q, context), undefined, q);
  }
  assert.equal(normalizeMessage('אוקי מי אחראי על הכספים'), 'מי אחראי על הכספים');
  assert.equal(normalizeMessage('Okay Industries'), 'Okay Industries');
  assert.ok(organizationNameReply('Bayberry HostedAI Solutions'));
});
test('a pending organization clarification does not swallow a new document question', () => {
  for (const q of ['מה נודשא כל הקבצים שש לנו', 'מה הנושא של הקבצים']) {
    assert.ok(corpusQuestion(q));
    assert.equal(organizationNameReply(q), false);
    assert.equal(
      namedOrganization(q, { question: 'which?', awaitingOrganization: true, evidence: [] }),
      undefined,
    );
  }
  assert.equal(organizationNameReply('מה זמן הטיפול בתקלה'), false);
  assert.equal(organizationNameReply('תתרגם'), false);
  assert.ok(organizationNameReply('Bayberry HostedAI Solutions'));
});
test('source formatting changes presentation, not quote content or stored offsets', () => {
  const raw = 'first\\nsecond';
  assert.equal(readableSource(raw), 'first\nsecond');
  assert.equal(raw, 'first\\nsecond');
});
test('planned company features are explicitly presented as plans', () => {
  assert.ok(
    plannedActivity(
      'החברה משלבת עוזר',
      'Customer support SaaS that will embed an assistant.',
    ).startsWith('לפי התכנון'),
  );
});
test('an explicitly named organization survives pronouns and similar names stay distinct', () => {
  const c = { question: 'profile', subject: 'Northstar Health', evidence: [] };
  assert.equal(namedOrganization('ומה הוא עושה?', c), 'Northstar Health');
  assert.equal(namedOrganization('What does Northstar Healthcare do?', c), 'Northstar Healthcare');
  assert.equal(
    namedOrganization('Redwood', { question: 'which?', awaitingOrganization: true, evidence: [] }),
    'Redwood',
  );
  assert.equal(parseChatContext(c)?.subject, c.subject);
  assert.equal(namedOrganization('מה חברת Northstar BridgeWorks עושה?'), 'Northstar BridgeWorks');
});
