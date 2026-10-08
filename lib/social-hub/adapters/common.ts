import { nyDateOf } from '@/lib/social-hub/time';
import type { FactorValue, HubMetrics, HubStatus, MetricSnapshot } from '@/lib/social-hub/types';

export function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function iso(value: unknown): string | null {
  if (value == null || value === '') return null;
  const at = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** `media_insights` column → hub metric. Same columns in reels, explainers and social. */
const INSIGHT_COLUMNS: Array<[string, keyof HubMetrics]> = [
  ['views', 'views'],
  ['reach', 'reach'],
  ['likes', 'likes'],
  ['comments', 'comments'],
  ['saved', 'saved'],
  ['shares', 'shares'],
  ['reposts', 'reposts'],
  ['total_interactions', 'totalInteractions'],
  ['avg_watch_time_ms', 'avgWatchTimeMs'],
  ['total_watch_time_ms', 'totalWatchTimeMs'],
  ['skip_rate', 'skipRate'],
  ['follows', 'follows'],
  ['profile_visits', 'profileVisits'],
];

export function insightMetrics(row: Record<string, unknown>): HubMetrics {
  const out: HubMetrics = {};
  for (const [column, key] of INSIGHT_COLUMNS) {
    if (column in row) out[key] = num(row[column]);
  }
  return out;
}

/** Daily snapshots per media id, oldest first; the newest is the post's latest totals (SH-10). */
export function historyByMedia(rows: ReadonlyArray<Record<string, unknown>>): Map<string, MetricSnapshot[]> {
  const out = new Map<string, MetricSnapshot[]>();
  for (const row of rows) {
    const mediaId = String(row.media_id);
    const list = out.get(mediaId) ?? [];
    list.push({ nyDate: String(row.ny_date).slice(0, 10), metrics: insightMetrics(row) });
    out.set(mediaId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.nyDate.localeCompare(b.nyDate));
  return out;
}

export function latest(history: readonly MetricSnapshot[]): HubMetrics {
  return history.length ? history[history.length - 1]!.metrics : {};
}

/** publish_attempts.status → hub status. */
export function attemptStatus(status: string): HubStatus {
  if (status === 'published') return 'published';
  if (status === 'failed') return 'failed';
  return 'publishing';
}

/** posting_schedule.status → hub status (only rows with no attempt reach here). */
export function scheduleStatus(status: string): HubStatus {
  if (status === 'scheduled') return 'scheduled';
  if (status === 'publishing') return 'publishing';
  if (status === 'published') return 'published';
  if (status === 'failed') return 'failed';
  return 'cancelled';
}

export const CANCELLED_UNAPPROVED = 'Not approved before its slot';

/** A cancel reason in words: the overnight code writes the reason into `error`. */
export function cancelNote(error: string | null): string {
  const note = text(error);
  if (!note) return 'Cancelled';
  return /approv/i.test(note) ? CANCELLED_UNAPPROVED : note;
}

export function category(key: string | null | undefined, labels: Record<string, string>, empty = 'Unknown'): FactorValue {
  if (!key) return { kind: 'category', key: 'unknown', label: empty };
  return { kind: 'category', key, label: labels[key] ?? key };
}

export function yesNo(value: boolean | null | undefined, yes: [string, string], no: [string, string]): FactorValue {
  if (value == null) return { kind: 'category', key: 'unknown', label: 'Unknown' };
  return value ? { kind: 'category', key: yes[0], label: yes[1] } : { kind: 'category', key: no[0], label: no[1] };
}

export function nyDateFor(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const day = nyDateOf(candidate ?? null);
    if (day) return day;
  }
  return null;
}

export function firstLine(value: string | null | undefined): string | null {
  return value?.split('\n').map((part) => part.trim()).find(Boolean) ?? null;
}
