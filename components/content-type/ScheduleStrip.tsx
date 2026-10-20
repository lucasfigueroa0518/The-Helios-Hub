import Link from 'next/link';

import type { ScheduleDay } from '@/lib/content-type/posting';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SERIES_SHORT: Record<string, string> = { morning_download: 'Morning Dl', guess_the_number: 'Guess #', free_vs_paid: 'Free/Paid' };

/** This week's slots for one type, read only; the calendar owns when (spec §4). */
export function ScheduleStrip({ type, days }: { type: string; days: readonly ScheduleDay[] }) {
  const reel = type === 'reels' || type === 'explainers';
  return (
    <div className="rh-schedule">
      <p className="rh-settings__note">When this type posts is set on the calendar.</p>
      <ol className="rh-schedule__days">
        {days.map((d) => {
          const weekday = DAY[new Date(`${d.nyDate}T12:00:00Z`).getUTCDay()];
          return (
            <li key={d.nyDate} className={`rh-schedule__day${d.override ? ' rh-schedule__day--override' : ''}`} aria-label={`${weekday}: ${d.count} slot${d.count === 1 ? '' : 's'}${d.override ? ', changed for this date' : ''}`}>
              <span className="rh-schedule__weekday">{weekday}</span>
              <strong>{type === 'stories' ? (d.series.map((s) => SERIES_SHORT[s] ?? s).join(', ') || '—') : d.count}</strong>
              {reel && d.count ? <span className="rh-schedule__mode">{d.trial ? `${d.trial} trial` : ''}{d.trial && d.main ? ' · ' : ''}{d.main ? `${d.main} main` : ''}</span> : null}
            </li>
          );
        })}
      </ol>
      <Link className="rh-btn rh-btn--xs" href={`/social/calendar?view=week&type=${type}`}>Edit in Calendar →</Link>
    </div>
  );
}
