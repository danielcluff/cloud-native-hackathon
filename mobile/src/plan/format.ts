import type { ConferenceSession } from '../../../shared/contracts';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "2026-11-10T14:05:00" (venue-local, no offset) -> "Tuesday 2:05 PM". Timezone-independent. */
export function formatLocal(isoLocal: string, withDay = true): string {
  const [date = '', time = ''] = isoLocal.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh = 0, mm = 0] = time.split(':').map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const clock = `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${hh < 12 ? 'AM' : 'PM'}`;
  if (!withDay || !y || !m || !d) return clock;
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${clock}`;
}

export function describeSession(s: ConferenceSession): string {
  return `${formatLocal(s.startsAt)} to ${formatLocal(s.endsAt, false)}. ${s.title}. ${s.room.replace(/\s*\|\s*/g, ', ')}.`;
}
