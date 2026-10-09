import { MetaNotConfiguredError } from '@/lib/instagram/graph';
import { InsightsBlockedError, createInsightsClient as createMediaInsightsClient } from '@/lib/instagram/insights-client';
import { INSIGHT_METRICS, readingFromMetrics, readSharedToFeed, type ReelInsightReading } from '@/lib/reels/media-insights/parse';

export { InsightsPermissionError, InsightsTokenError } from '@/lib/instagram/insights-client';

/**
 * Lifetime insights for one published reel, on the shared insights client
 * (lib/instagram/insights-client.ts). Trial Reels add `is_shared_to_feed` and
 * their own reading shape. Tests pass a fetch stub. The token stays in the
 * query string and never in an error message.
 */

export interface InsightsClient {
  reelInsights(mediaId: string): Promise<ReelInsightReading>;
}

export function createInsightsClient(options: { token: string; fetchImpl?: typeof fetch }): InsightsClient {
  const client = createMediaInsightsClient({ token: options.token, fetchImpl: options.fetchImpl, metrics: INSIGHT_METRICS });

  return {
    async reelInsights(mediaId) {
      const reading = await client.insights(mediaId);
      let sharedToFeed: boolean | null = null;
      let media: unknown = null;
      try {
        media = await client.fields(mediaId, ['is_shared_to_feed']);
        sharedToFeed = readSharedToFeed((media as { is_shared_to_feed?: unknown }).is_shared_to_feed);
      } catch (error) {
        if (error instanceof InsightsBlockedError) throw error;
        sharedToFeed = null;
      }
      const { raw, ...metrics } = reading;
      return readingFromMetrics(metrics, sharedToFeed, { ...(raw as { insights: unknown[] }), media });
    },
  };
}

export function createLiveInsightsClient(fetchImpl: typeof fetch = fetch): InsightsClient {
  const token = process.env.META_USER_ACCESS_TOKEN;
  if (!token || !process.env.META_IG_BUSINESS_ACCOUNT_ID) throw new MetaNotConfiguredError();
  return createInsightsClient({ token, fetchImpl });
}
