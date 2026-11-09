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

export type Direction = 'left' | 'ahead' | 'right' | 'unclear';
export type Proximity = 'near' | 'mid' | 'far' | 'unclear';

/**
 * How many people are in or near the walking path. A single passer-by is
 * reported but not announced; a group or crowd is something to route around.
 */
export type PeopleInPath = 'none' | 'single' | 'group' | 'crowd' | 'unclear';

/** Which side of the path has more open floor for going around. */
export type OpenSide = 'left' | 'right' | 'either' | 'neither' | 'unclear';

export interface VisionHazard {
  /** 'fixed' = won't move (furniture, column, step...); 'people' = a group or crowd. */
  kind: 'fixed' | 'people';
  /** e.g. 'furniture', 'step_or_stairs', 'group'. */
  label: string;
  direction: Direction;
  proximity: Proximity;
}

/**
 * Result of a visible-obstacle assessment. A result NEVER proves a path is safe;
 * `clearOfVisibleObstacles` only means no fixed obstacle or group was detected
 * in this frame.
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
      /** Short phrase for speech, e.g. "Table ahead, close. More room on the right." */
      spokenSummary: string;
      /** Fixed obstacles first, then groups; single passers-by are not hazards. */
      hazards: VisionHazard[];
      people: PeopleInPath;
      openSide: OpenSide;
      clearOfVisibleObstacles: boolean;
      /**
       * Stable identity of what's being announced (e.g. "fixed:furniture:ahead"),
       * so the app doesn't re-announce the same thing when only the wording
       * changes. null when there is nothing to announce.
       */
      alertKey: string | null;
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

/**
 * How a planned session relates to the attendee's request:
 * - match: picked because it directly matches what they asked for
 * - related: added to fill open time; loosely related to their interests
 * - filler: added to fill open time; no clear link to their interests
 */
export type PlanFit = 'match' | 'related' | 'filler';

export interface PlanItem extends ConferenceSession {
  fit: PlanFit;
}

export type PlannerResult =
  | { state: 'unavailable'; reason: string }
  | { state: 'pending' }
  | { state: 'unknown'; reason: string }
  | { state: 'error'; message: string }
  | {
      state: 'ok';
      /** Day being planned ("YYYY-MM-DD", venue-local), or null when nothing is planned. */
      day: string | null;
      /** Time-ordered, non-overlapping; matches first chosen, then gaps filled. */
      recommendations: PlanItem[];
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
