import { briefFor } from '@/lib/social-hub/health/brief';
import { bestStreak, cleanStreak, groupProblems, type Problem } from '@/lib/social-hub/health/problems';
import type { Readiness } from '@/lib/social-hub/health/readiness';
import { REASON_LABEL, stageLabel } from '@/lib/social-hub/health/reasons';
import { historyNights, nightsEnding, reportNightFor } from '@/lib/social-hub/health/time';
import type { NightReport, StoredReport, Tone, TypeVerdict } from '@/lib/social-hub/health/types';
import type { Vertical } from '@/lib/social-hub/types';
import { VERTICALS, verticalInfo } from '@/lib/social-hub/verticals';

export type HealthBlock = { night: string; tone: Tone; live: boolean; card: { title: string; status: string; lines: Array<[string, string]>; why: string | null } };
export type HealthRow = { id: Vertical | 'publisher'; label: string; colorVar: string | null; blocks: HealthBlock[]; status: Tone; statusWord: string; sub: string };
export type HealthModel = {
  reportNight: string; eyebrow: string; clean: boolean;
  headline: { lead: string; emphasis: string | null; rest: string | null }; lede: string;
  chips: Array<{ id: string; text: string; best?: boolean }>;
  monthClean: { clean: number; nights: number };
  rows: HealthRow[]; problems: Problem[]; fixed: Problem[];
  readiness: Readiness[]; windowNights: number; empty: boolean;
};

const WORD: Record<Tone, string> = { worked: 'Worked', short: 'Short', failed: 'Failed', none: "Didn't run" };
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
export function ordinal(n: number): string {
  if (ORDINAL[n]) return ORDINAL[n]!;
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}
const noonUtc = (night: string) => new Date(`${night}T12:00:00Z`);
/** "Thursday, October 8" (no year). */
export const eyebrowDay = (night: string) => noonUtc(night).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
/** "Thu Oct 8" (no comma, no year). */
export const cardDay = (night: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).formatToParts(noonUtc(night)).map((x) => [x.type, x.value]));
  return `${parts.weekday} ${parts.month} ${parts.day}`;
};
const money = (n: number) => `$${n.toFixed(2)}`;

function cleanNight(r: StoredReport | undefined): boolean {
  if (!r) return false;
  const counted = r.verdict.types.filter((t) => t.tone !== 'none');
  return counted.length > 0 && counted.every((t) => t.tone === 'worked') && r.verdict.publisher !== 'failed';
}

function card(v: Vertical, night: string, t: TypeVerdict | undefined, rep: NightReport | undefined): HealthBlock['card'] {
  const title = `${verticalInfo(v).label} · ${cardDay(night)}`;
  if (!t || !rep || t.tone === 'none') return { title, status: WORD.none, lines: [], why: rep?.reportError ? "Couldn't read this type's data" : 'No run that night' };
  return {
    title,
    status: WORD[t.tone],
    lines: [['Made', `${rep.made} of ${rep.target}`], ['Posted', `${rep.postedYesterday} of ${rep.scheduledYesterday}`], ['Spend', money(rep.spendUsd)]],
    why: t.tone === 'worked' ? 'Clean night ✓' : t.cause,
  };
}

