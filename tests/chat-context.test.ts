import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChatContext,
  translationRequest,
  overviewRequest,
  contextualQuestion,
} from '../server/chat-context';
test('Hebrew translation follow-ups reuse context rather than become searches', () => {
  for (const q of [
    'בעברית',
    'בעיברית',
    'תתרגם',
    'תרגם את התשובה לעברית',
    'בבקשה תתרגם',
    'translate that to Hebrew',
  ])
    assert.equal(translationRequest(q), true, q);
  for (const q of ['איך עובד מנגנון התרגום?', 'תתרגם את מסמך הרכש החדש'])
    assert.equal(translationRequest(q), false, q);
});
test('broad organization questions use the repository overview', () => {
  assert.ok(overviewRequest('מה אתה יודע על הארגון '));
  assert.ok(overviewRequest('ספר לי על החברה'));
  assert.equal(overviewRequest('מה מדיניות החברה לגבי הרשאות?'), false);
});
test('follow-ups carry the prior question; independent questions do not', () => {
  const context = { question: 'מה התקציב של perf-canary?', evidence: [] };
  assert.ok(contextualQuestion('ומה לגבי לוגים?', context).includes(context.question));
  assert.equal(contextualQuestion('מי מאשר רכש?', context), 'מי מאשר רכש?');
});
test('browser conversation input is bounded and validated', () => {
  assert.equal(parseChatContext(undefined), undefined);
  assert.deepEqual(
    parseChatContext({
      question: 'previous',
      evidence: [{ documentId: 'd', quote: 'real evidence' }],
    }),
    { question: 'previous', evidence: [{ documentId: 'd', quote: 'real evidence' }] },
  );
  for (const value of [
    { question: 12, evidence: [] },
    { question: 'x', evidence: [{ documentId: 'd', quote: '' }] },
    { question: 'x', evidence: Array(5).fill({ documentId: 'd', quote: 'text' }) },
  ])
    assert.throws(() => parseChatContext(value));
});
