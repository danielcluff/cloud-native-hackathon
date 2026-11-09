import type { HealthResponse } from '../../shared/contracts';

/**
 * PUBLIC config only. Anything prefixed EXPO_PUBLIC_ is inlined into the app
 * bundle and readable by anyone — never put API keys here. OpenAI keys live
 * only in server/.env.
 */
export const BACKEND_URL: string | null = process.env.EXPO_PUBLIC_BACKEND_URL?.replace(/\/$/, '') || null;

export type HealthCheck =
  | { state: 'unavailable'; reason: string }
  | { state: 'ok'; health: HealthResponse }
  | { state: 'error'; message: string };

export async function checkBackendHealth(timeoutMs = 4000): Promise<HealthCheck> {
  if (!BACKEND_URL) {
    return { state: 'unavailable', reason: 'EXPO_PUBLIC_BACKEND_URL is not set in mobile/.env.' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: ctrl.signal });
    if (!res.ok) return { state: 'error', message: `Backend answered HTTP ${res.status}.` };
    const body = (await res.json()) as HealthResponse;
    if (body?.status !== 'ok') return { state: 'error', message: 'Backend health response was not ok.' };
    return { state: 'ok', health: body };
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    return { state: 'error', message: aborted ? 'Backend did not answer in time.' : 'Could not reach the backend.' };
  } finally {
    clearTimeout(timer);
  }
}
