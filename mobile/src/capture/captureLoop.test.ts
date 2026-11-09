// Run with: npm test  (node --test, Node >= 22.18 strips TypeScript types natively)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CaptureLoop, type FrameConsumer } from './captureLoop.ts';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function fakeCamera(captureMs: number) {
  let active = 0;
  let maxActive = 0;
  let n = 0;
  const discarded: string[] = [];
  return {
    discarded,
    get maxActive() {
      return maxActive;
    },
    get count() {
      return n;
    },
    capture: async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(captureMs);
      active--;
      return { uri: `file:///cache/${++n}.jpg`, width: 640, height: 480 };
    },
    discard: (uri: string) => {
      discarded.push(uri);
    },
  };
}

test('never overlaps captures even when capture is slower than the interval', async () => {
  const cam = fakeCamera(25);
  const loop = new CaptureLoop({ ...cam, consumer: { consume: async () => {} }, intervalMs: 5 });
  loop.start();
  await sleep(200);
  await loop.stop();
  assert.equal(cam.maxActive, 1);
  assert.ok(cam.count >= 3, `expected several captures, got ${cam.count}`);
});

test('paces to roughly the interval when capture is fast', async () => {
  const cam = fakeCamera(1);
  const loop = new CaptureLoop({ ...cam, consumer: { consume: async () => {} }, intervalMs: 50 });
  loop.start();
  await sleep(230);
  await loop.stop();
  // t=0,50,100,150,200 -> about 5; allow timer jitter.
  assert.ok(cam.count >= 3 && cam.count <= 6, `got ${cam.count}`);
});

test('stop() during an in-flight capture waits for it, discards the frame, and schedules nothing more', async () => {
  const cam = fakeCamera(40);
  const consumed: number[] = [];
  const loop = new CaptureLoop({
    ...cam,
    consumer: { consume: async (f) => void consumed.push(f.meta.seq) },
    intervalMs: 10,
  });
  loop.start();
  await sleep(10); // first capture is in flight
  await loop.stop();
  assert.equal(cam.count, 1);
  assert.deepEqual(consumed, []); // stale frame was not handed to the consumer
  assert.deepEqual(cam.discarded, ['file:///cache/1.jpg']);
  await sleep(60);
  assert.equal(cam.count, 1);
  assert.equal(loop.getStats().running, false);
});

test('every captured frame file is eventually discarded', async () => {
  const cam = fakeCamera(2);
  const loop = new CaptureLoop({ ...cam, consumer: { consume: () => sleep(3) }, intervalMs: 5 });
  loop.start();
  await sleep(100);
  await loop.stop();
  await sleep(20);
  assert.equal(new Set(cam.discarded).size, cam.count);
});

test('slow consumer causes drops, not a queue; stop aborts the consumer', async () => {
  const cam = fakeCamera(1);
  let aborted = false;
  const consumer: FrameConsumer = {
    consume: (_f, signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          resolve();
        });
      }),
  };
  const loop = new CaptureLoop({ ...cam, consumer, intervalMs: 5 });
  loop.start();
  await sleep(60);
  assert.ok(loop.getStats().dropped >= 2);
  await loop.stop();
  await sleep(5);
  assert.equal(aborted, true);
  assert.equal(new Set(cam.discarded).size, cam.count);
});

test('capture errors are counted and the loop keeps going', async () => {
  let calls = 0;
  const loop = new CaptureLoop({
    capture: async () => {
      calls++;
      if (calls === 1) throw new Error('camera not ready');
      return { uri: `file:///c/${calls}.jpg`, width: 1, height: 1 };
    },
    discard: () => {},
    consumer: { consume: async () => {} },
    intervalMs: 5,
  });
  loop.start();
  await sleep(40);
  await loop.stop();
  const s = loop.getStats();
  assert.equal(s.errors, 1);
  assert.ok(s.captures >= 1);
});

test('captureOnce refuses to overlap', async () => {
  const cam = fakeCamera(20);
  const loop = new CaptureLoop({ ...cam, consumer: { consume: async () => {} } });
  const a = loop.captureOnce();
  const b = await loop.captureOnce();
  assert.equal(b, false);
  assert.equal(await a, true);
  assert.equal(cam.maxActive, 1);
});
