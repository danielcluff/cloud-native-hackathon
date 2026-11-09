/**
 * Decides which vision results are worth SPEAKING. Pure TypeScript (tested
 * with node --test).
 *
 * - Results for frames older than the freshness budget are stale: never spoken.
 * - Blocked path (obstacle, wall, group): the server's phrase leads with the
 *   direction ("Veer right. ..."). Spoken when WHAT or WHICH WAY changes
 *   (`alertKey` includes the steer), then repeated every other fresh
 *   assessment while it persists.
 * - "Path ahead looks clear": only at the start or on the transition from a
 *   blocked path, so it never becomes a reassuring drone. A small drift
 *   correction on a clear path ("Slightly left.") is spoken once when it appears.
 * - Steering has three strengths: "Slightly" (small correction), "Veer" (step
 *   around something), "Turn ... to find a path" (blocked by a barrier/wall).
 * - A lone standing person must be close, directly ahead and seen in two
 *   consecutive fresh assessments before being announced; further away, never.
 * - Unknown / errors: rate-limited, so problems are reported without nagging.
 */
import type { VisionAssessment, VisionStaleAfterMs } from '../../../shared/contracts';

// 4 s: measured capture-to-result times on a real walk were 2.0-4.8 s.
export const VISION_STALE_AFTER_MS: VisionStaleAfterMs = 4000;
export const REPEAT_UNKNOWN_MS = 10_000;
export const REPEAT_PROBLEM_MS = 20_000;

type Kind = 'hazard' | 'clear' | 'unknown' | 'problem';

export class FeedbackPolicy {
  private lastKind: Kind | null = null;
  private lastKey: string | null = null;
  private skippedHazardFrame = false;
  private lastStandingPerson: { seq: number; capturedAt: number } | null = null;
  private lastSpokenAt = new Map<Kind, number>();

  /** Returns the phrase to speak, or null to stay quiet. */
  decide(result: VisionAssessment, frameCapturedAt: number, now: number): string | null {
    if (result.state === 'pending') return null;
    const previousPerson = this.lastStandingPerson;
    this.lastStandingPerson = null;
    if (result.state === 'stale' || now - frameCapturedAt > VISION_STALE_AFTER_MS) return null;

    if (result.state === 'ok') {
      if (result.standingPerson) {
        this.lastStandingPerson = { seq: result.frameSeq, capturedAt: frameCapturedAt };
      }
      if (result.standingPerson === 'in_front') return null; // a person further away: never announced
      if (result.standingPerson === 'close_ahead') {
        const confirmed =
          previousPerson !== null &&
          result.frameSeq > previousPerson.seq &&
          frameCapturedAt > previousPerson.capturedAt &&
          frameCapturedAt - previousPerson.capturedAt <= VISION_STALE_AFTER_MS;
        if (!confirmed) return null;
      }
      const key = result.alertKey;
      if (key === null) return null;
      if (result.clearOfVisibleObstacles) {
        // Plain "clear": only at the start or after a blocked path. A small drift
        // correction ("Slightly left. Path ahead looks clear.") speaks once when it appears.
        const transition =
          this.lastKind === null || this.lastKind === 'hazard' || (key !== 'clear' && this.lastKey !== key);
        return this.emit('clear', key, result.spokenSummary, now, transition);
      }
      const changed = this.lastKind !== 'hazard' || this.lastKey !== key;
      const speak = changed || this.skippedHazardFrame;
      this.skippedHazardFrame = !speak;
      return this.emit('hazard', key, result.spokenSummary, now, speak);
    }
    if (result.state === 'unknown') {
      const due = now - (this.lastSpokenAt.get('unknown') ?? -Infinity) >= REPEAT_UNKNOWN_MS;
      return this.emit('unknown', `unknown:${result.reason}`, result.reason, now, due);
    }
    const due = now - (this.lastSpokenAt.get('problem') ?? -Infinity) >= REPEAT_PROBLEM_MS;
    return this.emit('problem', 'problem', 'Obstacle feedback is unavailable right now. Keep using your usual mobility aids.', now, due);
  }

  reset(): void {
    this.lastKind = null;
    this.lastKey = null;
    this.skippedHazardFrame = false;
    this.lastStandingPerson = null;
    this.lastSpokenAt.clear();
  }

  private emit(kind: Kind, key: string, phrase: string, now: number, speak: boolean): string | null {
    // Track state even when quiet so transitions are detected correctly.
    this.lastKind = kind;
    if (!speak) return null;
    this.lastKey = key;
    this.lastSpokenAt.set(kind, now);
    return phrase;
  }
}
