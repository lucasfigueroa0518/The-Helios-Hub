/**
 * The pre-flight check for tonight's overnight run: what the calendar expects against what the workers will do.
 * Pure (plain inputs in, findings out) so it is tested offline; scripts/preflight_night.ts gathers the inputs
 * with SELECTs only. It never calls Claude, Jev, TypeSafe or Meta (CLAUDE.md Rule 1), so the one thing it cannot
 * see, the API credit balance, is always printed as a manual check.
 */
import type { Vertical } from '@/lib/social-hub/types';

export type Level = 'ok' | 'warn' | 'fail' | 'manual';
export type Finding = { level: Level; text: string };

export type PreflightInput = {
  /** The New York date the coming night makes content for. */
  date: string;
  /** Calendar slots on that date by content type (Stories carry their series). */
  slots: ReadonlyArray<{ vertical: Vertical; series: string | null }>;
  /** Whether each type's own auto switch is on (Stories: per series; reels have none). */
  autoOn: Partial<Record<Vertical, boolean>>;
  storiesSeriesAuto: Record<string, boolean>;
  publishingLive: Partial<Record<Vertical, boolean>>;
  /** Field Notes posts waiting for review, and the limit at which its run skips. */
  fieldNotesPending: number;
  fieldNotesMaxPending: number;
  /** Stories sets built but not yet approved (they cannot post). */
  storiesReadyUnapproved: number;
  /** Failure reasons the latest stored Health reports still show (failed severity only). */
  recentFailureReasons: readonly string[];
  explainers: { perReelCapUsd: number; dailySpendCapUsd: number };
};

const LABEL: Record<string, string> = {
  stories: 'Stories', reels: 'Trial Reels', carousels: 'Carousels', last_few_days: 'Last Few Days', ai_events: 'AI Events',
  field_notes: 'Field Notes', explainers: 'Explainers', reel_ai_drama: 'AI Drama',
};
const label = (v: string) => LABEL[v] ?? v;

export function judge(i: PreflightInput): Finding[] {
  const out: Finding[] = [];
  const expected = [...new Set(i.slots.map((s) => s.vertical))];
  if (!expected.length) out.push({ level: 'warn', text: `The calendar has nothing on ${i.date}.` });

  for (const v of expected) {
    if (v === 'stories') {
      for (const s of i.slots.filter((x) => x.vertical === 'stories')) {
        const on = i.storiesSeriesAuto[s.series ?? ''];
        out.push(on ? { level: 'ok', text: `Stories ${s.series}: slot on ${i.date}, auto is on.` } : { level: 'fail', text: `Stories ${s.series}: the calendar has a slot on ${i.date}, but this series' auto is off, so no set will be made.` });
      }
      continue;
    }
    const on = i.autoOn[v];
    if (on === false) out.push({ level: 'fail', text: `${label(v)}: the calendar has a slot on ${i.date}, but its auto switch is off, so nothing will be made.` });
    else out.push({ level: 'ok', text: `${label(v)}: slot on ${i.date}${on === undefined ? '' : ', auto is on'}.` });
  }

  for (const v of expected) {
    if (i.publishingLive[v] === false) out.push({ level: 'warn', text: `${label(v)}: publishing_live is off, so it will be made but cannot post.` });
  }

  if (expected.includes('field_notes')) {
    out.push({ level: 'ok', text: `Field Notes: ${i.fieldNotesPending} waiting for review; that does not stop the nightly run.` });
  }
  if (i.storiesReadyUnapproved > 0) out.push({ level: 'warn', text: `${i.storiesReadyUnapproved} Stories set(s) are built but unapproved; they cannot post until a person approves them.` });

  if (expected.includes('explainers') && i.explainers.dailySpendCapUsd < i.explainers.perReelCapUsd) {
    out.push({ level: 'fail', text: `Explainers: the daily spend cap ($${i.explainers.dailySpendCapUsd}) is below the per-reel cap ($${i.explainers.perReelCapUsd}), so the daily cap will stop a render first.` });
  }

  const credits = i.recentFailureReasons.filter((r) => r === 'out_of_credits').length;
  const auth = i.recentFailureReasons.filter((r) => r === 'auth').length;
  if (credits) out.push({ level: 'fail', text: `The latest Health report still shows ${credits} out-of-credits failure(s); confirm the balance was topped up.` });
  if (auth) out.push({ level: 'fail', text: `The latest Health report still shows ${auth} sign-in/permission failure(s); check the API keys on the worker.` });
  out.push({ level: 'manual', text: 'TypeSafe credit balance and auto-reload: not checked (no live API calls); look at console.typesafe.ai/settings/billing.' });
  out.push({ level: 'manual', text: 'Anthropic key on the worker VM (worker.env) and which code the VM runs: not checked from here (needs gcloud).' });
  return out;
}

export const hasFailure = (f: readonly Finding[]) => f.some((x) => x.level === 'fail');
