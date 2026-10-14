import type { StoredReport, Tone } from '@/lib/social-hub/health/types';
import type { Vertical } from '@/lib/social-hub/types';

/**
 * The overnight scoreboard (reliability plan #1): per night and per type, what
 * was made, covered and posted, what failed and why, and what it cost. Built
 * from the same night reports as the Health tab, so the two always agree.
 */

const MARK: Record<Tone, string> = { worked: '✔', short: '⚠', failed: '✖', none: '·' };

/** Pads to `n` for alignment; never cuts (a cut note hides the part that explains it). */
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const usd = (n: number) => `$${n.toFixed(2)}`;

/** `nights` oldest first. Lines for a terminal; no colour codes, so they paste anywhere. */
export function scoreboardLines(nights: readonly StoredReport[], label: (v: Vertical) => string): string[] {
  const lines: string[] = [];
  const clean = new Map<Vertical, number>();
  const due = new Map<Vertical, number>();
  let spend = 0;
  for (const n of nights) {
    lines.push(`${n.night}  ${n.verdict.worked} of ${n.verdict.total} types worked · publisher ${MARK[n.verdict.publisher]}`);
    for (const v of n.verdict.types) {
      const r = n.reports.find((x) => x.vertical === v.vertical)!;
      spend += r.spendUsd;
      if (r.due) {
        due.set(v.vertical, (due.get(v.vertical) ?? 0) + 1);
        if (v.tone === 'worked') clean.set(v.vertical, (clean.get(v.vertical) ?? 0) + 1);
      }
      const notes = v.checks.filter((c) => c.id !== 'plumbing' || c.tone !== 'worked').map((c) => c.note).join(' · ');
      const fails = r.failures.filter((f) => f.severity !== 'healed');
      const cause = v.cause ?? (fails[0] ? fails[0].reason : null);
      const why = cause && !notes.includes(cause) ? cause : null;
      lines.push(`  ${MARK[v.tone]} ${pad(label(v.vertical), 16)} ${pad(notes, 70)} ${pad(usd(r.spendUsd), 7)}${fails.length ? ` ${fails.length} failed` : ''}${why ? ` · ${why}` : ''}`);
    }
  }
  if (nights.length > 1) {
    lines.push('');
    lines.push(`${nights.length} nights · ${usd(spend)} spent`);
    for (const [v, d] of due) lines.push(`  ${pad(label(v), 16)} ${clean.get(v) ?? 0} of ${d} nights clean`);
  }
  return lines;
}
