import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Steer, VisionAssessment } from '../../../shared/contracts.ts';
import { FeedbackPolicy } from './feedbackPolicy.ts';

let seq = 0;
const blocked = (summary: string, key: string, steer: Steer = 'veer_right', over: Partial<Extract<VisionAssessment, { state: 'ok' }>> = {}): VisionAssessment => ({
  state: 'ok',
  frameSeq: ++seq,
  assessedAt: 0,
  spokenSummary: summary,
  hazards: [{ kind: 'fixed', label: 'table_or_counter', direction: 'ahead', proximity: 'near', position: 'center' }],
  people: 'none',
  openSide: 'right',
  steer,
  facingWall: false,
  clearOfVisibleObstacles: false,
  alertKey: key,
  ...over,
});
const clear = (): VisionAssessment => ({
  state: 'ok',
  frameSeq: ++seq,
  assessedAt: 0,
  spokenSummary: 'Path ahead looks clear.',
  hazards: [],
  people: 'none',
  openSide: 'either',
  steer: 'straight',
  facingWall: false,
  clearOfVisibleObstacles: true,
  alertKey: 'clear',
});

test('results older than the 4 s budget are never spoken', () => {
  const p = new FeedbackPolicy();
  assert.equal(p.decide(blocked('Veer right. Table ahead.', 'k'), 0, 4500), null);
  assert.equal(p.decide(blocked('Veer right. Table ahead.', 'k'), 0, 3900), 'Veer right. Table ahead.');
});

test('a blocked path repeats every other fresh assessment; a new steer speaks at once', () => {
  const p = new FeedbackPolicy();
  const right = 'Veer right. Table or counter ahead, close.';
  const left = 'Veer left. Table or counter ahead, close.';
  assert.equal(p.decide(blocked(right, 'fixed:table:center:veer_right'), 1000, 1500), right);
  assert.equal(p.decide(blocked(right, 'fixed:table:center:veer_right'), 2000, 2500), null);
  assert.equal(p.decide(blocked(right, 'fixed:table:center:veer_right'), 3000, 3500), right);
  assert.equal(p.decide(blocked(left, 'fixed:table:center:veer_left', 'veer_left'), 4000, 4500), left);
});

test('"Path ahead looks clear" only at the start and after a blocked path', () => {
  const p = new FeedbackPolicy();
  assert.equal(p.decide(clear(), 0, 100), 'Path ahead looks clear.');
  assert.equal(p.decide(clear(), 1000, 1100), null);
  assert.equal(p.decide(blocked('Veer left. Chair ahead.', 'fixed:chair:center:veer_left', 'veer_left'), 2000, 2100), 'Veer left. Chair ahead.');
  assert.equal(p.decide(clear(), 3000, 3100), 'Path ahead looks clear.');
});

test('facing a wall is spoken like any blocked path', () => {
  const p = new FeedbackPolicy();
  const wall = blocked('Turn left to find a path. Wall or door ahead.', 'fixed:wall_or_door:center:turn_left', 'turn_left', { facingWall: true });
  assert.equal(p.decide(wall, 0, 500), 'Turn left to find a path. Wall or door ahead.');
});

test('a close standing person needs two consecutive fresh frames; a far one is never spoken', () => {
  const p = new FeedbackPolicy();
  const person = (_n: number) =>
    blocked('Veer left. Person standing ahead, close.', 'people:person_standing:center:veer_left', 'veer_left', {
      standingPerson: 'close_ahead',
    });
  assert.equal(p.decide(person(0), 1000, 1500), null);
  assert.equal(p.decide(person(1), 2000, 2500), 'Veer left. Person standing ahead, close.');
  const far = new FeedbackPolicy();
  const inFront = () =>
    blocked('Veer left. Person standing ahead.', 'people:person_standing:center:veer_left', 'veer_left', { standingPerson: 'in_front' });
  assert.equal(far.decide(inFront(), 1000, 1500), null);
  assert.equal(far.decide(inFront(), 2000, 2500), null);
});

test('errors are reported but rate-limited', () => {
  const p = new FeedbackPolicy();
  const err: VisionAssessment = { state: 'error', frameSeq: 1, message: 'x' };
  assert.match(p.decide(err, 0, 10) ?? '', /unavailable/);
  assert.equal(p.decide(err, 1000, 1010), null);
});
