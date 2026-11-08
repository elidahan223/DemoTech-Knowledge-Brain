import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankEvidence } from '../server/evidence-ranking';
import { requiredIdentifiers } from '../server/query-constraints';
import {
  numbersSupported,
  englishEvidenceOverlap,
  topicWordsSupported,
} from '../server/claim-checks';
test('concrete matching evidence outranks a generic introduction, under a context budget', () => {
  const generic = { text: 'This service must meet the defined budget.' };
  const actual = { text: 'GPU overhead budget: less than 0.5% utilization.' };
  const unrelated = { text: 'Unrelated office information.' };
  const ranked = rankEvidence('What GPU overhead budget applies?', [generic, unrelated, actual]);
  assert.equal(ranked[0], actual);
  assert.ok(
    rankEvidence('budget', [generic, actual], 80).reduce((n, p) => n + p.text.length, 0) <= 80,
  );
});
test('explicit business identifiers are mandatory constraints, ordinary technical terms are not', () => {
  assert.deepEqual(requiredIdentifiers('What about asset ZQX-UNSEEN-90871?'), ['ZQX-UNSEEN-90871']);
  assert.deepEqual(requiredIdentifiers('עסקה NO-SUCH-DEAL-90871'), ['NO-SUCH-DEAL-90871']);
  assert.deepEqual(requiredIdentifiers('GPU overhead and perf-canary budget?'), []);
});
test('a real but irrelevant quote cannot support invented numeric values', () => {
  assert.equal(numbersSupported('retention 7 years', 'HIPAA covered PHI and audit logs'), false);
  assert.equal(numbersSupported('limit 1.5 times local pool', 'p95 <250ms'), false);
  assert.ok(numbersSupported('less than 0.5%', 'target <0.5% GPU'));
});
test('an English answer about blocking and error rates is not supported by an index introduction', () => {
  assert.equal(
    englishEvidenceOverlap(
      'Escalate immediately if any enterprise account is blocked or regional error rate spikes.',
      'This page is the landing index for Support and Customer Success. Clear escalation decisions.',
    ),
    false,
  );
});
test('short topic labels cannot add suppliers to an expense-only quote', () => {
  assert.equal(
    topicWordsSupported('ניהול הוצאות וספקים', 'החזר הוצאות לעובדים. בקשת החזר מוגשת עם קבלה.'),
    false,
  );
  assert.equal(topicWordsSupported('אישורים לרכישות', 'רכישת מחשב דורשת אישור.'), true);
});
