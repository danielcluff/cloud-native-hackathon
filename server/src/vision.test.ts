import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DecisionAnswer } from './openai.ts';
import { mapVisionAnswers, VISION_QUESTIONS } from './vision.ts';

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

/** A usable frame with nothing fixed in the path, plus overrides. */
function frame(...over: DecisionAnswer[]): DecisionAnswer[] {
  const base = [
    p('image_usable', 0.95),
    p('fixed_obstacle_in_path', 0.05),
    c('fixed_obstacle_kind', 'none'),
    c('fixed_obstacle_direction', 'none'),
    s('fixed_obstacle_distance', 2),
    c('people_in_path', 'none'),
    p('people_stationary', 0.1),
    c('people_direction', 'none'),
    c('open_side', 'either'),
  ];
  const names = new Set(over.map((a) => a.name));
  return [...base.filter((a) => !names.has(a.name)), ...over];
}

test('question names are unique', () => {
  const names = VISION_QUESTIONS.map((q) => q.name);
  assert.equal(new Set(names).size, names.length);
});

test('unusable image -> unknown, never "clear"', () => {
  assert.equal(mapVisionAnswers(frame(p('image_usable', 0.3)), 7).state, 'unknown');
});

test('nothing fixed in the path -> "no fixed obstacles detected", never "safe"', () => {
  const r = mapVisionAnswers(frame(), 1, 1000);
  assert.equal(r.state, 'ok');
  if (r.state !== 'ok') return;
  assert.equal(r.clearOfVisibleObstacles, true);
  assert.equal(r.spokenSummary, 'No fixed obstacles detected in view.');
  assert.equal(r.alertKey, 'clear');
  assert.doesNotMatch(r.spokenSummary, /safe/i);
});

test('a single passer-by is reported but not announced', () => {
  const r = mapVisionAnswers(frame(c('people_in_path', 'single'), c('people_direction', 'ahead'), p('people_stationary', 0.1)), 2);
  assert.equal(r.state, 'ok');
  if (r.state !== 'ok') return;
  assert.equal(r.people, 'single');
  assert.deepEqual(r.hazards, []);
  assert.equal(r.standingPerson, undefined);
  assert.equal(r.alertKey, 'clear');
});

test('a standing person is a candidate, with close ahead reserved for the center of the path', () => {
  const standing = [
    c('people_in_path', 'single'),
    p('people_stationary', 0.85),
    p('single_person_close', 0.9),
  ];
  const center = mapVisionAnswers(frame(...standing, c('people_direction', 'ahead')), 1);
  const edge = mapVisionAnswers(frame(...standing, c('people_direction', 'slight_left')), 2);
  const side = mapVisionAnswers(frame(...standing, c('people_direction', 'left')), 3);
  assert.equal(center.state === 'ok' && center.standingPerson, 'close_ahead');
  assert.equal(center.state === 'ok' && center.alertKey, 'clear');
  assert.equal(edge.state === 'ok' && edge.standingPerson, 'in_front');
  assert.equal(side.state === 'ok' && side.standingPerson, undefined);
});

test('fixed obstacle ahead -> concise phrase plus which side is more open', () => {
  const r = mapVisionAnswers(
    frame(
      p('fixed_obstacle_in_path', 0.9),
      c('fixed_obstacle_kind', 'furniture'),
      c('fixed_obstacle_direction', 'ahead'),
      s('fixed_obstacle_distance', 0.2),
      c('open_side', 'right'),
    ),
    3,
  );
  assert.equal(r.state, 'ok');
  if (r.state !== 'ok') return;
  assert.equal(r.spokenSummary, 'Furniture ahead, close. Opening on the right.');
  assert.deepEqual(r.hazards, [{ kind: 'fixed', label: 'furniture', direction: 'ahead', proximity: 'near' }]);
  assert.equal(r.alertKey, 'fixed:furniture:ahead:opening:right');
  assert.equal(r.clearOfVisibleObstacles, false);
});

test('obstacle off to one side gets no detour hint', () => {
  const r = mapVisionAnswers(
    frame(
      p('fixed_obstacle_in_path', 0.9),
      c('fixed_obstacle_kind', 'column_or_wall'),
      c('fixed_obstacle_direction', 'left'),
      s('fixed_obstacle_distance', 1),
      c('open_side', 'right'),
    ),
    3,
  );
  assert.equal(r.state === 'ok' && r.spokenSummary, 'Column or wall on the left.');
});

test('a table at the right edge of the path gets a short cue without a hint toward it', () => {
  const r = mapVisionAnswers(
    frame(
      p('fixed_obstacle_in_path', 0.9),
      c('fixed_obstacle_kind', 'table'),
      c('fixed_obstacle_direction', 'slight_right'),
      s('fixed_obstacle_distance', 0.2),
      c('open_side', 'right'),
    ),
    3,
  );
  assert.equal(r.state === 'ok' && r.spokenSummary, 'Table slightly right, close.');
  assert.equal(r.state === 'ok' && r.alertKey, 'fixed:table:slight_right');
});

test('a chair close alongside the aisle is announced even when it does not block the path', () => {
  const r = mapVisionAnswers(
    frame(c('fixed_obstacle_kind', 'chair'), c('fixed_obstacle_direction', 'left'), s('fixed_obstacle_distance', 0.2)),
    4,
  );
  assert.equal(r.state === 'ok' && r.spokenSummary, 'Chair on the left, close.');
});