export function healthModel(input: { stored: StoredReport[]; live: StoredReport | null; readiness: Readiness[]; now: Date; windowNights: 14 | 30 }): HealthModel {
  const reportNight = input.stored.at(-1)?.night ?? reportNightFor(input.now);
  const window = nightsEnding(reportNight, input.windowNights);
  const byNight = new Map(input.stored.map((r) => [r.night, r]));
  if (input.live && input.live.night === reportNight) byNight.set(reportNight, input.live);
  const latest = byNight.get(reportNight);
  const empty = !latest;

  const rows: HealthRow[] = VERTICALS.map((info) => {
    const blocks = window.map((night): HealthBlock => {
      const r = byNight.get(night);
      const t = r?.verdict.types.find((x) => x.vertical === info.id);
      const rep = r?.reports.find((x) => x.vertical === info.id);
      return { night, tone: t?.tone ?? 'none', live: Boolean(input.live && night === input.live.night), card: card(info.id, night, t, rep) };
    });
    const tones = blocks.map((b) => b.tone);
    const streak = cleanStreak(tones);
    const status = tones.at(-1) ?? 'none';
    const counted = tones.filter((t) => t !== 'none');
    return {
      id: info.id, label: info.label, colorVar: info.colorVar, blocks, status, statusWord: WORD[status],
      sub: streak >= 2 ? `🔥 ${streak} in a row` : `${counted.filter((t) => t !== 'failed').length} of ${counted.length} nights`,
    };
  });
  const pubBlocks = window.map((night): HealthBlock => {
    const tone = byNight.get(night)?.verdict.publisher ?? 'none';
    return { night, tone, live: false, card: { title: `Publisher · ${cardDay(night)}`, status: tone === 'none' ? 'No heartbeat recorded' : tone === 'worked' ? 'Alive' : 'Stopped', lines: [], why: null } };
  });
  const pubStatus = pubBlocks.at(-1)!.tone;
  rows.push({ id: 'publisher', label: 'Publisher', colorVar: null, blocks: pubBlocks, status: pubStatus, statusWord: pubStatus === 'failed' ? 'Stopped' : pubStatus === 'worked' ? 'Alive' : 'Unknown', sub: '' });

  const all = groupProblems(window.flatMap((n) => byNight.get(n)?.failures ?? []), window);
  const problems = all.filter((p) => p.state === 'open');
  const fixed = all.filter((p) => p.state !== 'open');

  const clean = cleanNight(latest);
  const failed = latest?.verdict.types.filter((t) => t.tone === 'failed') ?? [];
  const labels = failed.map((t) => verticalInfo(t.vertical).label);
  const headline = empty
    ? { lead: 'No morning report yet.', emphasis: null, rest: null }
    : clean
      ? { lead: 'Clean night.', emphasis: null, rest: `All ${latest!.verdict.total} worked.` }
      : { lead: `Last night, ${latest!.verdict.worked} of ${latest!.verdict.total} worked.`, emphasis: labels.length ? `${labels.join(' and ')} didn't.` : latest!.verdict.publisher === 'failed' ? 'The publisher stopped.' : null, rest: null };

  let lede = empty ? 'The first report is written at 7:30 AM.' : '';
  if (!empty && clean) lede = `All ${latest!.verdict.total} types made what they needed and every post went out.`;
  if (!empty && !clean && !failed.length && !latest!.verdict.types.some((t) => t.tone === 'short') && latest!.verdict.publisher === 'failed') {
    lede = "Posts can't go out until the publisher is running again.";
  } else if (!empty && !clean) {
    const first = failed[0] ?? latest!.verdict.types.find((t) => t.tone === 'short');
    const rep = first && latest!.reports.find((r) => r.vertical === first.vertical);
    const lead = rep?.failures.find((f) => f.severity === 'failed') ?? rep?.failures[0];
    const prob = lead && all.find((p) => p.key === `${lead.vertical}|${lead.stage}|${lead.reason}`);
    const what = lead ? `${stageLabel(lead.stage)}: ${REASON_LABEL[lead.reason] ?? lead.reason}` : first?.cause ?? '';
    lede = first && rep ? `${verticalInfo(first.vertical).label} made ${rep.made} of ${rep.target}. ${what}.` : '';
    if (prob && prob.count > 1) lede += ` It's the ${ordinal(prob.count)} time in ${input.windowNights} nights.`;
  }

  const month = reportNight.slice(0, 7);
  const monthNights = [...byNight.values()].filter((r) => r.night.startsWith(month) && r.night <= reportNight);
  const monthClean = { clean: monthNights.filter(cleanNight).length, nights: monthNights.length };
  // Rows and problems use the visible window; month count and best streak use every loaded night.
  const allTones = nightsEnding(reportNight, historyNights(reportNight)).map((n): Tone => (byNight.has(n) ? (cleanNight(byNight.get(n)) ? 'worked' : 'failed') : 'none'));
  const chips: HealthModel['chips'] = [];
  const top = rows.filter((r) => r.id !== 'publisher').map((r) => ({ r, s: cleanStreak(r.blocks.map((b) => b.tone)) })).sort((a, b) => b.s - a.s)[0];
  if (top && top.s >= 2) chips.push({ id: 'streak', text: `🔥 ${top.r.label} ${top.s} clean nights` });
  const allStreak = cleanStreak(allTones);
  if (allStreak >= 3 && allStreak === bestStreak(allTones)) chips.push({ id: 'best', text: `✦ New best: ${allStreak} clean nights in a row, all types`, best: true });
  if (monthClean.nights) chips.push({ id: 'month', text: `Clean nights this month ${monthClean.clean} of ${monthClean.nights}` });

  return {
    reportNight, eyebrow: `Morning report · ${eyebrowDay(reportNight)} · 7:30 AM`, clean, headline, lede, chips, monthClean,
    rows, problems, fixed, readiness: input.readiness, windowNights: input.windowNights, empty,
  };
}

export const NIGHT_LOOKBACK = 14;
export type Recurrence = { count: number; others: string[]; brief: string };

/**
 * Night detail: for each failure kind on `night`, how often it was seen in the
 * 14 nights ending there, the other nights it happened, and the Copy for Claude
 * brief built over all of them (spec §5). `history` may include nights outside
 * the 14; they are ignored.
 */
export function nightRecurrence(night: string, history: readonly StoredReport[]): Map<string, Recurrence> {
  const window = nightsEnding(night, NIGHT_LOOKBACK);
  const out = new Map<string, Recurrence>();
  for (const p of groupProblems(history.flatMap((r) => r.failures), window)) {
    if (!p.nights.includes(night)) continue;
    out.set(p.key, { count: p.count, others: p.nights.filter((n) => n !== night), brief: briefFor(p) });
  }
  return out;
}
