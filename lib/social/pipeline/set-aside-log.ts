/**
 * Set-aside log (spec §2.4, §7.1).
 *
 * A set-aside story is a bug report against the stage that caused it.
 * The log exists only to spot patterns (§2.3): there is no rerun API and
 * no screen. Entries are scoped to the day they were written — stories
 * expire with the day, so a new day's run never sees yesterday's.
 *
 * Local JSONL file for now (same local-file approach as used-log.ts);
 * no DB writes until M7.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { REASON_KIND, type ReasonCode, type SetAsideKind, type StageName } from './types';

export const DAY_TIME_ZONE = 'America/New_York';

export type SetAsideEntry = {
  /** YYYY-MM-DD in DAY_TIME_ZONE. */
  day: string;
  storyId: string;
  stage: StageName;
  reasonCode: ReasonCode;
  kind: SetAsideKind;
  detail: string;
  /** ISO timestamp. */
  at: string;
};

export type SetAsideInput = Pick<SetAsideEntry, 'storyId' | 'stage' | 'reasonCode' | 'detail'>;

export type SetAsideLog = {
  record(input: SetAsideInput, now: Date): Promise<SetAsideEntry>;
  /** Entries for the day containing `now`. Earlier days are expired. */
  forDay(now: Date): Promise<SetAsideEntry[]>;
};

/** Calendar day of `now` in the pipeline's time zone, as YYYY-MM-DD. */
export function dayKey(now: Date, timeZone: string = DAY_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function toEntry(input: SetAsideInput, now: Date): SetAsideEntry {
  return {
    day: dayKey(now),
    storyId: input.storyId,
    stage: input.stage,
    reasonCode: input.reasonCode,
    kind: REASON_KIND[input.reasonCode],
    detail: input.detail,
    at: now.toISOString(),
  };
}

export function createInMemorySetAsideLog(): SetAsideLog {
  const entries: SetAsideEntry[] = [];
  return {
    async record(input, now) {
      const entry = toEntry(input, now);
      entries.push(entry);
      return entry;
    },
    async forDay(now) {
      const day = dayKey(now);
      return entries.filter((e) => e.day === day);
    },
  };
}

export function createFileSetAsideLog(opts: { path?: string } = {}): SetAsideLog {
  const filePath = opts.path ?? path.join(process.cwd(), 'Claude outputs', 'social-set-aside.jsonl');
  return {
    async record(input, now) {
      const entry = toEntry(input, now);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.appendFile(filePath, `${JSON.stringify(entry)}\n`);
      return entry;
    },
    async forDay(now) {
      const day = dayKey(now);
      let text: string;
      try {
        text = await fsp.readFile(filePath, 'utf8');
      } catch {
        return [];
      }
      return text
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as SetAsideEntry)
        .filter((e) => e.day === day);
    },
  };
}
