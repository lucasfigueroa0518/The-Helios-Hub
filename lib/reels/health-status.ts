import { RUN_TIMEZONE } from '@/lib/reels/config';

export type SourceTone = 'fresh' | 'stale' | 'failed' | 'never';

const STALE_MS = 36 * 60 * 60 * 1000;

export function sourceTone(
  lastSuccessAt: string | null,
  lastRunStatus: 'ok' | 'failed' | 'skipped' | null,
  now: Date,
): SourceTone {
  if (lastRunStatus === 'failed') return 'failed';
  if (!lastSuccessAt) return 'never';
  if (now.getTime() - new Date(lastSuccessAt).getTime() > STALE_MS) return 'stale';
  return 'fresh';
}

export function staleDays(lastSuccessAt: string | null, now: Date): number {
  if (!lastSuccessAt) return 0;
  return Math.max(1, Math.round((now.getTime() - new Date(lastSuccessAt).getTime()) / 86_400_000));
}

export type VerdictInput = {
  runStatus: string | null;
  failedSourceName: string | null;
  staleSource: { name: string; days: number } | null;
  jobErrorsToday: { stage: string; count: number; detail?: string | null } | null;
  stuckStage: string | null;
  metaReady: boolean;
  /** What a live night or reel is doing right now, when that is the lead fact. */
  activity?: string | null;
};

export type HealthVerdict = { tone: 'ok' | 'warn' | 'bad'; sentence: string };

/** The one sentence at the top of Health. The first broken thing wins. */
export function healthVerdict(input: VerdictInput): HealthVerdict {
  if (input.runStatus === 'failed') return { tone: 'bad', sentence: 'Last night failed.' };
  if (input.runStatus === 'skipped') return { tone: 'warn', sentence: 'Last night was skipped.' };
  if (input.runStatus === 'partial' && input.failedSourceName) {
    return { tone: 'warn', sentence: `${input.failedSourceName} failed on the last night.` };
  }
  if (input.runStatus === 'partial') return { tone: 'warn', sentence: 'Last night finished with errors.' };
  if (input.failedSourceName) return { tone: 'bad', sentence: `${input.failedSourceName} failed on the last night.` };
  if (input.staleSource) {
    const { name, days } = input.staleSource;
    if (days <= 0) return { tone: 'warn', sentence: `${name} has never succeeded.` };
    return { tone: 'warn', sentence: `${name} has not succeeded in ${days} day${days === 1 ? '' : 's'}.` };
  }
  if (input.jobErrorsToday && input.jobErrorsToday.count > 0) {
    const { stage, count, detail } = input.jobErrorsToday;
    const jobs = `${count} ${stage} job${count === 1 ? '' : 's'} failed today.`;
    return { tone: 'warn', sentence: detail ? `${jobs} ${detail}` : jobs };
  }
  if (input.activity) return { tone: 'ok', sentence: input.activity };
  if (input.stuckStage) return { tone: 'warn', sentence: `A ${input.stuckStage} job is still running.` };
  if (!input.metaReady) return { tone: 'bad', sentence: 'Meta credentials are missing, so nothing can post.' };
  if (input.runStatus === 'running' || input.runStatus === 'requested') return { tone: 'ok', sentence: 'A night is running.' };
  return { tone: 'ok', sentence: 'Everything is working.' };
}

/** The sentence after "N publish jobs failed today." Drops the Meta code suffix. */
export function publishFailureLine(error: string | null): string | null {
  if (!error) return null;
  const cleaned = error.replace(/^Meta returned \d+:\s*/, '').replace(/\s*\(code [\s\S]*$/, '').trim();
  if (!cleaned) return null;
  return cleaned.endsWith('.') ? cleaned : `${cleaned}.`;
}

export type RunActivity = {
  status: string | null;
  adapterTotal: number;
  finishedAdapters: number;
  /** The source being read right now, when one fetch is still open. */
  currentAdapter: string | null;
  storiesKept: number;
  /** Cost-ledger components already written for this run. */
  components: readonly string[];
  /** Ideas scored so far. Pass-1 calls until the slate exists, then the slate count. */
  scored: number;
  hasSlate: boolean;
  copyWritten: number;
  frame: number;
  video: number;
  song: number;
  publish: number;
};

function tally(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * One sentence for a night that is still going, or for a reel still being made
 * after the night returns. Null when nothing is in progress.
 */
export function describeRunStage(input: RunActivity): string | null {
  if (input.publish > 0) return 'Publishing the reel.';
  if (input.song > 0) return 'Picking a song.';
  if (input.video > 0) return 'Rendering the clip.';
  if (input.frame > 0) return 'Drawing the frame.';

  const active = input.status === 'running' || input.status === 'requested';
  if (!active) return null;
  if (input.status === 'requested') return 'Queued. Waiting for the worker to start.';

  const writingCopy =
    input.copyWritten > 0 ||
    input.components.some((component) => component.startsWith('copy-') || component === 'full-story-cue');
  if (writingCopy) {
    return input.copyWritten > 0 ? 'Copy is in. Queuing the frame.' : 'Writing the on-screen copy.';
  }
  if (input.hasSlate) return `Scored ${tally(input.scored, 'idea')}. Writing copy.`;
  if (input.components.includes('scoring-pass1') || input.components.includes('scoring-pass2')) {
    return input.scored > 0 ? `Scoring ideas. ${input.scored} scored so far.` : 'Scoring ideas.';
  }
  if (input.components.includes('grouping') || input.components.includes('idea-merge')) {
    return `Grouping ${tally(input.storiesKept, 'story', 'stories')} into ideas.`;
  }
  if (input.currentAdapter) {
    return `Reading ${input.currentAdapter}. ${input.finishedAdapters} of ${input.adapterTotal} sources done, ${tally(input.storiesKept, 'story', 'stories')} kept.`;
  }
  if (input.finishedAdapters > 0 || input.storiesKept > 0) {
    return `Ingesting sources. ${input.finishedAdapters} of ${input.adapterTotal} done, ${tally(input.storiesKept, 'story', 'stories')} kept.`;
  }
  return 'Starting the night.';
}

/** How many source columns fit. A narrow viewport shows fewer. */
export function barsInView(viewportWidth: number): number {
  if (viewportWidth > 0 && viewportWidth < 560) return 3;
  if (viewportWidth > 0 && viewportWidth < 900) return 4;
  return 5;
}

/**
 * Sources far enough into the viewport to set the scale. A sliver at the edge
 * does not count. The end index is exclusive.
 */
export function visibleIndexRange(
  count: number,
  scrollLeft: number,
  viewport: number,
  slot: number,
): { start: number; end: number } {
  if (count <= 0 || slot <= 0 || viewport <= 0) return { start: 0, end: 0 };
  let start = count;
  let end = 0;
  for (let index = 0; index < count; index += 1) {
    const left = index * slot;
    const right = left + slot;
    const shown = Math.min(right, scrollLeft + viewport) - Math.max(left, scrollLeft);
    if (shown >= slot * 0.4) {
      if (index < start) start = index;
      if (index + 1 > end) end = index + 1;
    }
  }
  if (end <= start) {
    const index = Math.min(count - 1, Math.max(0, Math.floor(scrollLeft / slot)));
    return { start: index, end: index + 1 };
  }
  return { start, end };
}

/** Axis ceiling for the sources in view. The floor stays at zero. */
export function chartYMax(counts: readonly number[]): number {
  let max = 0;
  for (const count of counts) if (count > max) max = count;
  return Math.max(1, max);
}

export function formatNy(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: RUN_TIMEZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
