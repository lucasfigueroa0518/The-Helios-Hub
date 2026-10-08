import Link from 'next/link';

import { CalendarDay } from '@/components/social-hub/CalendarDay';
import { CalendarMonth } from '@/components/social-hub/CalendarMonth';
import { DataNotes } from '@/components/social-hub/DataNotes';
import { PageHead } from '@/components/social-hub/PageHead';
import { PostDrawer } from '@/components/social-hub/PostDrawer';
import { PostView } from '@/components/social-hub/PostView';
import { VerticalLegend } from '@/components/social-hub/marks';
import { postsByDay } from '@/lib/social-hub/calendar';
import { SOCIAL_HUB_FLAGS } from '@/lib/social-hub/flags';
import { findPost, type HubDataset } from '@/lib/social-hub/dataset';
import { postHref } from '@/lib/social-hub/ids';
import { withParams, type HubParams } from '@/lib/social-hub/links';
import { addDays, dayLabel, isDayKey, monthGrid, monthLabel, monthOf, nyDateOf, shiftMonth } from '@/lib/social-hub/time';

/** Calendar (spec §4): month by default, day view with ?day=, post drawer with ?post=. Read-only (SH-13). */
export function CalendarScreen({ dataset, base, params, now }: { dataset: HubDataset; base: string; params: HubParams; now: Date }) {
  const today = nyDateOf(now)!;
  const day = isDayKey(params.day) ? params.day : null;
  const month = day ? day.slice(0, 7) : monthOf(params.month, now);
  const byDay = postsByDay(dataset.posts);
  const keep: HubParams = { month: params.month, day: params.day ?? undefined };
  const open = params.post ? findPost(dataset, params.post) : null;

  const nav = day ? (
    <nav className="sh-seg" aria-label="Day">
      <Link href={withParams(base, '', {}, { month: day.slice(0, 7) })}>Month</Link>
      <Link href={withParams(base, '', {}, { day: addDays(day, -1) })} aria-label="Previous day">‹</Link>
      <Link href={withParams(base, '', {}, { day: today })} aria-current={day === today ? 'page' : undefined}>Today</Link>
      <Link href={withParams(base, '', {}, { day: addDays(day, 1) })} aria-label="Next day">›</Link>
    </nav>
  ) : (
    <nav className="sh-seg" aria-label="Month">
      <Link href={withParams(base, '', {}, { month: shiftMonth(month, -1) })} aria-label="Previous month">‹</Link>
      <Link href={withParams(base, '', {}, { month: today.slice(0, 7) })} aria-current={month === today.slice(0, 7) ? 'page' : undefined}>This month</Link>
      <Link href={withParams(base, '', {}, { month: shiftMonth(month, 1) })} aria-label="Next month">›</Link>
    </nav>
  );

  return (
    <>
      <PageHead
        kicker="Social Hub · Calendar"
        title={day ? dayLabel(day) : monthLabel(month)}
        sub="Published, scheduled and cancelled posts across every pipeline. Times are New York."
        actions={nav}
      />
      <VerticalLegend />
      <DataNotes dataset={dataset} />
      {day ? (
        <CalendarDay posts={byDay.get(day) ?? []} base={base} params={keep} />
      ) : (
        <>
          {[...byDay.keys()].some((d) => d.startsWith(month)) ? null : (
            <p className="sh-note">No posts this month yet. Scheduled posts appear here as soon as a pipeline books a slot.</p>
          )}
            <CalendarMonth weeks={monthGrid(month)} byDay={byDay} base={base} params={keep} today={today} />
        </>
      )}
      {params.post && !open ? <p className="sh-note">That post isn&apos;t in the hub any more.</p> : null}
      {open ? (
        <PostDrawer closeHref={withParams(base, '', keep, {})} fullHref={SOCIAL_HUB_FLAGS.views.post ? postHref(base, open.id) : null} title={open.name}>
          <PostView post={open} />
        </PostDrawer>
      ) : null}
    </>
  );
}
