import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioCoordinator } from './audioCoordinator.ts';

test('recording preempts speech; speech is refused while recording', async () => {
  const c = new AudioCoordinator();
  const stopped: string[] = [];
  c.register('speech', () => void stopped.push('speech'));
  c.register('recording', () => void stopped.push('recording'));

  assert.equal(await c.claim('speech'), true);
  assert.equal(await c.claim('recording'), true);
  assert.deepEqual(stopped, ['speech']);
  assert.equal(await c.claim('speech'), false);
  assert.equal(await c.claim('playback'), false);
  c.release('recording');
  assert.equal(await c.claim('playback'), true);
  assert.equal(c.current(), 'playback');
});

test('release by a non-owner is ignored', async () => {
  const c = new AudioCoordinator();
  await c.claim('playback');
  c.release('speech');
  assert.equal(c.current(), 'playback');
});
