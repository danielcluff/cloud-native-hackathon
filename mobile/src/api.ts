import { File as ExpoFile } from 'expo-file-system';
import type { FrameMeta, VisionAssessment, VoiceTurnResult } from '../../shared/contracts';
import { authHeaders } from './auth';
import { BACKEND_URL } from './config';

/**
 * Backend calls. Nothing here logs payloads.
 *
 * Uploads: Expo SDK 58 replaces the global `fetch` with `expo/fetch`, whose
 * FormData encoder accepts strings, Blobs, or objects with `bytes()`. It
 * REJECTS React Native's `{ uri, name, type }` shape ("Unsupported
 * FormDataPart implementation") before any request is sent. expo-file-system's
 * `File` implements Blob (`name`, `type`, `bytes()`), so we append that.
 */
export class UploadFileMissing extends Error {}

export function filePart(uri: string): Blob {
  const file = new ExpoFile(uri);
  if (!file.exists) throw new UploadFileMissing('The recorded file is missing.');
  return file as unknown as Blob;
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
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      body: form,
      headers: await authHeaders(),
      signal: t.signal,
    });
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
  try {
    form.append('frame', filePart(frame.uri));
  } catch {
    return { state: 'error', frameSeq: frame.meta.seq, message: 'The camera frame could not be read.' };
  }
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
  if (input.audioUri) {
    try {
      form.append('audio', filePart(input.audioUri));
    } catch {
      return { state: 'error', message: 'The recording could not be read. Please record again.', retryable: false };
    }
  } else if (input.text) form.append('text', input.text);
  try {
    return await postForm<VoiceTurnResult>('/v1/voice/turn', form, 30_000, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    // Keep a short technical hint so failures like this one are diagnosable.
    const hint = e instanceof Error && e.message ? ` (${e.message.slice(0, 80)})` : '';
    return {
      state: 'error',
      message: `Could not reach the planning service. Check your connection and try again.${hint}`,
      retryable: true,
    };
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

export type PairingCheck = { state: 'ok' } | { state: 'unavailable' | 'error'; reason: string };

/** Verifies the stored pairing token against the backend. */
export async function checkPairing(): Promise<PairingCheck> {
  if (!BACKEND_URL) return { state: 'unavailable', reason: 'Backend URL is not configured.' };
  const t = withTimeout(undefined, 5000);
  try {
    const res = await fetch(`${BACKEND_URL}/v1/auth/check`, { headers: await authHeaders(), signal: t.signal });
    if (res.ok) return { state: 'ok' };
    if (res.status === 401) return { state: 'unavailable', reason: 'The pairing token was not accepted.' };
    return { state: 'error', reason: `Backend answered HTTP ${res.status}.` };
  } catch {
    return { state: 'error', reason: 'Could not reach the backend.' };
  } finally {
    t.done();
  }
}
