import Link from 'next/link';

import { CHIPS_PER_DAY, chipLabel, postTime, statusLabel } from '@/lib/social-hub/calendar';
import { withParams, type HubParams } from '@/lib/social-hub/links';
import { timeLabel, WEEKDAY_SHORT } from '@/lib/social-hub/time';
import type { HubPost } from '@/lib/social-hub/types';

import { colorStyle, VerticalDot } from './marks';

type Props = {
  weeks: Array<Array<{ day: string; inMonth: boolean }>>;
  byDay: Map<string, HubPost[]>;
  base: string;
  params: HubParams;
  today: string;
};

/**
 * Month view (spec §4): chips per day (color = vertical, time ET, short
 * name), "+N more", outlined when scheduled, struck through when cancelled,
 * a mark when failed. On a phone it becomes dots per day; the day number
 * covers the cell and opens the day view.
 */
export function CalendarMonth({ weeks, byDay, base, params, today }: Props) {
  return (
    <div className="sh-month" role="table" aria-label="Posts by day">
      <div className="sh-month__head" role="row">
        {WEEKDAY_SHORT.map((d) => (
          <div key={d} role="columnheader" className="sh-month__dow">{d}</div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]!.day} className="sh-month__week" role="row">
          {week.map(({ day, inMonth }) => {
            const posts = byDay.get(day) ?? [];
            const shown = posts.slice(0, CHIPS_PER_DAY);
            const more = posts.length - shown.length;
            const dayHref = withParams(base, '', params, { day, post: null });
            const label = `${new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}, ${posts.length} post${posts.length === 1 ? '' : 's'}`;
            return (
              <div
                key={day}
                role="cell"
                className={`sh-day${inMonth ? '' : ' sh-day--out'}${day === today ? ' sh-day--today' : ''}${posts.length ? ' sh-day--busy' : ''}`}
              >
                <Link href={dayHref} className="sh-day__num" aria-label={label}>
                  {Number(day.slice(8))}
                </Link>
                <ul className="sh-day__chips">
                  {shown.map((post) => (
                    <li key={post.id}>
                      <Link
                        href={withParams(base, '', params, { post: post.id })}
                        scroll={false}
                        className={`sh-chip sh-chip--${post.status}`}
                        style={colorStyle(post.vertical)}
                        title={`${post.name} · ${statusLabel(post)}`}
                      >
                        {post.status === 'failed' ? <span className="sh-chip__fail" aria-hidden="true">!</span> : null}
                        <span className="sh-chip__time">{timeLabel(postTime(post)).replace(':00', '').replace(' ', '').toLowerCase()}</span>
                        <span className="sh-chip__name">{chipLabel(post)}</span>
                        <span className="sh-sr">, {statusLabel(post)}</span>
                      </Link>
                    </li>
                  ))}
                  {more > 0 ? (
                    <li>
                      <Link href={dayHref} className="sh-chip-more">+{more} more</Link>
                    </li>
                  ) : null}
                </ul>
                <span className="sh-day__dots" aria-hidden="true">
                  {posts.slice(0, 6).map((post) => (
                    <VerticalDot key={post.id} vertical={post.vertical} />
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
