/**
 * Server-only configuration. Secrets live in process.env and never leave this
 * process: they are not logged, not returned by any endpoint, and not shipped
 * to the mobile bundle.
 */
export interface ServerConfig {
  port: number;
  host: string;
  /** Present only when a real-looking key is configured. Never log this. */
  openaiApiKey: string | null;
}

const PLACEHOLDER_KEYS = new Set(['', 'sk-REPLACE_ME']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawKey = env.OPENAI_API_KEY?.trim() ?? '';
  const port = Number.parseInt(env.PORT ?? '8787', 10);
  return {
    port: Number.isFinite(port) ? port : 8787,
    host: env.HOST?.trim() || '0.0.0.0',
    openaiApiKey: PLACEHOLDER_KEYS.has(rawKey) ? null : rawKey,
  };
}
