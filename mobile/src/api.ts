import type { FrameMeta, VisionAssessment, VoiceTurnResult } from '../../shared/contracts';
import { BACKEND_URL } from './config';

/**
 * Backend calls. Uploads use React Native's FormData `{ uri, name, type }`
 * file parts, which stream the transient cache file without base64 in JS.
 * Nothing here logs payloads.
 */

function rnFile(uri: string, name: string, type: string): Blob {
  // React Native's FormData accepts this shape for file uploads.
  return { uri, name, type } as unknown as Blob;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  return {
    signal: ctrl.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

async function postForm<T>(path: string, form: FormData, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (!BACKEND_URL) throw new Error('EXPO_PUBLIC_BACKEND_URL is not set');
  const t = withTimeout(signal, timeoutMs);
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, { method: 'POST', body: form, signal: t.signal });
    // Our endpoints return typed `{ state: ... }` bodies for 2xx and expected
    // 5xx states; anything else (4xx `{ error }`, proxies, HTML) is a failure.
    const body = (await res.json().catch(() => null)) as { state?: unknown } | null;
    if (!body || typeof body.state !== 'string') throw new Error(`Unexpected backend response (HTTP ${res.status})`);
    return body as T;
  } finally {
    t.done();
  }
}

export async function assessFrame(frame: { uri: string; meta: FrameMeta }, signal: AbortSignal): Promise<VisionAssessment> {
  if (!BACKEND_URL) return { state: 'unavailable', reason: 'Backend URL is not configured.' };
  const form = new FormData();
  form.append('frame', rnFile(frame.uri, 'frame.jpg', 'image/jpeg'));
  form.append('seq', String(frame.meta.seq));
  try {
    return await postForm<VisionAssessment>('/v1/vision/assess', form, 5000, signal);
  } catch (e) {
    if (signal.aborted) throw e;
    return { state: 'error', frameSeq: frame.meta.seq, message: 'Could not reach the backend.' };
  }
}

export async function voiceTurn(
  input: { conversationId: string; audioUri?: string; text?: string },
  signal?: AbortSignal,
): Promise<VoiceTurnResult> {
  if (!BACKEND_URL) return { state: 'unavailable', reason: 'Backend URL is not configured.' };
  const form = new FormData();
  form.append('conversationId', input.conversationId);
  if (input.audioUri) form.append('audio', rnFile(input.audioUri, 'turn.m4a', 'audio/mp4'));
  else if (input.text) form.append('text', input.text);
  try {
    return await postForm<VoiceTurnResult>('/v1/voice/turn', form, 30_000, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    return { state: 'error', message: 'Could not reach the planning service. Check your connection and try again.', retryable: true };
  }
}

export async function resetConversation(conversationId: string): Promise<void> {
  if (!BACKEND_URL) return;
  const form = new FormData();
  form.append('conversationId', conversationId);
  try {
    await postForm('/v1/voice/reset', form, 5000);
  } catch {
    // Best effort; a new conversation id is used anyway.
  }
}

export function newConversationId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
