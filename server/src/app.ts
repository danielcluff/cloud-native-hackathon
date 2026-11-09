import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { HealthResponse, VisionAssessment, VoiceTurnResult } from '../../shared/contracts.ts';
import type { ServerConfig } from './config.ts';
import { tokenMatches, UsageCaps } from './guard.ts';
import { Interviewer } from './interview.ts';
import { createOpenAIClient, type OpenAIClient } from './openai.ts';
import { createScheduleCatalog, type ScheduleCatalog } from './schedule.ts';
import { buildVisionRequest, mapVisionAnswers } from './vision.ts';

export const VERSION = '0.3.0';

const MAX_FRAME_BYTES = 3 * 1024 * 1024;
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const CONVERSATION_ID = /^[A-Za-z0-9-]{8,64}$/;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface AppDeps {
  ai?: OpenAIClient | null;
  catalog?: ScheduleCatalog;
  clock?: () => Date;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Read the body with a hard size cap, then parse multipart via the WHATWG Request parser. */
async function readForm(req: IncomingMessage, maxBytes: number): Promise<FormData> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > maxBytes) {
    req.resume();
    throw new HttpError(413, 'Upload too large.');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) throw new HttpError(413, 'Upload too large.');
    chunks.push(chunk);
  }
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('multipart/form-data')) throw new HttpError(415, 'Expected multipart/form-data.');
  try {
    return await new Request('http://local/', {
      method: 'POST',
      headers: { 'content-type': type },
      body: Buffer.concat(chunks),
    }).formData();
  } catch {
    throw new HttpError(400, 'Malformed form data.');
  }
}

/**
 * Minimal HTTP app. Request bodies (images/audio/transcripts) are never
 * logged; only method, path and status are.
 */
export function createApp(config: ServerConfig, deps: AppDeps = {}): Server {
  const ai =
    deps.ai !== undefined
      ? deps.ai
      : config.openaiApiKey
        ? createOpenAIClient({
            apiKey: config.openaiApiKey,
            visionModel: config.models.vision,
            transcribeModel: config.models.transcribe,
            textModel: config.models.text,
            textReasoningEffort: config.textReasoningEffort,
          })
        : null;
  const catalog = deps.catalog ?? createScheduleCatalog();
  // Warm the schedule cache at startup so the first voice turn doesn't pay for the fetch.
  if (!deps.catalog) void catalog.get();
  const interviewer = new Interviewer(ai, catalog, deps.clock);
  const caps = new UsageCaps(config.limits);

  /** Typed `unavailable` body so the app can explain it (works for both result types). */
  function refuse(req: IncomingMessage, res: ServerResponse, status: number, reason: string) {
    req.resume();
    sendJson(res, status, { state: 'unavailable', reason });
  }

  async function route(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    // Plain-text version at the root, like the Radar starter, for deploy verification.
    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(`cnh-backend ${VERSION} version ${config.commit}\n`);
      return;
    }

    if (req.method === 'GET' && path === '/health') {
      const body: HealthResponse = {
        status: 'ok',
        service: 'cnh-backend',
        version: VERSION,
        commit: config.commit,
        time: new Date().toISOString(),
        integrations: { openai: ai ? 'configured' : 'not_configured' },
        auth: config.appAccessToken ? 'token' : 'none',
      };
      return sendJson(res, 200, body);
    }

    if (path.startsWith('/v1/') && config.appAccessToken && !tokenMatches(req.headers.authorization, config.appAccessToken)) {
      return refuse(req, res, 401, 'This phone is not paired with the backend. Add the pairing token in Help.');
    }

    if (req.method === 'GET' && path === '/v1/auth/check') {
      return sendJson(res, 200, { state: 'ok' });
    }

    const capKind = req.method === 'POST' ? ({ '/v1/vision/assess': 'vision', '/v1/voice/turn': 'voice' } as const)[path] : undefined;
    if (capKind && ai) {
      const hit = caps.take(capKind);
      if (hit) {
        return refuse(
          req,
          res,
          429,
          hit === 'day' ? 'Daily usage limit reached. It resets at midnight UTC.' : 'Too many requests. Wait a minute and try again.',
        );
      }
    }

    if (req.method === 'POST' && path === '/v1/vision/assess') {
      if (!ai) {
        req.resume();
        const body: VisionAssessment = { state: 'unavailable', reason: 'Server has no OpenAI API key configured.' };
        return sendJson(res, 503, body);
      }
      const form = await readForm(req, MAX_FRAME_BYTES);
      const frame = form.get('frame');
      const seq = Number(form.get('seq') ?? 0);
      if (!(frame instanceof Blob) || frame.size === 0) throw new HttpError(400, 'Missing frame.');
      const mime = IMAGE_TYPES.has(frame.type) ? frame.type : 'image/jpeg';
      const dataUrl = `data:${mime};base64,${Buffer.from(await frame.arrayBuffer()).toString('base64')}`;
      try {
        const answers = await ai.decide(buildVisionRequest(dataUrl));
        return sendJson(res, 200, mapVisionAnswers(answers, seq));
      } catch (e) {
        const body: VisionAssessment = {
          state: 'error',
          frameSeq: seq,
          message: e instanceof Error ? e.message : 'Vision service failed.',
        };
        return sendJson(res, 502, body);
      }
    }

    if (req.method === 'POST' && path === '/v1/voice/turn') {
      const form = await readForm(req, MAX_AUDIO_BYTES);
      const conversationId = String(form.get('conversationId') ?? '');
      if (!CONVERSATION_ID.test(conversationId)) throw new HttpError(400, 'Missing or invalid conversationId.');
      if (!ai) {
        const body: VoiceTurnResult = { state: 'unavailable', reason: 'The server has no OpenAI API key configured.' };
        return sendJson(res, 503, body);
      }
      const audio = form.get('audio');
      const typed = form.get('text');
      let text: string;
      if (audio instanceof Blob && audio.size > 0) {
        const name = audio instanceof File && audio.name ? audio.name : 'turn.m4a';
        try {
          text = await ai.transcribe(audio, name);
        } catch {
          const body: VoiceTurnResult = {
            state: 'error',
            message: "I couldn't understand the recording. Please try again, or type instead.",
            retryable: true,
          };
          return sendJson(res, 502, body);
        }
      } else if (typeof typed === 'string' && typed.trim()) {
        text = typed.slice(0, 2000);
      } else {
        throw new HttpError(400, 'Send an audio file or text.');
      }
      const result = await interviewer.turn(conversationId, text);
      return sendJson(res, result.state === 'ok' ? 200 : result.state === 'unavailable' ? 503 : 502, result);
    }

    if (req.method === 'POST' && path === '/v1/voice/reset') {
      const form = await readForm(req, 4096);
      const conversationId = String(form.get('conversationId') ?? '');
      if (!CONVERSATION_ID.test(conversationId)) throw new HttpError(400, 'Missing or invalid conversationId.');
      interviewer.reset(conversationId);
      return sendJson(res, 200, { ok: true });
    }

    req.resume();
    sendJson(res, 404, { error: 'not_found' });
  }

  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const started = Date.now();
    res.on('finish', () => console.log(`${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`));
    route(req, res, path).catch((e: unknown) => {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
      console.error(`unhandled error on ${path}: ${e instanceof Error ? e.name : 'unknown'}`);
      sendJson(res, 500, { error: 'internal_error' });
    });
  });
}
