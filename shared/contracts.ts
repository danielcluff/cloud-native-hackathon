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

export type Direction = 'left' | 'slight_left' | 'ahead' | 'slight_right' | 'right' | 'unclear';
export type Proximity = 'near' | 'mid' | 'far' | 'unclear';

/**
 * How many people are in or near the walking path. A single passer-by is
 * reported but not announced; a group or crowd is something to route around.
 */
export type PeopleInPath = 'none' | 'single' | 'group' | 'crowd' | 'unclear';

/** Side with walkable open floor next to the walking path. */
export type OpenSide = 'left' | 'right' | 'either' | 'neither' | 'unclear';

/**
 * Which way to go, in three strengths. The walking path is the CENTER of the camera view.
 * - straight: the path ahead looks clear
 * - slight_*: a small correction (something at the edge of the path, or drifting toward an edge)
 * - veer_*: a clear step around something in the middle of the path
 * - turn_*: straight ahead is blocked up close (counter, wall...); rotate that way to find a path
 * - turn_either: blocked and neither side looks better; rotate to look for a path
 */
export type Steer =
  | 'straight'
  | 'slight_left'
  | 'slight_right'
  | 'veer_left'
  | 'veer_right'
  | 'turn_left'
  | 'turn_right'
  | 'turn_either'
  | 'unclear';

/** Where an obstacle sits inside the walking path (the center band of the view). */
export type PathPosition = 'left_part' | 'center' | 'right_part' | 'unclear';

export interface VisionHazard {
  /** 'fixed' = won't move (furniture, column, wall...); 'people' = someone standing, a group or crowd. */
  kind: 'fixed' | 'people';
  /** Specific label, e.g. 'backpack_or_bag', 'table_or_counter', 'wall_or_door', 'group_of_people'. */
  label: string;
  direction: Direction;
  proximity: Proximity;
  /** Position within the walking path. */
  position?: PathPosition;
}

/**
 * Result of a visible-obstacle assessment. A result NEVER proves a path is safe;
 * `clearOfVisibleObstacles` only means nothing was detected in the walking path
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
      /** Short phrase for speech, direction first, e.g. "Veer right. Backpack on the left of your path, close." */
      spokenSummary: string;
      /** Things IN the walking path, most important first. Things beside the path are not hazards. */
      hazards: VisionHazard[];
      people: PeopleInPath;
      /** A single person standing in the path: the phone confirms it across two fresh frames before speaking. */
      standingPerson?: 'in_front' | 'close_ahead';
      openSide: OpenSide;
      /** Which way to go. */
      steer: Steer;
      /** The camera faces a wall, door or large surface at close range. */
      facingWall: boolean;
      /** Walking straight ~2 m would hit something at body height (e.g. a counter), even if floor shows below it. */
      walkInto?: boolean;
      clearOfVisibleObstacles: boolean;
      /**
       * Stable identity of what's being announced (obstacle, position and
       * steer), so the app doesn't re-announce when only the wording changes.
       * null when there is nothing to announce.
       */
      alertKey: string | null;
    };

/** On-demand identification of an obstacle that has stayed in view. */
export type ObstacleDescription =
  | { state: 'ok'; frameSeq: number; description: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'error'; frameSeq: number; message: string };

/**
 * Freshness budget (ms): vision results older than this must be treated as
 * stale. Expressed as a type so this file stays type-only; consumers declare
 * `const VISION_STALE_AFTER_MS: VisionStaleAfterMs = 4000`.
 */
export type VisionStaleAfterMs = 4000;

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
