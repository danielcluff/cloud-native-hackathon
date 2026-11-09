import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VisionAssessment } from '../../../shared/contracts.ts';
import { FEED_LIMIT, makeEntry, pushEntry, type FeedEntry } from './directionFeed.ts';

const ok = (over: Partial<Extract<VisionAssessment, { state: 'ok' }>> = {}): VisionAssessment => ({
  state: 'ok',
  frameSeq: 3,
  assessedAt: 0,
  spokenSummary: 'Table slightly right, close.',
  hazards: [{ kind: 'fixed', label: 'table', direction: 'slight_right', proximity: 'near' }],
  people: 'none',
  openSide: 'left',
  clearOfVisibleObstacles: false,
  alertKey: 'fixed:table:slight_right',
  ...over,
});

test('spoken entries show the announced phrase and latency', () => {
  const e = makeEntry(1, ok(), 'Table slightly right, close.', { seq: 3, capturedAt: 1000 }, 2200);
  assert.equal(e.spoken, true);
  assert.equal(e.note, null);
  assert.equal(e.text, 'Table slightly right, close.');
  assert.equal(e.latencyMs, 1200);
  assert.equal(e.frameSeq, 3);
});

test('quiet entries still show what the camera saw, with the reason', () => {
  assert.equal(makeEntry(2, ok(), null, { seq: 4, capturedAt: 1000 }, 2000).note, 'same cue, repeats every other frame');
  assert.equal(
    makeEntry(3, ok({ clearOfVisibleObstacles: true, hazards: [], alertKey: 'clear', spokenSummary: 'No fixed obstacles detected in view.' }), null, { seq: 5, capturedAt: 1000 }, 2000).note,
    'still clear, not repeated',
  );
  const stale = makeEntry(4, ok(), null, { seq: 6, capturedAt: 1000 }, 4600);
  assert.equal(stale.note, 'stale (3.6s old), not spoken');
  assert.equal(stale.text, 'Table slightly right, close.');
  const err = makeEntry(5, { state: 'error', frameSeq: 7, message: 'Could not reach the backend.' }, null, { seq: 7, capturedAt: 1000 }, 1500);
  assert.equal(err.text, 'Error: Could not reach the backend.');
  assert.equal(err.note, 'problem, rate-limited');
});

test('feed is newest-first and capped', () => {
  let feed: FeedEntry[] = [];
  for (let i = 0; i < FEED_LIMIT + 5; i++) feed = pushEntry(feed, makeEntry(i, ok(), null, { seq: i, capturedAt: 0 }, 100));
  assert.equal(feed.length, FEED_LIMIT);
  assert.equal(feed[0]!.id, FEED_LIMIT + 4);
});

test('a close standing person not yet announced says it is waiting for confirmation', () => {
  const r = ok({ clearOfVisibleObstacles: true, hazards: [], alertKey: 'clear', standingPerson: 'close_ahead', spokenSummary: 'No fixed obstacles detected in view.' });
  assert.equal(makeEntry(9, r, null, { seq: 9, capturedAt: 1000 }, 2000).note, 'person ahead, waiting for a 2nd frame');
});
