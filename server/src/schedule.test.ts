import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_PROFILE } from './interview.ts';
import { candidateSessions, fillDay, nonOverlapping, normalizeSchedule, routeSteps, transitionMinutes, venueNow } from './schedule.ts';
import type { ConferenceSession } from '../../shared/contracts.ts';

export const FIXTURE = {
  sessions: [
    {
      id: '1',
      title: 'eBPF Deep Dive',
      description: '<p>All about <b>eBPF</b> networking.</p>',
      startsAt: '2026-11-10T11:00:00',
      endsAt: '2026-11-10T11:30:00',
      speakers: ['s1'],
      categoryItems: [10, 20],
      roomId: 100,
      status: 'Accepted',
    },
    {
      id: '2',
      title: 'Observability for Beginners',
      description: 'OpenTelemetry basics',
      startsAt: '2026-11-10T11:15:00',
      endsAt: '2026-11-10T11:45:00',
      speakers: [],
      categoryItems: [11],
      roomId: 101,
      status: 'Accepted',
    },
    {
      id: '3',
      title: 'Lunch',
      startsAt: '2026-11-10T12:00:00',
      endsAt: '2026-11-10T13:00:00',
      categoryItems: [12],
      roomId: 100,
      status: 'Accepted',
    },
    {
      id: '4',
      title: 'Platform Engineering with eBPF',
      description: 'platforms',
      startsAt: '2026-11-10T14:00:00',
      endsAt: '2026-11-10T14:30:00',
      categoryItems: [13],
      roomId: 101,
      status: 'Accepted',
    },
    { id: '5', title: 'No time', startsAt: null, endsAt: null, roomId: 100 },
  ],
  speakers: [{ id: 's1', fullName: 'Ada Example' }],
  categories: [
    {
      title: 'All Sessions',
      items: [
        { id: 10, name: 'Networking' },
        { id: 11, name: 'Observability' },
        { id: 12, name: 'Breaks' },
        { id: 13, name: 'Platform Engineering' },
      ],
    },
    { title: 'Audience Level', items: [{ id: 20, name: 'Advanced' }] },
  ],
  rooms: [
    { id: 100, name: 'Salt Palace | Level 1 | Hall DE' },
    { id: 101, name: 'Hyatt Regency | Level 4 | Regency Ballroom B' },
  ],
};

test('normalizes Sessionize data with source links and plain-text summaries', () => {
  const all = normalizeSchedule(FIXTURE);
  assert.equal(all.length, 4); // session without times dropped
  const s = all.find((x) => x.id === '1')!;
  assert.equal(s.summary, 'All about eBPF networking.');
  assert.equal(s.track, 'Networking');
  assert.equal(s.level, 'Advanced');
  assert.equal(s.building, 'Salt Palace');
  assert.deepEqual(s.speakers, ['Ada Example']);
  assert.match(s.sourceUrl, /program\/schedule\/\?id=1$/);
});

test('candidates: only future talks, matching interests, excluding breaks and avoided topics', () => {
  const all = normalizeSchedule(FIXTURE);
  const now = '2026-11-10T11:10:00';
  const c = candidateSessions(all, { ...EMPTY_PROFILE, topics: ['ebpf'] }, '', now);
  assert.deepEqual(
    c.map((s) => s.id),
    ['4'],
  ); // '1' already started, '3' is a break
  const avoid = candidateSessions(all, { ...EMPTY_PROFILE, topics: ['ebpf'], avoid: ['platforms'] }, '', '2026-11-10T08:00:00');
  assert.deepEqual(
    avoid.map((s) => s.id),
    ['1'],
  );
});

test('nonOverlapping keeps the earlier of overlapping sessions', () => {
  const all = normalizeSchedule(FIXTURE);
  assert.deepEqual(
    nonOverlapping(all.filter((s) => ['1', '2', '4'].includes(s.id))).map((s) => s.id),
    ['1', '4'],
  );
});

test('route steps flag building changes and ask for confirmation, no invented turns', () => {
  const all = normalizeSchedule(FIXTURE);
  const steps = routeSteps(all.find((s) => s.id === '1')!, all.find((s) => s.id === '4')!);
  assert.match(steps[0]!.instruction, /Change buildings: from Salt Palace to Hyatt Regency/);
  assert.match(steps.at(-1)!.instruction, /Confirm the room sign/);
  assert.ok(steps.every((s) => !/turn (left|right)/i.test(s.instruction)));
});

test('venueNow is Salt Lake City local time', () => {
  assert.equal(venueNow(new Date('2026-11-10T18:30:00Z')), '2026-11-10T11:30:00');
});

const extra = (id: string, title: string, start: string, end: string, room: string): ConferenceSession => ({
  id,
  title,
  startsAt: `2026-11-10T${start}:00`,
  endsAt: `2026-11-10T${end}:00`,
  timeZone: 'America/Denver',
  room,
  building: room.split('|')[0]!.trim(),
  track: 'Other',
  level: null,
  speakers: [],
  summary: '',
  sourceUrl: 'https://example.invalid',
});

test('fillDay keeps matches, fills open time with related then unrelated talks, never overlapping', () => {
  const all = [
    ...normalizeSchedule(FIXTURE),
    // Too close after match 1 (ends 11:30, Salt Palace) for a building change.
    extra('5', 'Cooking with YAML', '11:40', '12:10', 'Hyatt Regency | Level 4 | Room 1'),
    // Unrelated but fits later in the day.
    extra('6', 'Cooking with YAML', '15:00', '15:30', 'Hyatt Regency | Level 4 | Room 1'),
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const one = all.find((s) => s.id === '1')!;
  const r = fillDay({ all, matches: [one], profile: { ...EMPTY_PROFILE, topics: ['ebpf'] }, nowLocal: '2026-11-10T08:00:00' });
  assert.equal(r.day, '2026-11-10');
  assert.deepEqual(
    r.items.map((i) => [i.session.id, i.fit]),
    [
      ['1', 'match'],
      ['4', 'related'],
      ['6', 'filler'],
    ],
  );
});

test('fillDay honours exclusions and the size cap, and skips sessions already started', () => {
  const all = normalizeSchedule(FIXTURE);
  const r = fillDay({
    all,
    matches: [],
    profile: { ...EMPTY_PROFILE, topics: ['ebpf'] },
    nowLocal: '2026-11-10T08:00:00',
    exclude: new Set(['1']),
    maxTotal: 1,
  });
  assert.deepEqual(
    r.items.map((i) => i.session.id),
    ['4'],
  );
  const late = fillDay({ all, matches: [], profile: { ...EMPTY_PROFILE, topics: ['ebpf'] }, nowLocal: '2026-11-10T13:00:00' });
  assert.ok(late.items.every((i) => i.session.startsAt > '2026-11-10T13:00:00'));
});

test('transition time grows with distance between rooms', () => {
  const a = extra('a', 'x', '10:00', '10:30', 'Salt Palace | Level 1 | A');
  assert.equal(transitionMinutes(a, a), 0);
  assert.equal(transitionMinutes(a, extra('b', 'x', '11:00', '11:30', 'Salt Palace | Level 2 | B')), 10);
  assert.equal(transitionMinutes(a, extra('c', 'x', '11:00', '11:30', 'Hyatt Regency | Level 4 | C')), 20);
});
