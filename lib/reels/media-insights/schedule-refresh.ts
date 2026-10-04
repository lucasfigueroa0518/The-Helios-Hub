import { after } from 'next/server';

import { INSIGHTS_PAGE_BATCH } from '@/lib/reels/media-insights/due';
import {
  INSIGHTS_POLL_SETTING,
  claimInsightsPoll,
  pollDueInsights,
  releaseInsightsLock,
} from '@/lib/reels/media-insights/poll';
import { getSetting } from '@/lib/reels/music/store';

export type InsightsRefreshKick = {
  pending: boolean;
  startedAt: string | null;
};

/**
 * Claim a refresh if the last one is older than 30 minutes, then ask Instagram
 * after the page has already been sent. A second open during that pull just
 * reports that it is still running.
 */
export async function beginInsightsRefresh(now = new Date()): Promise<InsightsRefreshKick> {
  const startedAt = now.toISOString();
  const claim = await claimInsightsPoll(now, false);
  if (claim === 'claimed') {
    after(() => {
      void pollDueInsights({ limit: INSIGHTS_PAGE_BATCH, now, alreadyClaimed: true }).catch((error) => {
        console.error('insights refresh failed', error instanceof Error ? error.message : String(error));
        return releaseInsightsLock(startedAt);
      });
    });
    return { pending: true, startedAt };
  }
  if (claim === 'busy') {
    const current = await getSetting<{ startedAt?: string }>(INSIGHTS_POLL_SETTING);
    return { pending: true, startedAt: current?.startedAt ?? startedAt };
  }
  return { pending: false, startedAt: null };
}
