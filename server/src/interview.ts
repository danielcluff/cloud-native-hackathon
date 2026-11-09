import type { ConferenceSession, InterestProfile, PlanItem, PlannerResult, VoiceTurnResult } from '../../shared/contracts.ts';
import type { OpenAIClient } from './openai.ts';
import { candidateSessions, fillDay, routeSteps, venueNow, type ScheduleCatalog } from './schedule.ts';

/** In-memory conversation state. Fine for a single-replica hackathon backend. */
interface Conversation {
  profile: InterestProfile;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Sessions the model picked as direct matches. */
  matchIds: string[];
  /** Sessions the attendee rejected; never re-suggested in this conversation. */
  excludedIds: Set<string>;
  /** Current full plan (matches + gap fillers), for the next turn's context. */
  plan: PlanItem[];
  touchedAt: number;
}

export const EMPTY_PROFILE: InterestProfile = { topics: [], avoid: [], level: null, day: null, notes: '' };
const MAX_HISTORY = 8;
const MAX_CONVERSATIONS = 500;
const CONVERSATION_TTL_MS = 6 * 60 * 60_000;
const MAX_MATCHES = 4;
const MAX_PLAN = 6;

const INSTRUCTIONS = `You are a calm, concise voice concierge helping a blind or low-vision attendee plan their day at KubeCon + CloudNativeCon North America 2026 in Salt Lake City (November 9-12, 2026).

Your reply is spoken by text-to-speech: at most 2 short sentences (under 45 words). No lists, markdown, URLs, or emoji. Say times like "11 AM".

How planning works:
- You choose only DIRECT MATCHES: sessions from the CANDIDATES list that clearly match what the attendee asked for (at most ${MAX_MATCHES}). Use exact ids. Never invent sessions, speakers, rooms or times.
- The app then automatically fills the rest of the day's open time with loosely related sessions, and tells the attendee how many. Do not list or count those yourself.
- If the attendee rejects, removes or wants to swap a session (a match OR a filler from CURRENT PLAN), put its id in excludeSessionIds. To swap in a different match, add the new id to matchSessionIds.
- Keep previous matches unless the attendee asked to change them.
- If you don't know any interest yet, ask one short question (topics, experience level, which day) and return no matches.
- In your reply, name the top match by title and time, then ask one short follow-up (for example, anything to avoid or swap).
- Never give walking directions or claim a route is safe.

Always return the full updated interest profile.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'profile', 'matchSessionIds', 'excludeSessionIds'],
  properties: {
    reply: { type: 'string' },
    profile: {
      type: 'object',
      additionalProperties: false,
      required: ['topics', 'avoid', 'level', 'day', 'notes'],
      properties: {
        topics: { type: 'array', items: { type: 'string' } },
        avoid: { type: 'array', items: { type: 'string' } },
        level: { type: ['string', 'null'], enum: ['Beginner', 'Intermediate', 'Advanced', null] },
        day: { type: ['string', 'null'], enum: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', null] },
        notes: { type: 'string' },
      },
    },
    matchSessionIds: { type: 'array', items: { type: 'string' } },
    excludeSessionIds: { type: 'array', items: { type: 'string' } },
  },
} as const;

interface ModelTurn {
  reply: string;
  profile: InterestProfile;
  matchSessionIds: string[];
  excludeSessionIds: string[];
}

function isModelTurn(x: unknown): x is ModelTurn {
  const t = x as ModelTurn;
  return (
    !!t &&
    typeof t.reply === 'string' &&
    Array.isArray(t.matchSessionIds) &&
    Array.isArray(t.excludeSessionIds) &&
    !!t.profile &&
    Array.isArray(t.profile.topics) &&
    Array.isArray(t.profile.avoid)
  );
}

/** Compact line per session: enough for the model to judge, short enough to be fast. */
function describe(s: ConferenceSession, fit?: string): string {
  const time = `${s.startsAt.slice(5, 10)} ${s.startsAt.slice(11, 16)}-${s.endsAt.slice(11, 16)}`;
  return `- id ${s.id}${fit ? ` [${fit}]` : ''} | ${time} | ${s.track ?? 'n/a'} | ${s.level ?? 'n/a'} | ${s.title} | ${s.summary.slice(0, 100)}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function dayName(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return DAY_NAMES[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()]!;
}

export function buildPlan(day: string | null, items: PlanItem[]): PlannerResult {
  return {
    state: 'ok',
    day,
    recommendations: items,
    routes: items.map((s, i) => ({
      fromSessionId: i === 0 ? null : items[i - 1]!.id,
      toSessionId: s.id,
      steps: routeSteps(i === 0 ? null : items[i - 1]!, s),
    })),
  };
}

/** Short spoken summary the server adds, so the counts are always right. */
export function planSummary(day: string | null, items: PlanItem[]): string {
  if (!day || items.length === 0) return '';
  const matches = items.filter((i) => i.fit === 'match').length;
  const others = items.length - matches;
  const parts = [
    matches ? `${matches} ${matches === 1 ? 'match' : 'matches'}` : '',
    others ? `${others} more ${others === 1 ? 'session' : 'sessions'} to fill your day` : '',
  ].filter(Boolean);
  return `Your ${dayName(day)} plan has ${parts.join(' and ')}.`;
}

