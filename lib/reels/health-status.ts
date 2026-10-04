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
