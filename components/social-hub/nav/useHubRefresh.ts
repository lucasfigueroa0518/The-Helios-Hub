'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useTransition } from 'react';

/**
 * Refresh the hub and stay pending until the new server render arrives.
 * router.refresh() itself returns before that render, so a button that only
 * waits on the action POST goes quiet while the page is still rebuilding.
 */
export function useHubRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);
  return { pending, refresh };
}
