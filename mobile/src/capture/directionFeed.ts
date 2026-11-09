/**
 * Debug "direction feed": a short on-screen log of every vision assessment and
 * whether the app announced it. Evidence of what the app decided when audio
 * is off, muted, or routed to VoiceOver. Pure TypeScript (tested with node).
 */
import type { VisionAssessment, VisionStaleAfterMs } from '../../../shared/contracts';

/** Same budget as FeedbackPolicy (type-checked against the shared contract). */
const VISION_STALE_AFTER_MS: VisionStaleAfterMs = 4000;

export interface FeedEntry {
  id: number;
  /** Wall-clock time the result arrived (ms epoch). */
  at: number;
  frameSeq: number | null;
  /** Capture-to-result latency in ms. */
  latencyMs: number;
  /** What was announced, or what the assessment said if nothing was announced. */
  text: string;
  /** True when the phrase was sent to speech / VoiceOver. */
  spoken: boolean;
  /** Why it wasn't announced (null when spoken). */
  note: string | null;
}

export const FEED_LIMIT = 30;

/** What the assessment itself says, independent of whether it was spoken. */
export function assessmentText(r: VisionAssessment): string {
  switch (r.state) {
    case 'ok':
      return r.spokenSummary || (r.clearOfVisibleObstacles ? 'No fixed obstacles detected in view.' : 'Nothing to report.');
    case 'unknown':
      return r.reason;
    case 'unavailable':
      return `Unavailable: ${r.reason}`;
    case 'error':
      return `Error: ${r.message}`;
    case 'stale':
      return 'Result arrived too late.';
    case 'pending':
      return 'Waiting…';
  }
}

/** Best-effort reason for staying quiet, mirroring FeedbackPolicy's rules. */
export function quietReason(r: VisionAssessment, latencyMs: number): string {
  if (r.state === 'stale' || latencyMs > VISION_STALE_AFTER_MS) {
    return `stale (${(latencyMs / 1000).toFixed(1)}s old), not spoken`;
  }
  if (r.state === 'ok') {
    // FeedbackPolicy only announces a close standing person after two fresh frames.
    if (r.standingPerson === 'close_ahead') return 'person ahead, waiting for a 2nd frame';
    if (r.clearOfVisibleObstacles) return 'still clear, not repeated';
    if (r.alertKey === null) return 'nothing to announce';
    return 'same cue, repeats every other frame';
  }
  if (r.state === 'unknown') return 'unclear, rate-limited';
  return 'problem, rate-limited';
}

export function makeEntry(
  id: number,
  result: VisionAssessment,
  spokenPhrase: string | null,
  frame: { seq: number; capturedAt: number },
  now: number,
): FeedEntry {
  const latencyMs = Math.max(0, now - frame.capturedAt);
  return {
    id,
    at: now,
    frameSeq: frame.seq,
    latencyMs,
    text: spokenPhrase ?? assessmentText(result),
    spoken: spokenPhrase !== null,
    note: spokenPhrase !== null ? null : quietReason(result, latencyMs),
  };
}

/** Feed line for an obstacle description ("Looks like: ..."). */
export function makeDescriptionEntry(
  id: number,
  text: string,
  spoken: boolean,
  frame: { seq: number; capturedAt: number },
  now: number,
): FeedEntry {
  return {
    id,
    at: now,
    frameSeq: frame.seq,
    latencyMs: Math.max(0, now - frame.capturedAt),
    text,
    spoken,
    note: spoken ? null : 'description failed',
  };
}

/** Newest first, capped. */
export function pushEntry(feed: FeedEntry[], entry: FeedEntry, limit = FEED_LIMIT): FeedEntry[] {
  return [entry, ...feed].slice(0, limit);
}

/** "15:31:02" in the phone's local time. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
