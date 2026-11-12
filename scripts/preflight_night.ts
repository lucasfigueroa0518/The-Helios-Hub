/**
 * Pre-flight for the coming overnight run. Read-only: SELECTs only, no model, search or Meta calls (CLAUDE.md Rule 1),
 * no writes. Compares what the calendar expects on the target date with what each type's switches and queues allow.
 *
 *   npx tsx scripts/preflight_night.ts              the next night (tomorrow's date after noon, today's before)
 *   npx tsx scripts/preflight_night.ts 2026-11-13   a given New York date
 *
 * Exits 1 when any check fails, so it can sit in front of a deploy or a cron. The decisions live in
 * lib/preflight/night.ts (tested offline).
 */
import './stories_env';
import { dbQuery } from '@/lib/db';
import { pendingDraftCount } from '@/lib/field-notes/store';
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import { addCalendarDays } from '@/lib/instagram/window';
import { hasFailure, judge, type PreflightInput } from '@/lib/preflight/night';
import { liveHubQuery } from '@/lib/social-hub/db';
import { slotPlan } from '@/lib/social-hub/slots';
import type { Vertical } from '@/lib/social-hub/types';

const SETTINGS: Array<{ vertical: Vertical; schema: string; auto: string | null }> = [
  { vertical: 'stories', schema: 'stories', auto: null },
  { vertical: 'reels', schema: 'reels', auto: null },
  { vertical: 'carousels', schema: 'social', auto: 'auto_run' },
  { vertical: 'last_few_days', schema: 'lfd', auto: 'auto_run' },
  { vertical: 'ai_events', schema: 'ai_events', auto: 'auto_run' },
  { vertical: 'field_notes', schema: 'field_notes', auto: 'auto_run' },
  { vertical: 'explainers', schema: 'explainers', auto: 'auto_render' },
  { vertical: 'reel_ai_drama', schema: 'reel_ai_drama', auto: 'auto' },
];

const truthy = (v: unknown) => v === true || v === 'true';
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

async function settings(schema: string): Promise<Map<string, unknown>> {
  const { rows } = await dbQuery(`SELECT key, value FROM ${schema}.settings`);
  return new Map((rows as Array<{ key: string; value: unknown }>).map((r) => [r.key, r.value]));
}

async function main() {
  const now = new Date();
  const today = calendarDateKey(now, SOCIAL_TIMEZONE);
  const nyHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: SOCIAL_TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const date = process.argv[2] ?? (nyHour >= 12 ? addCalendarDays(today, 1) : today);

  const plan = await slotPlan(liveHubQuery, date, 1);
  const slots = plan ? (plan.byDate.get(date) ?? []).map((s) => ({ vertical: s.vertical, series: s.series ?? null })) : [];

  const autoOn: PreflightInput['autoOn'] = {};
  const publishingLive: PreflightInput['publishingLive'] = {};
  let storiesSeriesAuto: Record<string, boolean> = {};
  let fieldNotesMax = 3;
  let explainers = { perReelCapUsd: 0, dailySpendCapUsd: 0 };
  for (const t of SETTINGS) {
    const s = await settings(t.schema).catch(() => new Map<string, unknown>());
    if (t.auto) autoOn[t.vertical] = truthy(s.get(t.auto));
    if (s.has('publishing_live')) publishingLive[t.vertical] = truthy(s.get('publishing_live'));
    if (t.vertical === 'stories') {
      const series = (s.get('series') ?? {}) as Record<string, { auto?: boolean; enabled?: boolean }>;
      storiesSeriesAuto = Object.fromEntries(Object.entries(series).map(([id, v]) => [id, Boolean(v.auto && v.enabled)]));
    }
    if (t.vertical === 'field_notes') fieldNotesMax = num(s.get('max_pending_drafts'), 3);
    if (t.vertical === 'explainers') explainers = { perReelCapUsd: num(s.get('per_reel_cap_usd'), 0), dailySpendCapUsd: num(s.get('daily_spend_cap_usd'), 0) };
  }

  const fieldNotesPending = await pendingDraftCount(liveHubQuery).catch(() => 0);
  const unapproved = await dbQuery(`SELECT count(*)::int AS n FROM stories.sets WHERE status = 'ready' AND created_at > now() - interval '3 days'`);
  const latest = await dbQuery(`SELECT failures FROM social_hub.health_reports ORDER BY night DESC LIMIT 1`);
  const failures = ((latest.rows[0] as { failures?: Array<{ severity?: string; reason?: string }> } | undefined)?.failures ?? []);

  const findings = judge({
    date,
    slots,
    autoOn,
    storiesSeriesAuto,
    publishingLive,
    fieldNotesPending,
    fieldNotesMaxPending: fieldNotesMax,
    storiesReadyUnapproved: (unapproved.rows[0] as { n: number }).n,
    recentFailureReasons: failures.filter((f) => f.severity === 'failed').map((f) => String(f.reason)),
    explainers,
  });

  const mark = { ok: 'OK    ', warn: 'WARN  ', fail: 'FAIL  ', manual: 'CHECK ' } as const;
  console.log(`Pre-flight for the night making ${date} (calendar: ${plan ? 'template' : 'legacy'})\n`);
  for (const f of findings) console.log(`${mark[f.level]} ${f.text}`);
  const bad = hasFailure(findings);
  console.log(`\n${bad ? 'NOT READY: fix the FAIL lines.' : 'No failures found. The CHECK lines are yours to confirm.'}`);
  process.exit(bad ? 1 : 0);
}

void main();
