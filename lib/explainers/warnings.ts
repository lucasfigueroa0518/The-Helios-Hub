import type { LintViolation } from '@/lib/explainers/types';

/**
 * The warnings a reel carries (Explainers 4.2, CONTRACT-4.2 § Warnings; Lucas, 2026-10-27: "I want it to
 * fail open and then carry the warning or signal with it"). Every quality check fails open: at most one
 * fix round, then what is left is stored as a `lint_violations` row with severity 'warning' and one of
 * these rule ids, and the reel still renders. The review page shows them as a banner on the reel; the
 * reel's card and the worker's finish log carry the count and the first two.
 *
 * Client-safe: no Node imports.
 */

/**
 * Rule ids that are reel warnings: `understanding:<type>`, `breakage:<check>`, `picture:<kind>`,
 * `minimum:<n>`, `spend_cap`, `salvaged` (the contract's), plus E's `lint:<rule>` (a storyboard-lint
 * error left after the director's own lint-and-fix round), `caption:<what>` (the post caption could
 * not be written; the reel is still delivered), and `analogy:no_pass` / `gap:no_pass` (nothing passed
 * the idea checks, so the least-bad analogy or gap line went ahead).
 */
export const WARNING_RULE_RE = /^(?:(?:understanding|breakage|picture|minimum|lint|caption|analogy|gap):\S|spend_cap$|salvaged$)/;

export function isReelWarning(row: { rule: string; severity: string }): boolean {
  return row.severity === 'warning' && WARNING_RULE_RE.test(row.rule);
}

/** The plain-words label for a warning's rule. */
const LABELS: [RegExp, string][] = [
  [/^understanding:/, 'Understanding'],
  [/^breakage:/, 'Breakage'],
  [/^picture:/, 'Picture check'],
  [/^minimum:/, 'Minimum'],
  [/^lint:/, 'Storyboard'],
  [/^caption:/, 'Caption'],
  [/^analogy:/, 'Analogy'],
  [/^gap:/, 'Curiosity gap'],
  [/^spend_cap$/, 'Spend cap'],
  [/^salvaged$/, 'Salvaged'],
];

export function warningLabel(rule: string): string {
  return LABELS.find(([re]) => re.test(rule))?.[1] ?? 'Warning';
}

/** One warning in plain words: "<label>, frame N: <detail>". */
export function warningText(row: Pick<LintViolation, 'rule' | 'frame' | 'detail'>): string {
  const where = row.frame != null ? `, frame ${row.frame}` : '';
  return `${warningLabel(row.rule)}${where}: ${row.detail}`;
}

/**
 * Which warnings lead (lower first): what cut the reel short, then what a viewer would misunderstand,
 * the missing caption, what is broken on screen, what the picture check saw, a missing minimum, a
 * storyboard-lint leftover, a test that could not run, and the understanding test's minor notes last.
 */
const ORDER: RegExp[] = [
  /^(spend_cap|salvaged)$/,
  /^(analogy|gap):/,
  /^understanding:(?!minor$|not_run$|no_answer_key$|scene_line$)/,
  /^caption:/,
  /^breakage:/,
  /^picture:/,
  /^minimum:/,
  /^lint:/,
  /^understanding:(not_run|no_answer_key|scene_line)$/,
];

export function warningRank(rule: string): number {
  const i = ORDER.findIndex((re) => re.test(rule));
  return i < 0 ? ORDER.length : i;
}

/** A reel's warnings only, most important first (stable within a rank). */
export function reelWarnings<T extends { rule: string; severity: string }>(rows: readonly T[]): T[] {
  return rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => isReelWarning(row))
    .sort((a, b) => warningRank(a.row.rule) - warningRank(b.row.rule) || a.i - b.i)
    .map(({ row }) => row);
}

export type WarningsSummary = { count: number; first: string[] };

/** The count and the first two, in plain words, for the reel's notice (its card and the finish log). */
export function warningsSummary(rows: readonly { rule: string; frame: number | null; detail: string; severity: string }[]): WarningsSummary {
  const warnings = groupWarnings(reelWarnings(rows));
  return { count: warnings.length, first: warnings.slice(0, 2).map(warningText) };
}

/**
 * A check's finding as a reel warning: severity 'warning', and a rule id from the list above. A row
 * already under one of the ids keeps it; any other becomes `<prefix>:<its rule>`.
 */
export function asReelWarning(row: LintViolation, prefix: 'lint' | 'breakage' | 'picture' | 'minimum' | 'understanding' | 'analogy' | 'gap'): LintViolation {
  const rule = WARNING_RULE_RE.test(row.rule) ? row.rule : `${prefix}:${row.rule}`;
  return { ...row, rule, severity: 'warning' };
}

/** What each serious understanding type means, in plain words (the warning's first words). */
export const SERIOUS_LABELS: Record<string, string> = {
  wrong_referent: 'A viewer took the term for something else',
  two_stories: 'The term seemed to name two different things',
  wrong_step: 'A viewer understood a step wrongly',
  missing_step: 'A core step did not land',
  over_extension: 'The comparison planted a false belief',
  example_wrong: "The example's answer did not land",
  example_ambiguous: 'The example can be read two ways',
  question_unanswered: "The reel's question did not get its answer across",
};

/** A detail with its times and numbers blanked: the pattern repeats share. */
const pattern = (detail: string) => detail.replace(/\b\d+(?:\.\d+)?s?\b/g, '#');
const TIME_RE = /\s*(?:at |@)?(\d+(?:\.\d+)?)s\b/g;

/**
 * Repeats folded (Lucas, 2026-10-28): rows with the same rule, frame and message pattern (times and
 * numbers aside) become one, "<message> (×N, 5.1–9.6s)". Order is kept; the first row of a group leads.
 */
export function groupWarnings<T extends { rule: string; frame: number | null; detail: string }>(rows: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.rule}|${row.frame ?? ''}|${pattern(row.detail)}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map((list) => {
    if (list.length === 1) return list[0];
    const times = list.flatMap((r) => [...r.detail.matchAll(TIME_RE)].map((m) => Number(m[1])));
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const span = times.length ? `, ${r1(Math.min(...times))}–${r1(Math.max(...times))}s` : '';
    const base = list[0].detail.replace(TIME_RE, '').replace(/\s+([,.;:)])/g, '$1').trim();
    return { ...list[0], detail: `${base} (×${list.length}${span})` };
  });
}
