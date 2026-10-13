import type { Problem } from '@/lib/social-hub/health/problems';
import { REASON_LABEL, stageLabel } from '@/lib/social-hub/health/reasons';
import type { Vertical } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';

/** Where to start reading for each type; the publish stage is shared. */
const FILES: Record<Vertical, string[]> = {
  reels: ['lib/reels/'],
  explainers: ['lib/explainers/render/job.ts', 'lib/explainers/'],
  carousels: ['lib/social/pipeline/', 'lib/social/writer/prompt.ts'],
  stories: ['lib/stories/build/'],
};

export function briefFor(p: Problem): string {
  const files = p.stage === 'publish' ? ['lib/publishing/publisher.ts'] : FILES[p.vertical];
  const lines = [
    `# Helios Social health problem: ${verticalInfo(p.vertical).label} · ${stageLabel(p.stage)}`,
    '',
    `- Reason: ${p.reason} (${REASON_LABEL[p.reason] ?? 'unlabeled'})`,
    `- Seen on ${p.count} night(s): ${p.nights.join(', ')}${p.backAgain ? ' (back again after a quiet stretch)' : ''}`,
    `- Latest: ${p.latest.at}${p.latest.runId ? ` · run ${p.latest.runId}` : ''}${p.latest.item ? ` · ${p.latest.item.kind} ${p.latest.item.id} (${p.latest.item.label})` : ''}`,
    '',
    '## Raw errors (newest first)',
    ...p.events.slice().reverse().slice(0, 5).map((e) => `- ${e.night} ${e.at}: ${e.rawError ?? '(no message)'}`),
    '',
    '## Start reading',
    ...files.map((f) => `- ${f}`),
    '',
    'Fix the stage that produced this, not a downstream check. Do not run live pipelines to reproduce; use fixtures.',
  ];
  return lines.join('\n');
}
