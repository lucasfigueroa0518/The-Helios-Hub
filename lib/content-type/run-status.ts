/**
 * One sentence for a render that is queued, in a stage, or failed. The strip,
 * the bench row, and the card sidebar all use this, so a reel says the same
 * thing wherever its status is written.
 */

export type RunState = 'queued' | 'running' | 'failed';

export type RunSnapshot = {
  state: RunState;
  stage: string | null;
  error: string | null;
  requestedAt: string;
  startedAt: string | null;
};

const STAGE_LABEL: Record<string, string> = {
  claimed: 'Claimed by the worker',
  source: 'Reading the source',
  workspace: 'Setting up the project',
  session_a: 'Writing the plan',
  session_a_done: 'Plan written',
  checkpoint: 'Checking the storyboard',
  session_b: 'Building the reel',
  session_b_done: 'Build finished',
  repair: 'Repairing missing frames',
  collect: 'Collecting the render',
  render: 'Rendering the video',
  caption: 'Writing the caption',
};

export function stageLabel(stage: string | null): string {
  if (!stage) return 'Running';
  return STAGE_LABEL[stage] ?? stage.replaceAll('_', ' ');
}

const clock = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The first useful clause of a worker error, short enough for a row. */
export function shortRunError(error: string | null | undefined): string {
  if (!error) return '';
  const one = error.replace(/\s+/g, ' ').trim();
  const stderr = one.split(' stderr:')[1]?.trim();
  const cut = (stderr || one).replace(/\)\.?$/, '');
  return cut.length > 160 ? `${cut.slice(0, 157)}…` : cut;
}

export function elapsedSeconds(run: Pick<RunSnapshot, 'state' | 'requestedAt' | 'startedAt'>, now: number): number | null {
  if (run.state === 'failed') return null;
  const since = Date.parse(run.state === 'running' ? (run.startedAt ?? run.requestedAt) : run.requestedAt);
  if (!Number.isFinite(since)) return null;
  return (now - since) / 1000;
}

export function runStatusText(run: RunSnapshot, now = Date.now()): string {
  const elapsed = elapsedSeconds(run, now);
  const time = elapsed != null ? ` · ${clock(elapsed)}` : '';
  if (run.state === 'queued') return `Queued · waiting for the worker${time}`;
  if (run.state === 'failed') {
    const why = shortRunError(run.error);
    return why ? `Failed · ${why}` : 'Failed';
  }
  return `${stageLabel(run.stage)}${time}`;
}
