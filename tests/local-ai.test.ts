import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localOllamaUrl, assertLocalModelName } from '../server/Settings/LocalAiPolicy';
import { parseQuestionPlan, AiResponseError } from '../server/Services/QuestionPlanValidation';
import { runLocalModel } from '../server/Services/LocalModelQueue';

test('local AI policy rejects remote services and cloud model names', () => {
  for (const url of ['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434'])
    assert.ok(localOllamaUrl(url));
  for (const url of [
    'https://example.com',
    'http://10.0.0.1:11434',
    'http://localhost.example.com',
    'http://user:password@127.0.0.1',
  ])
    assert.throws(() => localOllamaUrl(url));
  assert.equal(assertLocalModelName('gemma3:4b'), 'gemma3:4b');
  for (const model of ['model-cloud', 'Model-CLOUD', 'https://api.example.com/model', ''])
    assert.throws(() => assertLocalModelName(model));
});
test('model-produced plans preserve explicit amounts and document IDs without heuristic fallback', () => {
  const valid = {
    intent: 'search',
    question: 'מי מאשר רכישה ב-6,000 ש״ח לפי FIN-001?',
    organization: null,
  };
  assert.equal(parseQuestionPlan(JSON.stringify(valid), valid.question).intent, 'search');
  assert.equal(
    parseQuestionPlan(JSON.stringify({ ...valid, intent: 'responsibilities' }), valid.question)
      .tasks,
    true,
  );
  assert.throws(
    () =>
      parseQuestionPlan(JSON.stringify({ ...valid, question: 'מי מאשר רכישה?' }), valid.question),
    AiResponseError,
  );
  for (const raw of ['not JSON', 'null', '{}', JSON.stringify({ ...valid, intent: 'invented' })])
    assert.throws(() => parseQuestionPlan(raw, 'שאלה'), AiResponseError);
});
test('one inference runs at a time and queued interactive work precedes background analysis', async () => {
  let release!: () => void;
  const order: string[] = [];
  let active = 0,
    max = 0;
  const work =
    (label: string, wait = false) =>
    async () => {
      active++;
      max = Math.max(max, active);
      order.push(label);
      if (wait)
        await new Promise<void>((r) => {
          release = r;
        });
      active--;
      return label;
    };
  const first = runLocalModel(work('started', true), true);
  const background = runLocalModel(work('background'), true);
  const foreground = runLocalModel(work('interactive'));
  release();
  await Promise.all([first, background, foreground]);
  assert.equal(max, 1);
  assert.deepEqual(order, ['started', 'interactive', 'background']);
});
