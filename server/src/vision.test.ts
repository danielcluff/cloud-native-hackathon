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

test('question names are unique', () => {
  const names = VISION_QUESTIONS.map((q) => q.name);
  assert.equal(new Set(names).size, names.length);
});

test('unusable image -> unknown, never "clear"', () => {
  const r = mapVisionAnswers([p('image_usable', 0.3), p('obstacle_in_path', 0.01)], 7);
  assert.equal(r.state, 'unknown');
});

test('low obstacle probability -> "no obstacles detected in view", not "safe"', () => {
  const r = mapVisionAnswers([p('image_usable', 0.95), p('obstacle_in_path', 0.05)], 1, 1000);
  assert.equal(r.state, 'ok');
  if (r.state !== 'ok') return;
  assert.equal(r.clearOfVisibleObstacles, true);
  assert.match(r.spokenSummary, /no obstacles detected in view/i);
  assert.doesNotMatch(r.spokenSummary, /safe|clear to/i);
});

test('ambiguous obstacle probability -> unknown', () => {
  assert.equal(mapVisionAnswers([p('image_usable', 0.9), p('obstacle_in_path', 0.4)], 1).state, 'unknown');
});

test('confident obstacle -> concise hazard phrase', () => {
  const r = mapVisionAnswers(
    [
      p('image_usable', 0.9),
      p('obstacle_in_path', 0.9),
      c('obstacle_kind', 'person'),
      c('obstacle_direction', 'left'),
      s('obstacle_distance', 0.2),
    ],
    3,
  );
  assert.equal(r.state, 'ok');
  if (r.state !== 'ok') return;
  assert.equal(r.spokenSummary, 'Person on the left, close.');
  assert.deepEqual(r.hazards, [{ label: 'person', direction: 'left', proximity: 'near' }]);
});

test('low-confidence details degrade to generic wording', () => {
  const r = mapVisionAnswers(
    [
      p('image_usable', 0.9),
      p('obstacle_in_path', 0.8),
      c('obstacle_kind', 'furniture', 0.1),
      c('obstacle_direction', 'right', 0.1),
      s('obstacle_distance', 1, 0.1),
    ],
    3,
  );
  assert.equal(r.state === 'ok' && r.spokenSummary, 'Obstacle nearby.');
});
