/**
 * Server-only configuration. Secrets live in process.env and never leave this
 * process: they are not logged, not returned by any endpoint, and not shipped
 * to the mobile bundle.
 */
export interface ServerConfig {
  port: number;
  host: string;
  /** Image commit (APP_VERSION build arg). */
  commit: string;
  /** Present only when a real-looking key is configured. Never log this. */
  openaiApiKey: string | null;
  /** Pairing token required on /v1/* when set. Never log this. */
  appAccessToken: string | null;
  /** Caps on paid AI calls (in-memory, per replica). */
  limits: { vision: { perMinute: number; perDay: number }; voice: { perMinute: number; perDay: number } };
  /** Model ids, overridable without a code change. Text model chosen by Daniel (faster/cheaper than gpt-6-astra). */
  models: { vision: string; transcribe: string; text: string };
  /** Reasoning effort for planning turns; 'low' measured 2.9-4.8s vs 6.8-7.5s default on gpt-6.1-sol. */
  textReasoningEffort: string | null;
}

const PLACEHOLDER_KEYS = new Set(['', 'sk-REPLACE_ME']);
const PLACEHOLDER_TOKENS = new Set(['', 'REPLACE_ME']);

function int(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawKey = env.OPENAI_API_KEY?.trim() ?? '';
  const port = Number.parseInt(env.PORT ?? '8787', 10);
  return {
    port: Number.isFinite(port) ? port : 8787,
    host: env.HOST?.trim() || '0.0.0.0',
    commit: env.APP_VERSION?.trim() || 'dev',
    openaiApiKey: PLACEHOLDER_KEYS.has(rawKey) ? null : rawKey,
    appAccessToken: PLACEHOLDER_TOKENS.has(env.APP_ACCESS_TOKEN?.trim() ?? '') ? null : env.APP_ACCESS_TOKEN!.trim(),
    limits: {
      // ~1 frame/s while Navigate is open, minus latency-driven drops.
      vision: { perMinute: int(env.LIMIT_VISION_PER_MINUTE, 70), perDay: int(env.LIMIT_VISION_PER_DAY, 3000) },
      voice: { perMinute: int(env.LIMIT_VOICE_PER_MINUTE, 10), perDay: int(env.LIMIT_VOICE_PER_DAY, 300) },
    },
    models: {
      vision: env.OPENAI_VISION_MODEL?.trim() || 'gpt-6-luna',
      transcribe: env.OPENAI_TRANSCRIBE_MODEL?.trim() || 'gpt-transcribe',
      text: env.OPENAI_TEXT_MODEL?.trim() || 'gpt-6.1-sol',
    },
    // Set OPENAI_TEXT_REASONING_EFFORT=default to use the model's own default.
    textReasoningEffort:
      env.OPENAI_TEXT_REASONING_EFFORT?.trim() === 'default' ? null : env.OPENAI_TEXT_REASONING_EFFORT?.trim() || 'low',
  };
}
