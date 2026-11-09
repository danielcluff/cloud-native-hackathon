/**
 * Decides which vision results are worth SPEAKING. Pure TypeScript (tested
 * with node --test).
 *
 * - Results for frames older than the freshness budget are stale: never spoken.
 * - Hazards (fixed obstacles, groups): spoken when WHAT is announced changes
 *   (`alertKey`, e.g. "fixed:table:ahead"), then repeated every other fresh
 *   assessment of that hazard.
 * - "No fixed obstacles detected in view": only on the transition from a
 *   hazard (or the first result), so it never becomes a reassuring drone.
 * - A lone standing person must appear in consecutive fresh assessments and
 *   be close and directly ahead before being announced.
 * - Unknown / errors: rate-limited, so problems are reported without nagging.
 */
import type { VisionAssessment, VisionStaleAfterMs } from '../../../shared/contracts';

export const VISION_STALE_AFTER_MS: VisionStaleAfterMs = 3000;
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
      const personCloseAhead =
        result.standingPerson === 'close_ahead' &&
        previousPerson !== null &&
        result.frameSeq > previousPerson.seq &&
        frameCapturedAt > previousPerson.capturedAt &&
        frameCapturedAt - previousPerson.capturedAt <= VISION_STALE_AFTER_MS;
      let key = result.alertKey;
      let phrase = result.spokenSummary;
      if (personCloseAhead) {
        key = result.clearOfVisibleObstacles ? 'person:ahead:close' : `person:ahead:close|${key}`;
        phrase = result.clearOfVisibleObstacles ? 'Person ahead, close.' : `Person ahead, close. ${phrase}`;
      }
      if (key === null) return null;
      if (result.clearOfVisibleObstacles && !personCloseAhead) {
        const transition = this.lastKind === null || this.lastKind === 'hazard';
        return this.emit('clear', key, phrase, now, transition);
      }
      const changed = this.lastKind !== 'hazard' || this.lastKey !== key;
      const speak = changed || this.skippedHazardFrame;
      this.skippedHazardFrame = !speak;
      return this.emit('hazard', key, phrase, now, speak);
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
