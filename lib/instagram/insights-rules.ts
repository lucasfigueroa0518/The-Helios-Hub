import { calendarDateKey } from '@/lib/instagram/clock';

/**
 * Due/settle rules and Graph payload readers for Instagram insights, the same
 * rules as lib/reels/media-insights/{due,parse}.ts, shared by the content
 * types outside Trial Reels.
 */

/** Newer than this: asked again every 30 minutes. */
export const INSIGHTS_FRESH_MS = 2 * 86_400_000;
/** Through this age: one reading per New York day. The next reading after it is the last. */
export const INSIGHTS_WARM_MS = 14 * 86_400_000;
export const INSIGHTS_COOLDOWN_MS = 30 * 60_000;

export function insightIsDue(input: { finishedAt: Date; checkedAt: Date | null; now: Date }): boolean {
  const age = input.now.getTime() - input.finishedAt.getTime();
  if (age < 0) return false;
  if (!input.checkedAt) return true;
  const sinceCheck = input.now.getTime() - input.checkedAt.getTime();
  if (age <= INSIGHTS_FRESH_MS && sinceCheck >= INSIGHTS_COOLDOWN_MS) return true;
  if (age <= INSIGHTS_WARM_MS && calendarDateKey(input.checkedAt) < calendarDateKey(input.now)) return true;
  if (age > INSIGHTS_WARM_MS) return true;
  return false;
}

export function readMetricNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (value && typeof value === 'object' && 'value' in value) return readMetricNumber((value as { value: unknown }).value);
  return null;
}

export function readInsightData(body: unknown): Record<string, number | null> {
  const data = body && typeof body === 'object' && 'data' in body ? (body as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return {};
  const out: Record<string, number | null> = {};
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const name = (row as { name?: unknown }).name;
    if (typeof name !== 'string') continue;
    const values = (row as { values?: unknown }).values;
    const first = Array.isArray(values) ? values[0] : null;
    const number = readMetricNumber(first && typeof first === 'object' ? (first as { value?: unknown }).value : null);
    out[name] = name === 'reels_skip_rate' ? normalizeSkipRate(number) : number;
  }
  return out;
}

/** Meta documents a fraction of plays; a 0–100 payload is folded into that fraction. */
export function normalizeSkipRate(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return value;
  if (value <= 100) return value / 100;
  return null;
}

export function metricsNamedIn(message: string, requested: readonly string[]): string[] {
  return requested.filter((metric) => message.includes(metric));
}

export function graphErrorIsPermission(status: number, code: number | null, message: string): boolean {
  if (code === 10 || code === 200) return true;
  if (/instagram_manage_insights/i.test(message)) return true;
  return status === 403 && /permission|insight/i.test(message);
}

export function graphErrorIsToken(code: number | null, message: string): boolean {
  if (code === 190) return true;
  return /invalid oauth|session has expired|error validating access token/i.test(message);
}
