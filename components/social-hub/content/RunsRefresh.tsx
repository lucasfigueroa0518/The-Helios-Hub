'use client';

import { useRouter } from 'next/navigation';

import type { AllProgress } from '@/lib/content-type/progress';
import { aRunLeft, inFlightKey, inFlightRuns } from '@/lib/social-hub/views/run-for';
import { usePoll } from '@/lib/use-poll';

/** Mark the shared hub read stale, then re-render (see POST /api/content-type/progress). */
async function refreshHubPage(router: { refresh: () => void }): Promise<void> {
  await fetch('/api/content-type/progress', { method: 'POST' }).catch(() => undefined);
  router.refresh();
}

/**
 * Re-read the Content page when what is in flight changes: a run starts,
 * moves a stage, or finishes. The carousel page polls on its own; this page
 * used to stay still until it was opened again.
 *
 * Only a finished run marks the shared hub read stale. Marking it on every
 * poll while a run was in flight (every 5 s) meant no page in the hub ever
 * read from the cache during a run, and every visit re-read every schema.
 * Progress itself is read fresh on each render, so a stage change shows with
 * a plain re-render.
 */
export function RunsRefresh({ active, known, runs }: { active: boolean; known: string; runs: string[] }) {
  const router = useRouter();
  const tick = async () => {
    const res = await fetch('/api/content-type/progress?type=all', { cache: 'no-store' });
    if (!res.ok) return;
    const json = (await res.json()) as { all?: AllProgress };
    const all: AllProgress = {
      carousels: json.all?.carousels ?? [],
      stories: json.all?.stories ?? [],
      explainers: json.all?.explainers ?? [],
      last_few_days: json.all?.last_few_days ?? [],
      ai_events: json.all?.ai_events ?? [],
    };
    if (inFlightKey(all) === known) return;
    if (aRunLeft(runs, inFlightRuns(all))) await refreshHubPage(router);
    else router.refresh();
  };
  usePoll(tick, active ? 5000 : 8000, { immediate: !active });
  return null;
}
