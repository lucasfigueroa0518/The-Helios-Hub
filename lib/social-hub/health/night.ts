import type { PostingState } from '@/lib/content-type/posting';
import { HEARTBEAT_STALE_MS } from '@/lib/publishing/publisher';
import type { HubQuery } from '@/lib/social-hub/db';
import { reportCarousels } from '@/lib/social-hub/health/reporters/carousels';
import { reportLastFewDays } from '@/lib/social-hub/health/reporters/last-few-days';
import { makeExplainersReporter } from '@/lib/social-hub/health/reporters/explainers';
import { reportReels } from '@/lib/social-hub/health/reporters/reels';
import { emptyReport, type Reporter } from '@/lib/social-hub/health/reporters/shared';
import { reportStories } from '@/lib/social-hub/health/reporters/stories';
import type { NightReport, StoredReport, Tone } from '@/lib/social-hub/health/types';
import { nightVerdict } from '@/lib/social-hub/health/verdict';
import type { Vertical } from '@/lib/social-hub/types';
import { VERTICAL_IDS } from '@/lib/social-hub/verticals';

export type Handles = { q: HubQuery; explainersQ: () => Promise<HubQuery>; posting: (v: Vertical) => Promise<PostingState> };

/** A new content type is a compile error here until it has a reporter (spec §4.2). */
export const REPORTERS: Record<Vertical, (h: Handles) => Promise<{ q: HubQuery; run: Reporter }>> = {
  reels: async (h) => ({ q: h.q, run: reportReels }),
  carousels: async (h) => ({ q: h.q, run: reportCarousels }),
  stories: async (h) => ({ q: h.q, run: reportStories }),
  last_few_days: async (h) => ({ q: h.q, run: reportLastFewDays }),
  explainers: async (h) => ({ q: await h.explainersQ(), run: makeExplainersReporter(h.q) }),
};

export async function publisherTone(q: HubQuery, now: Date): Promise<Tone> {
  const { rows } = await q<{ value: { at?: string } }>(`SELECT value FROM social_hub.settings WHERE key = 'publisher_heartbeat'`);
  const at = rows[0]?.value?.at;
  if (!at) return 'none';
  return now.getTime() - Date.parse(at) > HEARTBEAT_STALE_MS ? 'failed' : 'worked';
}

/** Failures on a type that met its target were absorbed: they stay visible, as warnings. Publish failures keep their severity. */
function settle(r: NightReport): NightReport {
  if (r.made < r.target) return r;
  return { ...r, failures: r.failures.map((f) => (f.severity === 'failed' && f.stage !== 'publish' ? { ...f, severity: 'warning' as const } : f)) };
}

export async function buildNight(h: Handles, night: string, now: Date, publisher: Tone): Promise<StoredReport> {
  const reports = await Promise.all(
    VERTICAL_IDS.map(async (v) => {
      try {
        const posting = await h.posting(v);
        const { q, run } = await REPORTERS[v](h);
        return settle(await run(q, { night, posting, now }));
      } catch (error) {
        return { ...emptyReport(v, night), due: true, reportError: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  const failures = reports.flatMap((r) => r.failures);
  return { night, builtAt: now.toISOString(), verdict: nightVerdict(night, reports, publisher), reports, failures };
}
