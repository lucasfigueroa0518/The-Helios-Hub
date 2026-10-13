import type { FailureEvent, Severity, Tone } from '@/lib/social-hub/health/types';
import { REASON_LABEL, stageLabel } from '@/lib/social-hub/health/reasons';
import { verticalInfo } from '@/lib/social-hub/verticals';
import type { Vertical } from '@/lib/social-hub/types';

export const FIXED_AFTER = 7;
export const BACK_AGAIN_GAP = 3;

export type Problem = {
  key: string;
  vertical: Vertical;
  stage: string;
  reason: string;
  title: string;
  nights: string[];
  count: number;
  firstSeen: string;
  lastSeen: string;
  quietNights: number;
  backAgain: boolean;
  /** current = broke something last night; healed / warning = last night but recovered or a heads-up; quiet = not last night. */
  tone: 'current' | 'healed' | 'warning' | 'quiet';
  state: 'open' | 'almost' | 'fixed';
  latest: FailureEvent;
  events: FailureEvent[];
};

const SEVERITY_TONE: Record<Severity, Problem['tone']> = { failed: 'current', healed: 'healed', warning: 'warning' };

/** `window` is ascending; its last night is "last night". */
export function groupProblems(failures: readonly FailureEvent[], window: readonly string[]): Problem[] {
  const today = window[window.length - 1]!;
  const index = new Map(window.map((n, i) => [n, i]));
  const groups = new Map<string, FailureEvent[]>();
  for (const f of failures) {
    if (!index.has(f.night)) continue;
    const key = `${f.vertical}|${f.stage}|${f.reason}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }
  const out: Problem[] = [];
  for (const [key, events] of groups) {
    events.sort((a, b) => a.at.localeCompare(b.at));
    const nights = [...new Set(events.map((e) => e.night))].sort();
    const lastSeen = nights[nights.length - 1]!;
    const quietNights = index.get(today)! - index.get(lastSeen)!;
    const prev = nights[nights.length - 2];
    const backAgain = prev !== undefined && index.get(lastSeen)! - index.get(prev)! - 1 >= BACK_AGAIN_GAP;
    const latest = events[events.length - 1]!;
    const lastNightEvents = events.filter((e) => e.night === today);
    const tone: Problem['tone'] = lastNightEvents.length
      ? lastNightEvents.some((e) => e.severity === 'failed') ? 'current' : SEVERITY_TONE[latest.severity]
      : 'quiet';
    const v = latest.vertical;
    out.push({
      key, vertical: v, stage: latest.stage, reason: latest.reason,
      title: `${verticalInfo(v).label} · ${stageLabel(latest.stage)} · ${REASON_LABEL[latest.reason] ?? latest.reason}`,
      nights, count: nights.length, firstSeen: nights[0]!, lastSeen, quietNights, backAgain, tone,
      state: quietNights >= FIXED_AFTER ? 'fixed' : quietNights === FIXED_AFTER - 1 ? 'almost' : 'open',
      latest, events,
    });
  }
  return out.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.count - a.count);
}

export function cleanStreak(tones: readonly Tone[]): number {
  let n = 0;
  for (let i = tones.length - 1; i >= 0; i--) {
    if (tones[i] === 'none') continue;
    if (tones[i] !== 'worked') break;
    n++;
  }
  return n;
}

export function bestStreak(tones: readonly Tone[]): number {
  let best = 0;
  let run = 0;
  for (const t of tones) {
    if (t === 'none') continue;
    run = t === 'worked' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}
