import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createOpenAIClient, type OpenAIClient } from './openai.ts';
import { normalizeSchedule } from './schedule.ts';
import { FIXTURE } from './schedule.test.ts';

const SECRET = 'sk-test-should-never-appear-in-output';
const logs: string[] = [];
const origLog = console.log;

const fakeAi: OpenAIClient = {
  decide: async () => [
    { type: 'predicate', name: 'image_usable', probability: 0.9 },
    { type: 'predicate', name: 'obstacle_in_path', probability: 0.9 },
    { type: 'choice', name: 'obstacle_kind', choice: 'person', probabilities: [], confidence: 0.9 },
    { type: 'choice', name: 'obstacle_direction', choice: 'ahead', probabilities: [], confidence: 0.9 },
    { type: 'score', name: 'obstacle_distance', score: 1, probabilities: [], confidence: 0.9 },
  ],
  transcribe: async () => 'I like eBPF',
  // Model "hallucinates" id 999 alongside a real candidate.
  respondJson: async () => ({
    reply: 'Try the eBPF deep dive at 11 AM.',
    profile: { topics: ['ebpf'], avoid: [], level: null, day: null, notes: '' },
    planSessionIds: ['999', '1'],
  }),
};
const catalog = { get: async () => ({ sessions: normalizeSchedule(FIXTURE), fetchedAt: Date.now() }) };
const clock = () => new Date('2026-11-10T15:00:00Z'); // 08:00 in Salt Lake City

const withKey = createApp(loadConfig({ OPENAI_API_KEY: SECRET }), { ai: fakeAi, catalog, clock });
const noKey = createApp(loadConfig({}), { catalog });
let base = '';
let baseNoKey = '';

async function listen(s: ReturnType<typeof createApp>) {
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

before(async () => {
  console.log = (...args: unknown[]) => logs.push(args.join(' '));
  base = await listen(withKey);
  baseNoKey = await listen(noKey);
});
after(async () => {
  console.log = origLog;
  await Promise.all([withKey, noKey].map((s) => new Promise<void>((r) => s.close(() => r()))));
});

test('GET /health reports ok and integration presence without leaking the key', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes(SECRET));
  assert.equal(JSON.parse(text).integrations.openai, 'configured');
});

test('placeholder key counts as not configured', () => {
  assert.equal(loadConfig({ OPENAI_API_KEY: 'sk-REPLACE_ME' }).openaiApiKey, null);
  assert.equal(loadConfig({}).openaiApiKey, null);
});

test('vision: without a key reports unavailable, never a fake result', async () => {
  const form = new FormData();
  form.append('frame', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), 'f.jpg');
  const res = await fetch(`${baseNoKey}/v1/vision/assess`, { method: 'POST', body: form });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).state, 'unavailable');
});

test('vision: maps Decisions answers and never logs image bytes', async () => {
  const marker = 'IMAGE-BYTES-MARKER';
  const form = new FormData();
  form.append('frame', new Blob([marker], { type: 'image/jpeg' }), 'f.jpg');
  form.append('seq', '42');
  const res = await fetch(`${base}/v1/vision/assess`, { method: 'POST', body: form });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.state, 'ok');
  assert.equal(body.frameSeq, 42);
  assert.equal(body.spokenSummary, 'Person ahead, a few steps away.');
  assert.ok(logs.every((l) => !l.includes(marker) && !l.includes(SECRET)));
});

test('vision: oversized upload is rejected', async () => {
  const form = new FormData();
  form.append('frame', new Blob([new Uint8Array(4 * 1024 * 1024)], { type: 'image/jpeg' }), 'f.jpg');
  const res = await fetch(`${base}/v1/vision/assess`, { method: 'POST', body: form });
  assert.equal(res.status, 413);
});

test('voice turn: transcribes audio, drops fabricated session ids, returns real sessions with routes', async () => {
  const form = new FormData();
  form.append('conversationId', 'test-conversation-1');
  form.append('audio', new Blob(['AUDIO-BYTES-MARKER'], { type: 'audio/mp4' }), 'turn.m4a');
  const res = await fetch(`${base}/v1/voice/turn`, { method: 'POST', body: form });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.state, 'ok');
  assert.equal(body.transcript, 'I like eBPF');
  assert.deepEqual(
    body.plan.recommendations.map((s: { id: string }) => s.id),
    ['1'],
  );
  assert.equal(body.plan.routes.length, 1);
  assert.ok(logs.every((l) => !l.includes('AUDIO-BYTES-MARKER') && !l.includes('eBPF')));
});

test('voice turn: typed text works and bad conversation ids are rejected', async () => {
  const ok = new FormData();
  ok.append('conversationId', 'test-conversation-2');
  ok.append('text', 'I like eBPF');
  assert.equal((await fetch(`${base}/v1/voice/turn`, { method: 'POST', body: ok })).status, 200);

  const bad = new FormData();
  bad.append('conversationId', '../x');
  bad.append('text', 'hi');
  assert.equal((await fetch(`${base}/v1/voice/turn`, { method: 'POST', body: bad })).status, 400);
});

test('openai client: documented request shapes, and errors never echo provider bodies', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    if (url.endsWith('/decisions')) {
      return new Response(JSON.stringify({ error: { code: 'rate_limit', message: `echo ${SECRET}` } }), { status: 429 });
    }
    return new Response(
      JSON.stringify({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }],
      }),
    );
  }) as typeof fetch;
  const client = createOpenAIClient({
    apiKey: SECRET,
    visionModel: 'gpt-6-luna',
    transcribeModel: 'gpt-transcribe',
    textModel: 'gpt-6-astra',
    fetchImpl: fakeFetch,
  });
  await assert.rejects(
    client.decide({ input: [], questions: [] }),
    (e: Error & { retryable?: boolean }) => !e.message.includes(SECRET) && e.retryable === true,
  );
  assert.deepEqual(await client.respondJson({ instructions: 'x', input: [], format: { name: 'n', schema: {} } }), { a: 1 });
  const responses = calls.find((c) => c.url.endsWith('/responses'))!.body as Record<string, any>;
  assert.equal(responses.model, 'gpt-6-astra');
  assert.equal(responses.text.format.type, 'json_schema');
  assert.equal(responses.text.format.strict, true);
});
