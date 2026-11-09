import type { ConferenceSession, InterestProfile, RouteStep } from '../../shared/contracts.ts';

/**
 * Official KubeCon + CloudNativeCon NA 2026 schedule. The LF schedule page at
 * SCHEDULE_PAGE is rendered from this public Sessionize feed (its
 * data-sched-config names api code svi82w6c). Times are local (Salt Lake City).
 */
export const SESSIONIZE_URL = 'https://sessionize.com/api/v2/svi82w6c/view/All';
export const SCHEDULE_PAGE = 'https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america/program/schedule/';
export const VENUE_TZ = 'America/Denver' as const;

/** Logistics, expo-hall activities and all-day events: never recommended. */
const NON_TALK_TRACKS = new Set([
  'Breaks',
  'Registration + Badge Pick-up',
  'Registration',
  'Solutions Showcase',
  'Project Pavilion Tours',
  'Sponsor-hosted Co-located Events',
  'CNCF-hosted Co-located Events',
  'Project Opportunities',
]);

/** Can be a match if asked for, but not used to fill open time. */
const NOT_FILLER_TRACKS = new Set(['Experiences', '🪧 Poster Sessions']);
const FILLER_MIN_MINUTES = 10;
const FILLER_MAX_MINUTES = 90;

interface SessionizeAll {
  sessions: Array<{
    id: string;
    title: string;
    description?: string | null;
    startsAt: string | null;
    endsAt: string | null;
    isServiceSession?: boolean;
    speakers?: string[];
    categoryItems?: number[];
    roomId?: number | null;
    status?: string | null;
  }>;
  speakers: Array<{ id: string; fullName: string }>;
  categories: Array<{ title: string; items: Array<{ id: number; name: string }> }>;
  rooms: Array<{ id: number; name: string }>;
}

