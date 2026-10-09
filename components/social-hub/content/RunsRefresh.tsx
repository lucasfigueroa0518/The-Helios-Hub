'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** While a run is in flight, re-read the page every few seconds so the cards and tiles move on their own. */
export function RunsRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
