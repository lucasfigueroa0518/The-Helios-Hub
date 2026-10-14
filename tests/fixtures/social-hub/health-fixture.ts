import type { Readiness } from '@/lib/social-hub/health/readiness';
import { emptyReport } from '@/lib/social-hub/health/reporters/shared';
import { nightsEnding } from '@/lib/social-hub/health/time';
import type { FailureEvent, NightReport, StoredReport } from '@/lib/social-hub/health/types';
import { nightVerdict } from '@/lib/social-hub/health/verdict';
import type { Vertical } from '@/lib/social-hub/types';

import { FIXTURE_NOW } from './preview-dataset';

const LAST = '2026-10-08';
const QUOTA: Record<Vertical, number> = { reels: 3, explainers: 2, carousels: 1, stories: 1 };

function report(v: Vertical, night: string): NightReport {
  const q = QUOTA[v];
  const r: NightReport = { ...emptyReport(v, night), due: true, ran: true, target: q, made: q, needed: q, ready: q, scheduledYesterday: q, postedYesterday: q, spendUsd: q * 0.9 };
  const fail = (over: Partial<FailureEvent>): FailureEvent => ({ vertical: v, night, at: `${night}T07:14:00Z`, stage: 'run', reason: 'other', severity: 'failed', ...over });
  if (v === 'carousels' && ['2026-09-28', '2026-10-03', LAST].includes(night)) {
    r.made = 0; r.ready = 0;
    r.funnel = [{ stage: 'jev-scoring', in: 30, out: 12 }, { stage: 'writer', in: 2, out: 0 }];
    r.failures = [fail({ stage: 'writer', reason: 'too_long', rawError: 'slide 3 over 40 words', item: { kind: 'story', id: 'st-1', label: "OpenAI's new model" } })];
  }
  if (v === 'explainers' && night === LAST) {
    r.retriedOk = 1;
    r.failures = [fail({ stage: 'publish', reason: 'service_5xx', severity: 'healed', rawError: 'Meta returned 500' })];
  }
  if (v === 'stories' && night === LAST) r.feedsStale = ['TechCrunch AI'];
  if (v === 'reels' && night === '2026-10-01') r.retriedOk = 1;
  return r;
}

export function previewHealth(): { stored: StoredReport[]; live: null; readiness: Readiness[]; now: Date } {
  const stored = nightsEnding(LAST, 30).map((night): StoredReport => {
    const reports = (['reels', 'explainers', 'carousels', 'stories'] as Vertical[]).map((v) => report(v, night));
    return { night, builtAt: `${night}T11:30:00Z`, verdict: nightVerdict(night, reports, 'worked'), reports, failures: reports.flatMap((r) => r.failures) };
  });
  const readiness: Readiness[] = [
    { vertical: 'reels', approved: 46, rejected: 2, rate: 46 / 48 },
    { vertical: 'explainers', approved: 22, rejected: 8, rate: 22 / 30 },
    { vertical: 'carousels', approved: 27, rejected: 6, rate: 27 / 33 },
    { vertical: 'stories', approved: 20, rejected: 2, rate: 20 / 22 },
  ];
  return { stored, live: null, readiness, now: FIXTURE_NOW };
}
