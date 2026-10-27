import { AsyncLocalStorage } from 'node:async_hooks';
import { headers } from 'next/headers';

import { HUB_TIMING_HEADER } from '@/lib/social-hub/server-timing-path';
import { addHubSpan, enterHubTiming, leaveHubTiming, type HubSpan } from '@/lib/social-hub/server-timing-store';

const current = new AsyncLocalStorage<string>();

/**
 * Time one piece of a Social Hub render. Outside a `withHubTiming` render this
 * is just the work. Spans are `dataset`, `extras`, `sign`, and `week`.
 */
export async function timeHub<T>(name: HubSpan, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await work();
  } finally {
    const id = current.getStore();
    if (id) addHubSpan(id, name, performance.now() - started);
  }
}

/**
 * Run a hub page and seal its Server-Timing when the render returns. A parallel
 * slot on the same request (the post drawer) shares the seal.
 */
export async function withHubTiming<T>(render: () => Promise<T>): Promise<T> {
  let id: string | null = null;
  try {
    id = (await headers()).get(HUB_TIMING_HEADER);
  } catch {
    id = null;
  }
  if (!id || !enterHubTiming(id)) return render();
  const timingId = id;
  return current.run(timingId, async () => {
    try {
      return await render();
    } finally {
      leaveHubTiming(timingId);
    }
  });
}
