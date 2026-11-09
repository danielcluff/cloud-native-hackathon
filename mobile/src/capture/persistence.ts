/**
 * Detects an obstacle that stays in the walking path across several fresh
 * assessments (usually: the person has stopped in front of it), so the app can
 * ask once for a fuller description. Pure TypeScript (tested with node).
 */
import type { VisionAssessment } from '../../../shared/contracts';

/** Obstacle identity: what it is, ignoring position/steer wobble between frames. */
function identity(r: VisionAssessment): string | null {
  if (r.state !== 'ok' || r.clearOfVisibleObstacles || r.facingWall) return null;
  const h = r.hazards[0];
  if (!h || h.label === 'wall_or_door') return null; // walls: the turn cue is enough
  return h.label;
}

export class PersistenceTracker {
  private key: string | null = null;
  private count = 0;
  private described = false;
  private readonly threshold: number;

  constructor(threshold = 3) {
    this.threshold = threshold;
  }

  /** Feed every fresh assessment. Returns true exactly once per streak, when it reaches the threshold. */
  observe(r: VisionAssessment): boolean {
    const id = identity(r);
    if (id === null) {
      this.key = null;
      this.count = 0;
      this.described = false;
      return false;
    }
    if (id === this.key) this.count++;
    else {
      this.key = id;
      this.count = 1;
      this.described = false;
    }
    if (this.count >= this.threshold && !this.described) {
      this.described = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this.key = null;
    this.count = 0;
    this.described = false;
  }
}

/**
 * Smallest camera picture size whose longer side is at least `minLongSide`.
 * Smaller photos upload faster; 640 px was enough on real venue frames.
 * Returns undefined (camera default) if no size string is "WxH".
 */
export function pickPictureSize(sizes: string[], minLongSide = 640): string | undefined {
  const parsed = sizes
    .map((s) => {
      const m = /^(\d+)x(\d+)$/.exec(s.trim());
      return m ? { s, long: Math.max(Number(m[1]), Number(m[2])), area: Number(m[1]) * Number(m[2]) } : null;
    })
    .filter((x): x is { s: string; long: number; area: number } => x !== null && x.long >= minLongSide)
    .sort((a, b) => a.area - b.area);
  return parsed[0]?.s;
}
