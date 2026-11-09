/**
 * Decides which vision results are worth SPEAKING. Pure TypeScript (tested
 * with node --test).
 *
 * - Results for frames older than the freshness budget are stale: never spoken.
 * - Hazards (fixed obstacles, groups): spoken when WHAT is announced changes
 *   (`alertKey`, e.g. "fixed:furniture:ahead"), or repeated at most every
 *   REPEAT_HAZARD_MS. Wording-only changes (like the side hint) don't re-trigger.
 * - "No fixed obstacles detected in view": only on the transition from a
 *   hazard (or the first result), so it never becomes a reassuring drone.
 * - Single passers-by have no alert and are never spoken.
 * - Unknown / errors: rate-limited, so problems are reported without nagging.
 */
import type { VisionAssessment, VisionStaleAfterMs } from '../../../shared/contracts';

export const VISION_STALE_AFTER_MS: VisionStaleAfterMs = 3000;
export const REPEAT_HAZARD_MS = 4000;
export const REPEAT_UNKNOWN_MS = 10_000;
export const REPEAT_PROBLEM_MS = 20_000;

type Kind = 'hazard' | 'clear' | 'unknown' | 'problem';

export class FeedbackPolicy {
  private lastKind: Kind | null = null;
  private lastKey: string | null = null;
  private lastSpokenAt = new Map<Kind, number>();

  /** Returns the phrase to speak, or null to stay quiet. */
  decide(result: VisionAssessment, frameCapturedAt: number, now: number): string | null {
    if (result.state === 'pending') return null;
    if (now - frameCapturedAt > VISION_STALE_AFTER_MS) return null;

    if (result.state === 'ok') {
      if (result.alertKey === null) return null;
      if (result.clearOfVisibleObstacles) {
        const transition = this.lastKind === null || this.lastKind === 'hazard';
        return this.emit('clear', result.alertKey, result.spokenSummary, now, transition);
      }
      const changed = this.lastKind !== 'hazard' || this.lastKey !== result.alertKey;
      const due = now - (this.lastSpokenAt.get('hazard') ?? -Infinity) >= REPEAT_HAZARD_MS;
      return this.emit('hazard', result.alertKey, result.spokenSummary, now, changed || due);
    }
    if (result.state === 'unknown') {
      const due = now - (this.lastSpokenAt.get('unknown') ?? -Infinity) >= REPEAT_UNKNOWN_MS;
      return this.emit('unknown', `unknown:${result.reason}`, result.reason, now, due);
    }
    if (result.state === 'stale') return null;
    const due = now - (this.lastSpokenAt.get('problem') ?? -Infinity) >= REPEAT_PROBLEM_MS;
    return this.emit('problem', 'problem', 'Obstacle feedback is unavailable right now. Keep using your usual mobility aids.', now, due);
  }

  reset(): void {
    this.lastKind = null;
    this.lastKey = null;
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
