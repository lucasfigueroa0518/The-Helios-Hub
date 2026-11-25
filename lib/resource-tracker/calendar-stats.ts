import type { NetworkingQuery } from '@/lib/networking/repository';
import type { CalendarStats, TrackerRange } from '@/lib/resource-tracker/types';
import { addDays, CALENDAR_PATH, eachDate, nyDate, pageVisitorsByDay } from '@/lib/resource-tracker/views';

const RANGE_DAYS: Record<Exclude<TrackerRange, 'all'>, number> = { '14d': 14, '30d': 30, '90d': 90 };

/** RSVP click-throughs from the public calendar (RT-2), by New York day, event and city. Bot hits are never counted. */
export async function calendarStats(q: NetworkingQuery, range: TrackerRange, now: Date, opts: { views?: boolean } = {}): Promise<CalendarStats> {
  const to = nyDate(now);
  const { rows: sinceRows } = await q<{ since: string | null }>(
    `SELECT to_char(min(clicked_at) AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS since FROM networking.rsvp_clicks WHERE NOT bot`,
  );
  const trackingSince = sinceRows[0]?.since ?? null;
  const from = range === 'all' ? (trackingSince && trackingSince < to ? trackingSince : addDays(to, -13)) : addDays(to, -(RANGE_DAYS[range] - 1));
  const window = [from, to];

  const [byDay, events, metros, bots] = await Promise.all([
    q<{ date: string; clicks: number }>(
      `SELECT to_char(clicked_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS date, count(*)::int AS clicks
         FROM networking.rsvp_clicks
        WHERE NOT bot AND (clicked_at AT TIME ZONE 'America/New_York')::date BETWEEN $1::date AND $2::date
        GROUP BY 1`,
      window,
    ),
    q<{ id: string; title: string; metro: string; start: string; clicks: number }>(
      `SELECT c.public_id AS id, coalesce(l.title, 'Unknown event') AS title, coalesce(l.metro, '') AS metro,
              coalesce(to_char(l.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '') AS start, count(*)::int AS clicks
         FROM networking.rsvp_clicks c LEFT JOIN networking.rsvp_links l USING (public_id)
        WHERE NOT c.bot AND (c.clicked_at AT TIME ZONE 'America/New_York')::date BETWEEN $1::date AND $2::date
        GROUP BY 1, 2, 3, 4 ORDER BY clicks DESC, title LIMIT 10`,
      window,
    ),
    q<{ metro: string; clicks: number }>(
      `SELECT coalesce(l.metro, 'unknown') AS metro, count(*)::int AS clicks
         FROM networking.rsvp_clicks c LEFT JOIN networking.rsvp_links l USING (public_id)
        WHERE NOT c.bot AND (c.clicked_at AT TIME ZONE 'America/New_York')::date BETWEEN $1::date AND $2::date
        GROUP BY 1 ORDER BY clicks DESC`,
      window,
    ),
    q<{ n: number; events: number }>(
      `SELECT count(*) FILTER (WHERE bot)::int AS n, count(DISTINCT public_id) FILTER (WHERE NOT bot)::int AS events
         FROM networking.rsvp_clicks WHERE (clicked_at AT TIME ZONE 'America/New_York')::date BETWEEN $1::date AND $2::date`,
      window,
    ),
  ]);

  const views = opts.views === false ? { byDay: null, note: null } : await pageVisitorsByDay(CALENDAR_PATH, { from, to });
  const clicks = new Map(byDay.rows.map((r) => [r.date, Number(r.clicks)]));
  const days = eachDate(from, to).map((date) => ({ date, clicks: clicks.get(date) ?? 0, visitors: views.byDay ? views.byDay[date] ?? 0 : null }));
  const totalClicks = days.reduce((n, d) => n + d.clicks, 0);
  return {
    range,
    from,
    to,
    trackingSince,
    totals: {
      clicks: totalClicks,
      visitors: views.byDay ? days.reduce((n, d) => n + (d.visitors ?? 0), 0) : null,
      eventsClicked: Number(bots.rows[0]?.events ?? 0),
      botHits: Number(bots.rows[0]?.n ?? 0),
    },
    days,
    topEvents: events.rows.map((r) => ({ ...r, clicks: Number(r.clicks) })),
    metros: metros.rows.map((r) => ({ metro: r.metro, clicks: Number(r.clicks) })),
    viewsNote: views.note,
  };
}