export class Interviewer {
  private conversations = new Map<string, Conversation>();
  private readonly ai: OpenAIClient | null;
  private readonly catalog: ScheduleCatalog;
  private readonly clock: () => Date;

  constructor(ai: OpenAIClient | null, catalog: ScheduleCatalog, clock: () => Date = () => new Date()) {
    this.ai = ai;
    this.catalog = catalog;
    this.clock = clock;
  }

  private conversation(id: string): Conversation {
    const now = Date.now();
    for (const [k, c] of this.conversations) if (now - c.touchedAt > CONVERSATION_TTL_MS) this.conversations.delete(k);
    let c = this.conversations.get(id);
    if (!c) {
      if (this.conversations.size >= MAX_CONVERSATIONS) {
        const oldest = [...this.conversations.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
        if (oldest) this.conversations.delete(oldest[0]);
      }
      c = { profile: { ...EMPTY_PROFILE }, history: [], matchIds: [], excludedIds: new Set(), plan: [], touchedAt: now };
      this.conversations.set(id, c);
    }
    c.touchedAt = now;
    return c;
  }

  reset(id: string): void {
    this.conversations.delete(id);
  }

  async turn(conversationId: string, userText: string, signal?: AbortSignal): Promise<VoiceTurnResult> {
    if (!this.ai) return { state: 'unavailable', reason: 'The server has no OpenAI API key configured.' };
    const text = userText.trim();
    if (!text) return { state: 'error', message: "I didn't catch anything. Please try again.", retryable: true };

    const catalog = await this.catalog.get();
    if (!catalog) {
      return { state: 'error', message: 'The conference schedule is unavailable right now.', retryable: true };
    }
    const conv = this.conversation(conversationId);
    const byId = new Map(catalog.sessions.map((s) => [s.id, s]));
    const nowLocal = venueNow(this.clock());

    const candidates = candidateSessions(catalog.sessions, conv.profile, text, nowLocal).filter(
      (s) => !conv.excludedIds.has(s.id),
    );
    const planIds = new Set(conv.plan.map((s) => s.id));
    const allowedIds = new Set([...candidates.map((s) => s.id), ...planIds]);

    const context = [
      `Venue time now: ${nowLocal.replace('T', ' ')} (Salt Lake City).`,
      `Profile: ${JSON.stringify(conv.profile)}`,
      `CURRENT PLAN (${conv.plan.length}):`,
      conv.plan.length ? conv.plan.map((s) => describe(s, s.fit)).join('\n') : '(empty)',
      `CANDIDATES (${candidates.length}):`,
      candidates.length ? candidates.map((s) => describe(s)).join('\n') : '(none yet; ask about their interests)',
    ].join('\n');

    let raw: unknown;
    try {
      raw = await this.ai.respondJson(
        {
          instructions: INSTRUCTIONS,
          input: [...conv.history, { role: 'user', content: `${context}\n\nATTENDEE SAID: ${text}` }],
          format: { name: 'concierge_turn', schema: RESPONSE_SCHEMA },
        },
        signal,
      );
    } catch (e) {
      const { retryable = true, status } = e as { retryable?: boolean; status?: number | null };
      const message =
        status === 401 || status === 403
          ? 'The planning assistant is unavailable because the server is not set up correctly.'
          : 'The planning assistant is not responding. Please try again.';
      return { state: 'error', message, retryable };
    }
    if (!isModelTurn(raw)) {
      return { state: 'error', message: 'The planning assistant gave an unexpected answer. Please try again.', retryable: true };
    }

    // Anti-fabrication: only ids we showed the model (or already planned) count.
    for (const id of raw.excludeSessionIds) if (allowedIds.has(id)) conv.excludedIds.add(id);
    const matchIds = [...new Set(raw.matchSessionIds)]
      .filter((id) => allowedIds.has(id) && !conv.excludedIds.has(id))
      .slice(0, MAX_MATCHES);
    conv.profile = raw.profile;
    conv.matchIds = matchIds;

    // Server fills the rest of the day deterministically from real sessions.
    const filled =
      matchIds.length > 0 || conv.profile.topics.length > 0
        ? fillDay({
            all: catalog.sessions,
            matches: matchIds.map((id) => byId.get(id)!).filter(Boolean),
            profile: conv.profile,
            nowLocal,
            exclude: conv.excludedIds,
            extraText: text,
            maxTotal: MAX_PLAN,
          })
        : { day: null, items: [] };
    const items: PlanItem[] = filled.items.map(({ session, fit }) => ({ ...session, fit }));
    conv.plan = items;
    const plan = buildPlan(filled.day, items);

    const summary = planSummary(filled.day, items);
    const replyText = summary ? `${summary} ${raw.reply}` : raw.reply;

    // History keeps what was said, not the bulky context.
    conv.history.push({ role: 'user', content: text }, { role: 'assistant', content: replyText });
    if (conv.history.length > MAX_HISTORY) conv.history.splice(0, conv.history.length - MAX_HISTORY);

    return { state: 'ok', conversationId, transcript: text, replyText, profile: conv.profile, plan };
  }
}
