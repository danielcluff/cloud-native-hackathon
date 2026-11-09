import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { tokenMatches, UsageCaps } from './guard.ts';
import type { OpenAIClient } from './openai.ts';

const TOKEN = 'pairing-token-for-tests-0123456789';
const ai: OpenAIClient = {
  decide: async () => [
    { type: 'predicate', name: 'image_usable', probability: 0.9 },
    { type: 'predicate', name: 'path_clear', probability: 0.95 },
  ],
  transcribe: async () => 'x',
  describeImage: async () => 'x',
  respondJson: async () => ({}),
};
const app = createApp(
  loadConfig({ OPENAI_API_KEY: 'sk-x', APP_ACCESS_TOKEN: TOKEN, LIMIT_VISION_PER_MINUTE: '2', LIMIT_VISION_PER_DAY: '100' }),
  { ai, catalog: { get: async () => null } },
);
let base = '';
const origLog = console.log;
before(async () => {
  console.log = () => {};
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});
after(async () => {
  console.log = origLog;
  await new Promise<void>((r) => app.close(() => r()));
});

const frame = () => {
  const f = new FormData();
  f.append('frame', new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), 'f.jpg');
  return f;
};

test('tokenMatches is exact and needs the Bearer scheme', () => {
  assert.equal(tokenMatches(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(tokenMatches(`bearer ${TOKEN}`, TOKEN), true);
  assert.equal(tokenMatches(TOKEN, TOKEN), false);
  assert.equal(tokenMatches(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(tokenMatches(undefined, TOKEN), false);
});

test('health stays open and reports auth mode without the token', async () => {
  const text = await (await fetch(`${base}/health`)).text();
  assert.equal(JSON.parse(text).auth, 'token');
  assert.ok(!text.includes(TOKEN));
});

test('/v1/* without or with a wrong token is refused with a typed body', async () => {
  for (const headers of [{}, { authorization: "Bearer nope" }] as Array<Record<string, string>>) {
    const res = await fetch(`${base}/v1/vision/assess`, { method: 'POST', body: frame(), headers });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.state, 'unavailable');
    assert.match(body.reason, /not paired/);
  }
  assert.equal((await fetch(`${base}/v1/auth/check`)).status, 401);
});

test('paired phone passes, and the per-minute cap applies', async () => {
  const headers = { authorization: `Bearer ${TOKEN}` };
  assert.equal((await fetch(`${base}/v1/auth/check`, { headers })).status, 200);
  const codes: number[] = [];
  for (let i = 0; i < 3; i++) {
    codes.push((await fetch(`${base}/v1/vision/assess`, { method: 'POST', body: frame(), headers })).status);
  }
  assert.deepEqual(codes, [200, 200, 429]);
});

test('UsageCaps resets per minute and enforces the daily cap', () => {
  let t = Date.UTC(2026, 10, 10, 12, 0, 0);
  const caps = new UsageCaps({ v: { perMinute: 1, perDay: 2 } }, () => t);
  assert.equal(caps.take('v'), null);
  assert.equal(caps.take('v'), 'minute');
  t += 60_000;
  assert.equal(caps.take('v'), null);
  t += 60_000;
  assert.equal(caps.take('v'), 'day');
  t += 24 * 3600_000;
  assert.equal(caps.take('v'), null);
  assert.equal(caps.take('unlimited'), null);
});
