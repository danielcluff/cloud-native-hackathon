import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Access control for the public endpoint:
 *  - Pairing token: every /v1/* request must carry `Authorization: Bearer <token>`.
 *    The token lives only in the cluster Secret and the paired phone's keychain.
 *  - Usage caps: per-minute bursts and per-day totals for paid AI calls, a
 *    stand-in for an OpenAI budget. Counters are in memory (single replica).
 */

const digest = (s: string) => createHash('sha256').update(s).digest();

export function tokenMatches(header: string | undefined, expected: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!m) return false;
  // Hash both sides so lengths match and comparison is constant-time.
  return timingSafeEqual(digest(m[1]!.trim()), digest(expected));
}

export interface Limits {
  perMinute: number;
  perDay: number;
}

export class UsageCaps {
  private minute = new Map<string, { window: number; count: number }>();
  private day = new Map<string, { window: string; count: number }>();
  private readonly limits: Record<string, Limits>;
  private readonly now: () => number;

  constructor(limits: Record<string, Limits>, now: () => number = Date.now) {
    this.limits = limits;
    this.now = now;
  }

  /** Records one call. Returns null if allowed, otherwise a reason. */
  take(kind: string): 'minute' | 'day' | null {
    const limit = this.limits[kind];
    if (!limit) return null;
    const t = this.now();
    const minuteWindow = Math.floor(t / 60_000);
    const dayWindow = new Date(t).toISOString().slice(0, 10); // UTC day
    const m = this.minute.get(kind);
    const d = this.day.get(kind);
    const mCount = m && m.window === minuteWindow ? m.count : 0;
    const dCount = d && d.window === dayWindow ? d.count : 0;
    if (dCount >= limit.perDay) return 'day';
    if (mCount >= limit.perMinute) return 'minute';
    this.minute.set(kind, { window: minuteWindow, count: mCount + 1 });
    this.day.set(kind, { window: dayWindow, count: dCount + 1 });
    return null;
  }
}
