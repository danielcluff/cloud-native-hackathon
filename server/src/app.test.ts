import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const SECRET = 'sk-test-should-never-appear-in-output';
const server = createApp(loadConfig({ OPENAI_API_KEY: SECRET }));
let base = '';
const logs: string[] = [];
const origLog = console.log;

before(async () => {
  console.log = (...args: unknown[]) => logs.push(args.join(' '));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  console.log = origLog;
  await new Promise<void>((r) => server.close(() => r()));
});

test('GET /health reports ok and integration presence without leaking the key', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(SECRET));
  const body = JSON.parse(text);
  assert.equal(body.status, 'ok');
  assert.equal(body.integrations.openai, 'configured');
});

test('placeholder key counts as not configured', () => {
  assert.equal(loadConfig({ OPENAI_API_KEY: 'sk-REPLACE_ME' }).openaiApiKey, null);
  assert.equal(loadConfig({}).openaiApiKey, null);
});

test('vision seam reports unavailable instead of a fake result, and never logs the body', async () => {
  const marker = 'IMAGE-BYTES-MARKER';
  const res = await fetch(`${base}/v1/vision/assess`, { method: 'POST', body: marker });
  assert.equal(res.status, 501);
  assert.equal((await res.json()).state, 'unavailable');
  assert.ok(logs.every((l) => !l.includes(marker) && !l.includes(SECRET)));
});
