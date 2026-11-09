import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DecisionAnswer } from './openai.ts';
import { mapVisionAnswers, resolveSteer, VISION_QUESTIONS } from './vision.ts';

const p = (name: string, probability: number): DecisionAnswer => ({ type: 'predicate', name, probability });
const c = (name: string, choice: string, confidence = 0.8): DecisionAnswer => ({
  type: 'choice',
  name,
  choice,
  probabilities: [],
  confidence,
});
const s = (name: string, score: number, confidence = 0.8): DecisionAnswer => ({
  type: 'score',
  name,
  score,
  probabilities: [],
  confidence,
});

/** A usable frame with a clear walking path, plus overrides. */
function frame(...over: DecisionAnswer[]): DecisionAnswer[] {
  const base = [
    p('image_usable', 0.99),
    p('facing_wall', 0.02),
    p('path_clear', 0.9),
    c('blocker_kind', 'none'),
    c('blocker_position', 'none'),
    s('blocker_distance', 1.9),
    p('left_open', 0.9),
    p('right_open', 0.9),
    c('steer', 'straight'),
    c('people_in_path', 'none'),
  ];
  const names = new Set(over.map((a) => a.name));
  return [...base.filter((a) => !names.has(a.name)), ...over];
}

test('question names are unique', () => {
  const names = VISION_QUESTIONS.map((q) => q.name);
  assert.equal(new Set(names).size, names.length);
});

test('clear center path -> "Path ahead looks clear", never "safe"', () => {
  const r = mapVisionAnswers(frame(), 1, 1000);
  assert.equal(r.state, 'ok');
  if (r.state !== 'ok') return;
  assert.equal(r.spokenSummary, 'Path ahead looks clear.');
  assert.equal(r.steer, 'straight');
  assert.equal(r.clearOfVisibleObstacles, true);
  assert.equal(r.alertKey, 'clear');
  assert.doesNotMatch(r.spokenSummary, /safe/i);
});

test('walls beside the path do not block it (corridor)', () => {
  const r = mapVisionAnswers(frame(p('path_clear', 0.86), p('left_open', 0.1), p('right_open', 0.1)), 2);
  assert.equal(r.state === 'ok' && r.alertKey, 'clear');
});

test('facing a wall -> "Wall or door ahead" plus a turn, not "camera unclear"', () => {
  // Real answer shape for the recording's wall frame: image_usable 0.18, facing_wall 0.98.
  const r = mapVisionAnswers(
    frame(p('image_usable', 0.18), p('facing_wall', 0.98), p('path_clear', 0.95), p('left_open', 0.18), p('right_open', 0.13)),
    3,
  );
  assert.equal(r.state, 'ok');
  if (r.state !== 'ok') return;
  assert.equal(r.facingWall, true);
  assert.equal(r.spokenSummary, 'Turn left or right to find a path. Wall or door ahead.');
  const withSide = mapVisionAnswers(
    frame(p('facing_wall', 0.94), p('path_clear', 0.01), p('left_open', 0.92), p('right_open', 0.51)),
    3,
  );
  assert.equal(withSide.state === 'ok' && withSide.spokenSummary, 'Turn left to find a path. Wall or door ahead.');
});

test('blurry frame that is not a wall -> unclear', () => {
  assert.equal(mapVisionAnswers(frame(p('image_usable', 0.1), p('facing_wall', 0.1)), 4).state, 'unknown');
});

test('obstacle in the path: direction first, then what and where', () => {
  const r = mapVisionAnswers(
    frame(
      p('path_clear', 0.1),
      c('blocker_kind', 'backpack_or_bag'),
      c('blocker_position', 'left_part'),
      s('blocker_distance', 0.3),
      c('steer', 'veer_right'),
    ),
    5,
  );
  assert.equal(r.state, 'ok');
  if (r.state !== 'ok') return;
  assert.equal(r.spokenSummary, 'Veer right. Bag on the floor on the left of your path, close.');
  assert.equal(r.steer, 'veer_right');
  assert.equal(r.alertKey, 'fixed:backpack_or_bag:left_part:veer_right');
});

test('a mid-path trash can at 0.38 counts as blocked (tuned on the recording)', () => {
  const r = mapVisionAnswers(
    frame(
      p('path_clear', 0.38),
      c('blocker_kind', 'trash_can'),
      c('blocker_position', 'center'),
      s('blocker_distance', 1.0),
      c('steer', 'straight', 0.43),
    ),
    6,
  );
  assert.equal(r.state, 'ok');
  if (r.state !== 'ok') return;
  assert.match(r.spokenSummary, /^Veer (left|right)\. Trash can ahead, a few steps away\.$/);
});

test('the in-between band stays "not sure"', () => {
  assert.equal(mapVisionAnswers(frame(p('path_clear', 0.52)), 7).state, 'unknown');
});

test('single standing person is flagged for two-frame confirmation; groups are announced as people', () => {
  const person = mapVisionAnswers(
    frame(
      p('path_clear', 0.04),
      c('blocker_kind', 'person_standing'),
      c('blocker_position', 'center'),
      s('blocker_distance', 0.01),
      c('people_in_path', 'single'),
    ),
    8,
  );
  assert.equal(person.state === 'ok' && person.standingPerson, 'close_ahead');
  const group = mapVisionAnswers(
    frame(
      p('path_clear', 0.1),
      c('blocker_kind', 'group_of_people'),
      c('blocker_position', 'center'),
      s('blocker_distance', 1),
      c('people_in_path', 'group'),
    ),
    8,
  );
  assert.equal(group.state === 'ok' && group.hazards[0]?.kind, 'people');
  assert.equal(group.state === 'ok' && group.standingPerson, undefined);
});

test('resolveSteer: trusts a consistent model answer, overrides an inconsistent one', () => {
  const base = { blocked: true, facingWall: false, position: 'center' as const };
  assert.equal(resolveSteer({ ...base, modelSteer: 'veer_left', leftOpen: 0.9, rightOpen: 0.9 }), 'veer_left');
  // Model says veer left, but the left is not open: go right instead.
  assert.equal(resolveSteer({ ...base, modelSteer: 'veer_left', leftOpen: 0.1, rightOpen: 0.9 }), 'veer_right');
  // Obstacle in the left part, model unsure: go right.
  assert.equal(
    resolveSteer({ ...base, position: 'left_part', modelSteer: null, leftOpen: 0.9, rightOpen: 0.9 }),
    'veer_right',
  );
  // Nothing open: turn to look for a path.
  assert.equal(resolveSteer({ ...base, modelSteer: null, leftOpen: 0.1, rightOpen: 0.1 }), 'turn_either');
  assert.equal(resolveSteer({ ...base, blocked: false, modelSteer: 'veer_left', leftOpen: 0.9, rightOpen: 0.9 }), 'straight');
});
