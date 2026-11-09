import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VisionAssessment } from '../../../shared/contracts.ts';
import { FeedbackPolicy, REPEAT_HAZARD_MS } from './feedbackPolicy.ts';

const hazard = (summary: string): VisionAssessment => ({
  state: 'ok',
  frameSeq: 1,
  assessedAt: 0,
  spokenSummary: summary,
  hazards: [{ label: 'person', direction: 'ahead', proximity: 'near' }],
  clearOfVisibleObstacles: false,
});
const clear: VisionAssessment = {
  state: 'ok',
  frameSeq: 1,
  assessedAt: 0,
  spokenSummary: 'No obstacles detected in view.',
  hazards: [],
  clearOfVisibleObstacles: true,
};

test('stale results are never spoken', () => {
  const p = new FeedbackPolicy();
  assert.equal(p.decide(hazard('Person ahead, close.'), 0, 3500), null);
});

test('hazards speak on change and repeat only after the interval', () => {
  const p = new FeedbackPolicy();
  assert.equal(p.decide(hazard('Person ahead, close.'), 1000, 1500), 'Person ahead, close.');
  assert.equal(p.decide(hazard('Person ahead, close.'), 2000, 2500), null);
  assert.equal(p.decide(hazard('Furniture on the left.'), 3000, 3500), 'Furniture on the left.');
  const later = 3500 + REPEAT_HAZARD_MS;
  assert.equal(p.decide(hazard('Furniture on the left.'), later - 100, later), 'Furniture on the left.');
});

test('"no obstacles detected" is spoken only on the transition from a hazard', () => {
  const p = new FeedbackPolicy();
  assert.equal(p.decide(clear, 0, 100), 'No obstacles detected in view.'); // first result
  assert.equal(p.decide(clear, 1000, 1100), null);
  assert.equal(p.decide(clear, 2000, 2100), null);
  assert.equal(p.decide(hazard('Person ahead.'), 3000, 3100), 'Person ahead.');
  assert.equal(p.decide(clear, 4000, 4100), 'No obstacles detected in view.');
});

test('errors are reported but rate-limited', () => {
  const p = new FeedbackPolicy();
  const err: VisionAssessment = { state: 'error', frameSeq: 1, message: 'x' };
  assert.match(p.decide(err, 0, 10) ?? '', /unavailable/);
  assert.equal(p.decide(err, 1000, 1010), null);
});
