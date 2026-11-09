import type { ConferenceSession, InterestProfile, PlannerResult, VoiceTurnResult } from '../../shared/contracts.ts';
import type { OpenAIClient } from './openai.ts';
import { candidateSessions, nonOverlapping, routeSteps, venueNow, type ScheduleCatalog } from './schedule.ts';

/** In-memory conversation state. Fine for a single-replica hackathon backend. */
interface Conversation {
  profile: InterestProfile;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  planIds: string[];
  touchedAt: number;
}

export const EMPTY_PROFILE: InterestProfile = { topics: [], avoid: [], level: null, day: null, notes: '' };
const MAX_HISTORY = 12;
const MAX_CONVERSATIONS = 500;
const CONVERSATION_TTL_MS = 6 * 60 * 60_000;

const INSTRUCTIONS = `You are a calm, concise voice concierge helping a blind or low-vision attendee plan their day at KubeCon + CloudNativeCon North America 2026 in Salt Lake City (November 9-12, 2026).

Your reply is spoken aloud by text-to-speech, so:
- Use at most 3 short sentences (under 60 words). No lists, markdown, URLs, or emoji.
- Say times like "11 AM" and rooms by building and room name.

Conversation:
- First learn what they care about (topics, experience level, which day, anything to avoid). Ask one question at a time.
- Once you know at least one topic, recommend sessions. They can revise ("swap the second one", "nothing about security", "only Wednesday").
- Recommend ONLY sessions from the CANDIDATE SESSIONS list, by their exact id. Never invent sessions, speakers, rooms, or times. If no candidate fits, say so and ask a follow-up.
- Pick at most 5 sessions, in time order, that do not overlap.
- Never give walking directions or claim a route is safe. You may name the building and room.

Always return the full updated interest profile and the complete current plan (session ids). Keep sessions from the previous plan unless the user asked to change them and they are still in the candidate list.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'profile', 'planSessionIds'],
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
    planSessionIds: { type: 'array', items: { type: 'string' } },
  },
} as const;

interface ModelTurn {
  reply: string;
  profile: InterestProfile;
  planSessionIds: string[];
}

function isModelTurn(x: unknown): x is ModelTurn {
  const t = x as ModelTurn;
  return (
    !!t &&
    typeof t.reply === 'string' &&
    Array.isArray(t.planSessionIds) &&
    !!t.profile &&
    Array.isArray(t.profile.topics) &&
    Array.isArray(t.profile.avoid)
  );
}

function describe(s: ConferenceSession): string {
  const time = `${s.startsAt.slice(0, 10)} ${s.startsAt.slice(11, 16)}-${s.endsAt.slice(11, 16)}`;
  const who = s.speakers.length ? ` | speakers: ${s.speakers.slice(0, 3).join(', ')}` : '';
  return `- id ${s.id} | ${time} | ${s.room} | track: ${s.track ?? 'n/a'} | level: ${s.level ?? 'n/a'} | ${s.title}${who} | ${s.summary.slice(0, 160)}`;
}

export function buildPlan(sessions: ConferenceSession[]): PlannerResult {
  if (sessions.length === 0) return { state: 'ok', recommendations: [], routes: [] };
  const ordered = nonOverlapping(sessions);
  return {
    state: 'ok',
    recommendations: ordered,
    routes: ordered.map((s, i) => ({
      fromSessionId: i === 0 ? null : ordered[i - 1]!.id,
      toSessionId: s.id,
      steps: routeSteps(i === 0 ? null : ordered[i - 1]!, s),
    })),
  };
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
      c = { profile: { ...EMPTY_PROFILE }, history: [], planIds: [], touchedAt: now };
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

    const previous = conv.planIds.map((id) => byId.get(id)).filter((s): s is ConferenceSession => !!s);
    const candidates = candidateSessions(catalog.sessions, conv.profile, text, nowLocal);
    const candidateIds = new Set([...candidates, ...previous].map((s) => s.id));
    const listed = [...new Map([...previous, ...candidates].map((s) => [s.id, s])).values()];

    const context = [
      `Current venue time: ${nowLocal.replace('T', ' ')} (Salt Lake City).`,
      `Current profile: ${JSON.stringify(conv.profile)}`,
      `Current plan ids: ${conv.planIds.length ? conv.planIds.join(', ') : 'none'}`,
      `CANDIDATE SESSIONS (${listed.length}):`,
      listed.length ? listed.map(describe).join('\n') : '(none match yet; ask about their interests)',
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

    // Anti-fabrication: drop any id that wasn't in the list we provided.
    const picked = raw.planSessionIds.filter((id) => candidateIds.has(id)).map((id) => byId.get(id)!);
    const plan = buildPlan(picked.slice(0, 5));
    conv.profile = raw.profile;
    conv.planIds = plan.state === 'ok' ? plan.recommendations.map((s) => s.id) : [];
    // History keeps what was said, not the bulky candidate context.
    conv.history.push({ role: 'user', content: text }, { role: 'assistant', content: raw.reply });
    if (conv.history.length > MAX_HISTORY) conv.history.splice(0, conv.history.length - MAX_HISTORY);

    return { state: 'ok', conversationId, transcript: text, replyText: raw.reply, profile: conv.profile, plan };
  }
}
