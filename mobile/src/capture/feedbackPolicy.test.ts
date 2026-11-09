import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VisionAssessment } from '../../../shared/contracts.ts';
import { FeedbackPolicy } from './feedbackPolicy.ts';

const hazard = (summary: string, key = `fixed:${summary}`): VisionAssessment => ({
  state: 'ok',
  frameSeq: 1,
  assessedAt: 0,
  spokenSummary: summary,
  hazards: [{ kind: 'fixed', label: 'furniture', direction: 'ahead', proximity: 'near' }],
  people: 'none',
  openSide: 'right',
  clearOfVisibleObstacles: false,
  alertKey: key,
});
const clear: VisionAssessment = {
  state: 'ok',
  frameSeq: 1,
  assessedAt: 0,
  spokenSummary: 'No fixed obstacles detected in view.',
  hazards: [],
  people: 'single',
  openSide: 'either',
  clearOfVisibleObstacles: true,
  alertKey: 'clear',
};

test('stale results are never spoken', () => {
  const p = new FeedbackPolicy();
  assert.equal(p.decide(hazard('Person ahead, close.'), 0, 3500), null);
});

test('hazards repeat every other fresh assessment and speak immediately on position change', () => {
  const p = new FeedbackPolicy();
  const ahead = hazard('Table ahead, close.', 'fixed:table:ahead');
  const right = hazard('Table slightly right, close.', 'fixed:table:slight_right');
  assert.equal(p.decide(ahead, 1000, 1500), 'Table ahead, close.');
  assert.equal(p.decide(ahead, 2000, 2500), null);
  assert.equal(p.decide(ahead, 3000, 3500), 'Table ahead, close.');
  assert.equal(p.decide(right, 4000, 4500), 'Table slightly right, close.');
  assert.equal(p.decide(right, 5000, 8500), null);
  assert.equal(p.decide(right, 9000, 9500), null);
  assert.equal(p.decide(right, 10000, 10500), 'Table slightly right, close.');
});

test('"no fixed obstacles detected" is spoken only on the transition from a hazard', () => {
  const p = new FeedbackPolicy();
  assert.equal(p.decide(clear, 0, 100), 'No fixed obstacles detected in view.'); // first result
  assert.equal(p.decide(clear, 1000, 1100), null);
  assert.equal(p.decide(clear, 2000, 2100), null);
  assert.equal(p.decide(hazard('Person ahead.'), 3000, 3100), 'Person ahead.');
  assert.equal(p.decide(clear, 4000, 4100), 'No fixed obstacles detected in view.');
});

test('errors are reported but rate-limited', () => {
  const p = new FeedbackPolicy();
  const err: VisionAssessment = { state: 'error', frameSeq: 1, message: 'x' };
  assert.match(p.decide(err, 0, 10) ?? '', /unavailable/);
  assert.equal(p.decide(err, 1000, 1010), null);
});

test('wording-only changes for the same obstacle are not re-announced', () => {
  const p = new FeedbackPolicy();
  assert.equal(p.decide(hazard('Furniture ahead. More room on the right.', 'fixed:furniture:ahead'), 0, 100), 'Furniture ahead. More room on the right.');
  assert.equal(p.decide(hazard('Furniture ahead. More room on the left.', 'fixed:furniture:ahead'), 1000, 1100), null);
  assert.equal(p.decide(hazard('Group of people ahead.', 'people:group:ahead'), 2000, 2100), 'Group of people ahead.');
});

test('a changed opening is announced on the next fresh assessment', () => {
  const p = new FeedbackPolicy();
  const left = 'Table ahead. Opening on the left.';
  const right = 'Table ahead. Opening on the right.';
  assert.equal(p.decide(hazard(left, 'fixed:table:ahead:opening:left'), 1000, 1100), left);
  assert.equal(p.decide(hazard(right, 'fixed:table:ahead:opening:right'), 2000, 2100), right);
});

test('a person is announced once confirmed in successive fresh views and close ahead', () => {
  const p = new FeedbackPolicy();
  const view = (seq: number, standingPerson: 'in_front' | 'close_ahead' | undefined) => ({
    ...clear,
    frameSeq: seq,
    people: 'single' as const,
    standingPerson,
  });
  assert.equal(p.decide(view(1, 'close_ahead'), 1000, 1100), clear.spokenSummary);
  assert.equal(p.decide(view(2, undefined), 2000, 2100), null);
  assert.equal(p.decide(view(3, 'in_front'), 3000, 6100), null);
  assert.equal(p.decide(view(4, 'close_ahead'), 4000, 6200), null);
  assert.equal(p.decide(view(5, 'in_front'), 5000, 6300), null);
  assert.equal(p.decide(view(6, 'close_ahead'), 6000, 6400), 'Person ahead, close.');
  assert.equal(p.decide(view(7, 'close_ahead'), 7000, 7100), null);
  assert.equal(p.decide(view(8, 'close_ahead'), 8000, 8100), 'Person ahead, close.');
});
