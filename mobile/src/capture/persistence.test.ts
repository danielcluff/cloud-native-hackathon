import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VisionAssessment } from '../../../shared/contracts.ts';
import { PersistenceTracker, pickPictureSize } from './persistence.ts';

const seen = (label: string, position: 'left_part' | 'center' | 'right_part' = 'center', facingWall = false): VisionAssessment => ({
  state: 'ok',
  frameSeq: 1,
  assessedAt: 0,
  spokenSummary: 'x',
  hazards: [{ kind: 'fixed', label, direction: 'ahead', proximity: 'near', position }],
  people: 'none',
  openSide: 'either',
  steer: 'veer_left',
  facingWall,
  clearOfVisibleObstacles: false,
  alertKey: `fixed:${label}`,
});
const clear: VisionAssessment = {
  state: 'ok',
  frameSeq: 1,
  assessedAt: 0,
  spokenSummary: 'Path ahead looks clear.',
  hazards: [],
  people: 'none',
  openSide: 'either',
  steer: 'straight',
  facingWall: false,
  clearOfVisibleObstacles: true,
  alertKey: 'clear',
};

test('describes once when the same obstacle stays for 3 frames, even if its position wobbles', () => {
  const t = new PersistenceTracker(3);
  assert.equal(t.observe(seen('backpack_or_bag', 'center')), false);
  assert.equal(t.observe(seen('backpack_or_bag', 'left_part')), false);
  assert.equal(t.observe(seen('backpack_or_bag', 'center')), true);
  assert.equal(t.observe(seen('backpack_or_bag')), false);
  assert.equal(t.observe(seen('backpack_or_bag')), false);
});

test('a different obstacle or a clear path starts a new streak', () => {
  const t = new PersistenceTracker(2);
  t.observe(seen('trash_can'));
  assert.equal(t.observe(seen('chair_or_bench')), false);
  assert.equal(t.observe(seen('chair_or_bench')), true);
  t.observe(clear);
  t.observe(seen('chair_or_bench'));
  assert.equal(t.observe(seen('chair_or_bench')), true);
});

test('walls are never described', () => {
  const t = new PersistenceTracker(2);
  t.observe(seen('wall_or_door', 'center', true));
  assert.equal(t.observe(seen('wall_or_door', 'center', true)), false);
});

test('pickPictureSize chooses the smallest size at least 640 px on the long side', () => {
  assert.equal(pickPictureSize(['3840x2160', '1920x1080', '1280x720', '640x480', 'Photo', 'High']), '640x480');
  assert.equal(pickPictureSize(['352x288', '1280x720', '1920x1080']), '1280x720');
  assert.equal(pickPictureSize(['Photo', 'High', 'Medium']), undefined);
});
