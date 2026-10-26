'use client';

import { useRouter } from 'next/navigation';

import type { AllProgress } from '@/lib/content-type/progress';
import { inFlightKey } from '@/lib/social-hub/views/run-for';
import { usePoll } from '@/lib/use-poll';

/** Mark the shared hub read stale, then re-render (see POST /api/content-type/progress). */
async function refreshHubPage(router: { refresh: () => void }): Promise<void> {
  await fetch('/api/content-type/progress', { method: 'POST' }).catch(() => undefined);
  router.refresh();
}

/**
 * Re-read the Content page while a run is in flight, and also when one
 * starts after the page was drawn. The carousel page polls on its own; this
 * page used to stay still until it was opened again.
 */
export function RunsRefresh({ active, known }: { active: boolean; known: string }) {
  const router = useRouter();
  const tick = async () => {
    if (active) {
      await refreshHubPage(router);
      return;
    }
    const res = await fetch('/api/content-type/progress?type=all', { cache: 'no-store' });
    if (!res.ok) return;
    const json = (await res.json()) as { all?: AllProgress };
    const next = inFlightKey({
      carousels: json.all?.carousels ?? [],
      stories: json.all?.stories ?? [],
      explainers: json.all?.explainers ?? [],
      last_few_days: json.all?.last_few_days ?? [],
      ai_events: json.all?.ai_events ?? [],
    });
    if (next !== known) await refreshHubPage(router);
  };
  usePoll(tick, active ? 5000 : 8000, { immediate: !active });
  return null;
}
