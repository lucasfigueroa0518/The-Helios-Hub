'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import type { ProgressItem } from '@/lib/content-type/progress';
import { inFlightKey } from '@/lib/social-hub/views/run-for';

const TYPES = ['carousels', 'stories', 'explainers'] as const;

/**
 * Re-read the Content page while a run is in flight, and also when one
 * starts after the page was drawn. The carousel page polls on its own; this
 * page used to stay still until it was opened again.
 */
export function RunsRefresh({ active, known }: { active: boolean; known: string }) {
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (active) {
        router.refresh();
        return;
      }
      try {
        const lists = await Promise.all(TYPES.map(async (type) => {
          const res = await fetch(`/api/content-type/progress?type=${type}`, { cache: 'no-store' });
          if (!res.ok) return [] as ProgressItem[];
          const json = (await res.json()) as { items?: ProgressItem[] };
          return (json.items ?? []).filter((item) => item.state !== 'failed');
        }));
        const next = inFlightKey({ carousels: lists[0] ?? [], stories: lists[1] ?? [], explainers: lists[2] ?? [] });
        if (!stop && next !== known) router.refresh();
      } catch {
        // A missed poll leaves the page as it is.
      }
    };
    if (!active) void tick();
    const t = setInterval(() => void tick(), active ? 5000 : 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active, known, router]);
  return null;
}