function plain(text: string | null | undefined, max = 320): string {
  const t = (text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function normalizeSchedule(data: SessionizeAll): ConferenceSession[] {
  const rooms = new Map(data.rooms.map((r) => [r.id, r.name]));
  const speakers = new Map(data.speakers.map((s) => [s.id, s.fullName]));
  const itemCat = new Map<number, { cat: string; name: string }>();
  for (const c of data.categories) for (const i of c.items) itemCat.set(i.id, { cat: c.title, name: i.name });

  const out: ConferenceSession[] = [];
  for (const s of data.sessions) {
    if (!s.startsAt || !s.endsAt || s.isServiceSession) continue;
    if (s.status && s.status !== 'Accepted') continue;
    const cats = (s.categoryItems ?? []).map((id) => itemCat.get(id)).filter((x) => x !== undefined);
    const track = cats.find((c) => c.cat === 'All Sessions')?.name ?? null;
    const room = (s.roomId != null ? rooms.get(s.roomId) : undefined) ?? 'Room not listed';
    out.push({
      id: String(s.id),
      title: s.title.trim(),
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      timeZone: VENUE_TZ,
      room,
      building: room.split('|')[0]?.trim() || room,
      track,
      level: cats.find((c) => c.cat === 'Audience Level')?.name ?? null,
      speakers: (s.speakers ?? []).map((id) => speakers.get(id)).filter((n): n is string => !!n),
      summary: plain(s.description),
      sourceUrl: `${SCHEDULE_PAGE}?id=${encodeURIComponent(String(s.id))}`,
    });
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Current venue-local time as "YYYY-MM-DDTHH:MM:SS", comparable with startsAt. */
export function venueNow(now = new Date()): string {
  // sv-SE formats as "2026-11-09 12:30:00".
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: VENUE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(now)
    .replace(' ', 'T');
}

export function isTalk(s: ConferenceSession): boolean {
  return !(s.track && NON_TALK_TRACKS.has(s.track));
}

const STOP = new Set(
  'a an and are as at be but by for from how i im in into is it its me my of on or our so that the this to we what with you your want like about interested talks talk session sessions'.split(
    ' ',
  ),
);

export function keywords(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9+#.-]+/).filter((w) => w.length > 1 && !STOP.has(w)))];
}

/** Keyword relevance of a session to the profile (+ any extra text). 0 = unrelated. */
export function relevance(
  s: ConferenceSession,
  terms: string[],
  profile: InterestProfile,
  boostTracks: Set<string> = new Set(),
): number {
  const hay = `${s.title} ${s.track ?? ''} ${s.summary}`.toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (s.title.toLowerCase().includes(t)) score += 3;
    else if ((s.track ?? '').toLowerCase().includes(t)) score += 2;
    else if (hay.includes(t)) score += 1;
  }
  if (s.track && boostTracks.has(s.track)) score += 2;
  if (score > 0 && profile.level && s.level && s.level.toLowerCase().includes(profile.level.toLowerCase())) score += 1;
  return score;
}

function avoided(s: ConferenceSession, avoid: string[]): boolean {
  if (avoid.length === 0) return false;
  const hay = `${s.title} ${s.track ?? ''} ${s.summary}`.toLowerCase();
  return avoid.some((t) => hay.includes(t));
}

/**
 * Cheap retrieval so the model sees a short list of relevant real sessions
 * instead of 600. Only talks that haven't started yet (venue time).
 */
export function candidateSessions(
  all: ConferenceSession[],
  profile: InterestProfile,
  extraText: string,
  nowLocal: string,
  limit = 15,
): ConferenceSession[] {
  const terms = keywords([...profile.topics, extraText].join(' '));
  const avoid = keywords(profile.avoid.join(' '));
  const scored: Array<{ s: ConferenceSession; score: number }> = [];
  for (const s of all) {
    if (!isTalk(s)) continue;
    if (s.startsAt <= nowLocal) continue;
    if (profile.day && !s.startsAt.startsWith(profile.day)) continue;
    if (avoided(s, avoid)) continue;
    const score = relevance(s, terms, profile);
    if (score > 0 || terms.length === 0) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score || a.s.startsAt.localeCompare(b.s.startsAt));
  return scored.slice(0, limit).map((x) => x.s);
}

const minutes = (local: string) => {
  const [h = '0', m = '0'] = local.slice(11, 16).split(':');
  return Number(h) * 60 + Number(m);
};

/**
 * Minimum free time between two consecutive sessions, so a blind or
 * low-vision attendee isn't asked to teleport: same room 0, same building 10,
 * different building 20 minutes.
 */
export function transitionMinutes(a: ConferenceSession, b: ConferenceSession): number {
  if (a.room === b.room) return 0;
  return a.building === b.building ? 10 : 20;
}

/** Talks worth walking to between matches: a real session length, not an expo activity. */
export function isFillerEligible(s: ConferenceSession): boolean {
  if (!isTalk(s) || (s.track && NOT_FILLER_TRACKS.has(s.track))) return false;
  const length = minutes(s.endsAt) - minutes(s.startsAt);
  return length >= FILLER_MIN_MINUTES && length <= FILLER_MAX_MINUTES;
}

function fits(plan: ConferenceSession[], s: ConferenceSession): boolean {
  for (const p of plan) {
    const [first, second] = p.startsAt <= s.startsAt ? [p, s] : [s, p];
    if (minutes(second.startsAt) - minutes(first.endsAt) < transitionMinutes(first, second)) return false;
  }
  return true;
}

/** Which day to plan: the asked day, else the first match's day, else today if talks remain, else the next day. */
export function chooseDay(
  all: ConferenceSession[],
  profile: InterestProfile,
  matches: ConferenceSession[],
  nowLocal: string,
): string | null {
  if (profile.day) return profile.day;
  if (matches.length) return [...matches].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]!.startsAt.slice(0, 10);
  const next = all.find((s) => isTalk(s) && s.startsAt > nowLocal);
  return next ? next.startsAt.slice(0, 10) : null;
}

/**
 * Build a full day: keep the model's direct matches, then fill open time
 * with the most related remaining talks (falling back to unrelated ones) so
 * the attendee has a workable schedule. Only real sessions; never overlapping;
 * leaves walking time between rooms.
 */
export function fillDay(opts: {
  all: ConferenceSession[];
  matches: ConferenceSession[];
  profile: InterestProfile;
  nowLocal: string;
  exclude?: Set<string>;
  extraText?: string;
  maxTotal?: number;
}): { day: string | null; items: Array<{ session: ConferenceSession; fit: 'match' | 'related' | 'filler' }> } {
  const { all, profile, nowLocal } = opts;
  const exclude = opts.exclude ?? new Set<string>();
  const maxTotal = opts.maxTotal ?? 6;
  const day = chooseDay(all, profile, opts.matches, nowLocal);
  if (!day) return { day: null, items: [] };

  const plan: ConferenceSession[] = [];
  const fit = new Map<string, 'match' | 'related' | 'filler'>();
  for (const m of [...opts.matches].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    if (exclude.has(m.id) || !m.startsAt.startsWith(day) || m.startsAt <= nowLocal) continue;
    if (fits(plan, m) && plan.length < maxTotal) {
      plan.push(m);
      fit.set(m.id, 'match');
    }
  }

  const terms = keywords([...profile.topics, opts.extraText ?? ''].join(' '));
  const avoid = keywords(profile.avoid.join(' '));
  const boost = new Set(plan.map((s) => s.track).filter((t): t is string => !!t));
  const pool = all
    .filter((s) => isFillerEligible(s) && s.startsAt.startsWith(day) && s.startsAt > nowLocal && !exclude.has(s.id) && !fit.has(s.id))
    .filter((s) => !avoided(s, avoid))
    .map((s) => ({ s, score: relevance(s, terms, profile, boost) }))
    .sort((a, b) => b.score - a.score || a.s.startsAt.localeCompare(b.s.startsAt));

  for (const { s, score } of pool) {
    if (plan.length >= maxTotal) break;
    if (!fits(plan, s)) continue;
    plan.push(s);
    fit.set(s.id, score > 0 ? 'related' : 'filler');
  }

  plan.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { day, items: plan.map((session) => ({ session, fit: fit.get(session.id)! })) };
}

/** Keep the chosen sessions in time order, dropping any that overlap an earlier pick. */
export function nonOverlapping(picked: ConferenceSession[]): ConferenceSession[] {
  const sorted = [...picked].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const out: ConferenceSession[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (!last || s.startsAt >= last.endsAt) out.push(s);
  }
  return out;
}

function roomParts(room: string) {
  const [building = room, level, ...rest] = room.split('|').map((p) => p.trim());
  return { building, level: level ?? null, area: rest.join(', ') || null };
}

/**
 * Coarse, honest route steps. We have no machine-readable venue map, so we
 * describe destination and building changes only, and ask the user to
 * confirm with signage or staff. No turn-by-turn directions are invented.
 */
export function routeSteps(from: ConferenceSession | null, to: ConferenceSession): RouteStep[] {
  const dest = roomParts(to.room);
  const steps: RouteStep[] = [];
  if (from && roomParts(from.room).building !== dest.building) {
    steps.push({
      instruction: `Change buildings: from ${roomParts(from.room).building} to ${dest.building}. Allow extra time and ask venue staff for the accessible route.`,
      confirmLandmark: `${dest.building} entrance`,
    });
  }
  if (dest.level) {
    steps.push({
      instruction: `Go to ${dest.level} of ${dest.building}. Use an elevator if you prefer; ask staff or an info desk to point you there.`,
      confirmLandmark: dest.level,
    });
  }
  steps.push({
    instruction: `Find ${dest.area ?? to.room}. Confirm the room sign or ask a room monitor before going in.`,
    confirmLandmark: dest.area ?? to.room,
  });
  return steps;
}

// ---- Live catalog with caching ----

export interface ScheduleCatalog {
  get(): Promise<{ sessions: ConferenceSession[]; fetchedAt: number } | null>;
}

export function createScheduleCatalog(opts: { url?: string; ttlMs?: number; fetchImpl?: typeof fetch } = {}): ScheduleCatalog {
  const url = opts.url ?? SESSIONIZE_URL;
  const ttl = opts.ttlMs ?? 15 * 60_000;
  const doFetch = opts.fetchImpl ?? fetch;
  let cache: { sessions: ConferenceSession[]; fetchedAt: number } | null = null;
  let inflight: Promise<void> | null = null;

  async function refresh() {
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`schedule HTTP ${res.status}`);
      const sessions = normalizeSchedule((await res.json()) as SessionizeAll);
      if (sessions.length > 0) cache = { sessions, fetchedAt: Date.now() };
    } catch (e) {
      // Keep serving the previous copy if we have one.
      console.warn(`schedule refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    async get() {
      const stale = !cache || Date.now() - cache.fetchedAt > ttl;
      if (stale) {
        inflight ??= refresh().finally(() => {
          inflight = null;
        });
        // Only block when we have nothing to serve yet.
        if (!cache) await inflight;
      }
      return cache;
    },
  };
}