test('a group standing in the path is announced with a route hint', () => {
  const r = mapVisionAnswers(
    frame(c('people_in_path', 'group'), p('people_stationary', 0.85), c('people_direction', 'ahead'), c('open_side', 'left')),
    4,
  );
  assert.equal(r.state, 'ok');
  if (r.state !== 'ok') return;
  assert.equal(r.spokenSummary, 'Group of people ahead. Opening on the left.');
  assert.equal(r.alertKey, 'people:group:ahead:opening:left');
});

test('a group walking through is not announced', () => {
  const r = mapVisionAnswers(frame(c('people_in_path', 'group'), p('people_stationary', 0.1), c('people_direction', 'ahead')), 5);
  assert.equal(r.state === 'ok' && r.alertKey, 'clear');
});

test('a close fixed obstacle outranks a group; a far one does not', () => {
  const group = [c('people_in_path', 'group'), p('people_stationary', 0.9), c('people_direction', 'ahead')];
  const near = mapVisionAnswers(
    frame(...group, p('fixed_obstacle_in_path', 0.9), c('fixed_obstacle_kind', 'sign_or_barrier'), c('fixed_obstacle_direction', 'ahead'), s('fixed_obstacle_distance', 0.3)),
    6,
  );
  assert.equal(near.state === 'ok' && near.alertKey, 'fixed:sign_or_barrier:ahead');
  assert.equal(near.state === 'ok' && near.hazards.length, 2);
  const far = mapVisionAnswers(
    frame(...group, p('fixed_obstacle_in_path', 0.9), c('fixed_obstacle_kind', 'sign_or_barrier'), c('fixed_obstacle_direction', 'ahead'), s('fixed_obstacle_distance', 1.9)),
    6,
  );
  assert.equal(far.state === 'ok' && far.alertKey, 'people:group:ahead');
});

test('blocked path says so without claiming anything is safe', () => {
  const r = mapVisionAnswers(
    frame(p('fixed_obstacle_in_path', 0.9), c('fixed_obstacle_kind', 'sign_or_barrier'), c('fixed_obstacle_direction', 'ahead'), s('fixed_obstacle_distance', 1), c('open_side', 'neither')),
    7,
  );
  assert.equal(r.state === 'ok' && r.spokenSummary, 'Sign or barrier ahead. Ahead may be blocked.');
});

test('ambiguous fixed-obstacle probability -> unknown', () => {
  assert.equal(mapVisionAnswers(frame(p('fixed_obstacle_in_path', 0.4)), 1).state, 'unknown');
});

test('low-confidence details degrade to generic wording', () => {
  const r = mapVisionAnswers(
    frame(
      p('fixed_obstacle_in_path', 0.8),
      c('fixed_obstacle_kind', 'furniture', 0.1),
      c('fixed_obstacle_direction', 'right', 0.1),
      s('fixed_obstacle_distance', 1, 0.1),
      c('open_side', 'left', 0.1),
    ),
    3,
  );
  assert.equal(r.state === 'ok' && r.spokenSummary, 'Obstacle nearby.');
});

test('a crowd ahead outranks a fixed obstacle off to the side, which is still mentioned', () => {
  // Shape of the live answer for a convention-lobby photo (crowd ahead, booth on the right).
  const r = mapVisionAnswers(
    frame(
      p('fixed_obstacle_in_path', 0.63),
      c('fixed_obstacle_kind', 'furniture', 0.92),
      c('fixed_obstacle_direction', 'right', 0.91),
      s('fixed_obstacle_distance', 0.2, 0.7),
      c('people_in_path', 'crowd', 0.91),
      p('people_stationary', 0.87),
      c('people_direction', 'ahead', 0.97),
      c('open_side', 'left', 0.6),
    ),
    8,
  );
  assert.equal(r.state, 'ok');
  if (r.state !== 'ok') return;
  assert.equal(r.alertKey, 'people:crowd:ahead:opening:left');
  assert.equal(r.spokenSummary, 'Crowd ahead. Furniture on the right, close. Opening on the left.');
});

test('no detour hint toward a side where an obstacle was just named, or when unsure', () => {
  const crowd = [
    p('fixed_obstacle_in_path', 0.63),
    c('fixed_obstacle_kind', 'furniture', 0.92),
    c('fixed_obstacle_direction', 'right', 0.91),
    s('fixed_obstacle_distance', 0.2, 0.7),
    c('people_in_path', 'crowd', 0.91),
    p('people_stationary', 0.87),
    c('people_direction', 'ahead', 0.97),
  ];
  const contradict = mapVisionAnswers(frame(...crowd, c('open_side', 'right', 0.8)), 9);
  assert.equal(contradict.state === 'ok' && contradict.spokenSummary, 'Crowd ahead. Furniture on the right, close.');
  const unsure = mapVisionAnswers(
    frame(p('fixed_obstacle_in_path', 0.9), c('fixed_obstacle_kind', 'furniture'), c('fixed_obstacle_direction', 'ahead'), s('fixed_obstacle_distance', 0.2), c('open_side', 'right', 0.45)),
    9,
  );
  assert.equal(unsure.state === 'ok' && unsure.spokenSummary, 'Furniture ahead, close.');
});
