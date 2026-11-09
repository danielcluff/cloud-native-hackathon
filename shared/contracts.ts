/**
 * Typed boundaries shared by the mobile app and the backend.
 *
 * TYPE-ONLY module. The mobile app imports it with `import type`, which Babel
 * erases, so Metro never has to resolve a file outside `mobile/`.
 *
 * Nothing here describes an OpenAI request/response schema. These are OUR
 * app-level shapes; the backend adapter (milestone 2+) maps OpenAI responses
 * into them after consulting current official docs.
 */

// ---------- Generic availability ----------

/** Every AI-derived result must say how trustworthy/fresh it is. */
export type ResultState =
  | 'unavailable' // feature not configured (e.g. no server API key) or offline
  | 'pending' // request in flight
  | 'unknown' // service answered but could not decide
  | 'ok' // fresh, usable result
  | 'stale' // result older than the freshness budget; do not speak as current
  | 'error';

// ---------- Backend health ----------

export interface HealthResponse {
  status: 'ok';
  service: 'cnh-backend';
  version: string;
  /** Seven-character git commit of the running image ("dev" locally). */
  commit: string;
  /** ISO timestamp from the server clock. */
  time: string;
  /** Whether server-side integrations are configured. Never includes secrets. */
  integrations: {
    openai: 'configured' | 'not_configured';
  };
  /** 'token' = /v1/* requires a pairing token; 'none' = open (local dev only). */
  auth: 'token' | 'none';
}

// ---------- Vision (obstacle assessment) ----------

/** Metadata about one camera frame. Pixels never cross this boundary as logs. */
export interface FrameMeta {
  /** Monotonic counter for this capture session. */
  seq: number;
  /** ms epoch when capture resolved on the device. */
  capturedAt: number;
  width: number;
  height: number;
}

/**
 * Result of a visible-obstacle assessment. A result NEVER proves a path is safe;
 * `clearOfVisibleObstacles` only means none were detected in this frame.
 */
export type VisionAssessment =
  | { state: 'unavailable'; reason: string }
  | { state: 'pending'; frameSeq: number }
  | { state: 'unknown'; frameSeq: number; reason: string }
  | { state: 'stale'; frameSeq: number; ageMs: number }
  | { state: 'error'; frameSeq: number; message: string }
  | {
      state: 'ok';
      frameSeq: number;
      assessedAt: number;
      /** Short phrase suitable for speech, e.g. "Person ahead, slightly left." */
      spokenSummary: string;
      hazards: Array<{
        label: string;
        direction: 'left' | 'ahead' | 'right' | 'unclear';
        proximity: 'near' | 'mid' | 'far' | 'unclear';
      }>;
      clearOfVisibleObstacles: boolean;
    };

/**
 * Freshness budget (ms): vision results older than this must be treated as
 * stale. Expressed as a type so this file stays type-only; consumers declare
 * `const VISION_STALE_AFTER_MS: VisionStaleAfterMs = 3000`.
 */
export type VisionStaleAfterMs = 3000;

// ---------- Planner (interview + schedule + routes) ----------

/** A session must come from a real, cited source; no fabricated agenda data. */
export interface ConferenceSession {
  id: string;
  title: string;
  /** Local wall-clock time at the venue, no offset, e.g. "2026-11-10T11:00:00". */
  startsAt: string;
  endsAt: string;
  /** IANA zone the times are in (Salt Lake City). */
  timeZone: 'America/Denver';
  /** Full room name from the schedule, e.g. "Salt Palace | Level 1 | Hall DE". */
  room: string;
  /** Building part of the room name, e.g. "Salt Palace" or "Hyatt Regency". */
  building: string;
  track: string | null;
  level: string | null;
  speakers: string[];
  /** Plain-text description, truncated for speech. */
  summary: string;
  /** Official schedule page for this session. */
  sourceUrl: string;
}

export interface InterestProfile {
  topics: string[];
  avoid: string[];
  /** "Beginner", "Intermediate", "Advanced" or null when unknown. */
  level: string | null;
  /** Conference day the user is planning, "YYYY-MM-DD", or null for "from now on". */
  day: string | null;
  notes: string;
}

export interface RouteStep {
  instruction: string;
  /** Landmark the user should confirm before continuing. */
  confirmLandmark?: string;
}

export type PlannerResult =
  | { state: 'unavailable'; reason: string }
  | { state: 'pending' }
  | { state: 'unknown'; reason: string }
  | { state: 'error'; message: string }
  | {
      state: 'ok';
      recommendations: ConferenceSession[];
      /** Coarse route steps (building/level/room, confirm with signs or staff); no turn-by-turn. */
      routes: Array<{ fromSessionId: string | null; toSessionId: string; steps: RouteStep[] }>;
    };

// ---------- Voice turn (push-to-talk interview) ----------

export type VoiceTurnResult =
  | { state: 'unavailable'; reason: string }
  | { state: 'error'; message: string; retryable: boolean }
  | {
      state: 'ok';
      conversationId: string;
      /** What we heard (or the typed text). Shown so the user can catch mistakes. */
      transcript: string;
      /** Short reply meant to be spoken. */
      replyText: string;
      profile: InterestProfile;
      plan: PlannerResult;
    };
