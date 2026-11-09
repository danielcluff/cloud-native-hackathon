/**
 * Thin OpenAI HTTP client. Endpoints and fields follow the official docs as
 * read on 2026-11-09:
 *   - POST /v1/decisions               (model gpt-6-luna; input + questions -> answers[])
 *   - POST /v1/audio/transcriptions    (multipart: file, model=gpt-transcribe -> { text })
 *   - POST /v1/responses               (text.format json_schema, strict)
 *
 * Privacy: request bodies (images, audio, transcripts) are never logged, and
 * error messages never echo provider response bodies — only status and error code.
 */

export class UpstreamError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = 'UpstreamError';
    this.status = status;
    this.retryable = retryable;
  }
}

// ---- Decisions ----

export type DecisionQuestion =
  | { type: 'predicate'; name: string; instructions: string }
  | { type: 'choice'; name: string; instructions: string; choices: Array<{ value: string; description: string }> }
  | { type: 'score'; name: string; instructions: string; levels: Array<{ label: string; description: string }> };

export type DecisionAnswer =
  | { type: 'predicate'; name: string; probability: number }
  | {
      type: 'choice';
      name: string;
      choice: string;
      probabilities: Array<{ value: string; probability: number }>;
      confidence: number;
    }
  | {
      type: 'score';
      name: string;
      score: number;
      probabilities: Array<{ value: number; label: string; probability: number }>;
      confidence: number;
    };

export interface DecisionsRequest {
  input: Array<{
    role: 'user';
    content: Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }>;
  }>;
  questions: DecisionQuestion[];
}

// ---- Responses (structured output) ----

export interface JsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
}

export interface OpenAIClient {
  decide(req: DecisionsRequest, signal?: AbortSignal): Promise<DecisionAnswer[]>;
  transcribe(audio: Blob, filename: string, signal?: AbortSignal): Promise<string>;
  respondJson(
    args: { instructions: string; input: Array<{ role: 'user' | 'assistant'; content: string }>; format: JsonSchemaFormat },
    signal?: AbortSignal,
  ): Promise<unknown>;
  /** Short free-text answer about one image (Responses API with input_image). */
  describeImage(args: { instructions: string; imageDataUrl: string }, signal?: AbortSignal): Promise<string>;
}

export interface OpenAIOptions {
  apiKey: string;
  baseUrl?: string;
  visionModel: string;
  transcribeModel: string;
  textModel: string;
  /** Responses `reasoning.effort` for planning turns; null = model default. */
  textReasoningEffort?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createOpenAIClient(opts: OpenAIOptions): OpenAIClient {
  const base = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  async function call(path: string, body: BodyInit, contentType: string | null, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const headers: Record<string, string> = { authorization: `Bearer ${opts.apiKey}` };
    if (contentType) headers['content-type'] = contentType;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { method: 'POST', headers, body, signal: combined });
    } catch (e) {
      const aborted = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
      throw new UpstreamError(aborted ? 'AI service timed out' : 'AI service unreachable', null, true);
    }
    if (!res.ok) {
      let code = '';
      try {
        const j = (await res.json()) as { error?: { code?: string; type?: string } };
        code = j.error?.code ?? j.error?.type ?? '';
      } catch {
        // body not JSON; ignore
      }
      const retryable = res.status === 429 || res.status >= 500;
      throw new UpstreamError(`AI service error ${res.status}${code ? ` (${code})` : ''}`, res.status, retryable);
    }
    return res.json() as Promise<unknown>;
  }

  return {
    async decide(req, signal) {
      const json = (await call(
        '/decisions',
        JSON.stringify({ model: opts.visionModel, ...req }),
        'application/json',
        signal,
      )) as { answers?: DecisionAnswer[] };
      if (!Array.isArray(json.answers)) throw new UpstreamError('Decisions response had no answers', null, false);
      return json.answers;
    },

    async transcribe(audio, filename, signal) {
      const form = new FormData();
      form.append('file', audio, filename);
      form.append('model', opts.transcribeModel);
      // FormData sets its own multipart boundary content-type.
      const json = (await call('/audio/transcriptions', form, null, signal)) as { text?: unknown };
      if (typeof json.text !== 'string') throw new UpstreamError('Transcription had no text', null, false);
      return json.text;
    },

    async describeImage({ instructions, imageDataUrl }, signal) {
      const json = (await call(
        '/responses',
        JSON.stringify({
          model: opts.textModel,
          instructions,
          input: [{ role: 'user', content: [{ type: 'input_image', image_url: imageDataUrl }] }],
          ...(opts.textReasoningEffort ? { reasoning: { effort: opts.textReasoningEffort } } : {}),
        }),
        'application/json',
        signal,
      )) as ResponsesBody;
      if (json.status === 'incomplete') throw new UpstreamError('AI reply was incomplete', null, true);
      return extractOutputText(json).trim();
    },

    async respondJson({ instructions, input, format }, signal) {
      const json = (await call(
        '/responses',
        JSON.stringify({
          model: opts.textModel,
          instructions,
          input,
          text: { format: { type: 'json_schema', name: format.name, schema: format.schema, strict: true } },
          ...(opts.textReasoningEffort ? { reasoning: { effort: opts.textReasoningEffort } } : {}),
        }),
        'application/json',
        signal,
      )) as ResponsesBody;
      if (json.status === 'incomplete') throw new UpstreamError('AI reply was incomplete', null, true);
      const text = extractOutputText(json);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new UpstreamError('AI reply was not valid JSON', null, true);
      }
    },
  };
}

interface ResponsesBody {
  status?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
}

/** Docs: don't assume output[0].content[0]; walk message items, and check for refusals. */
export function extractOutputText(body: ResponsesBody): string {
  const parts: string[] = [];
  for (const item of body.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c.type === 'refusal') throw new UpstreamError('AI declined to answer', null, false);
      if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  if (parts.length === 0) throw new UpstreamError('AI reply had no text', null, true);
  return parts.join('');
}
