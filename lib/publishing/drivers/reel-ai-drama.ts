import { createExplainerInsightsClient } from '@/lib/explainers/publish/insights';
import type { ReelMetaClient } from '@/lib/explainers/publish/meta';
import {
  dramaCarryAttempt,
  dramaFailStaleAttempts,
  dramaPublishingLive,
  dramaReleaseDue,
  dramaRequireApproval,
  pollDramaInsights,
  type DramaDb,
} from '@/lib/reel-ai-drama/hub';

import type { PublishDriver } from './types';

/**
 * AI Drama Reels for the publisher (planning/AI Mini Docs/HUB-WIRING-CONTRACT.md §5): the Explainers
 * driver one for one (lib/publishing/drivers/explainers.ts), on lib/reel-ai-drama's own rules. The
 * drama worker has no publish loop of its own; this is the only thing that posts a drama reel.
 */
export function reelAiDramaDriver(deps: {
  db: DramaDb;
  meta: () => ReelMetaClient;
  signVideo: (objectPath: string, expiresIn: number) => Promise<string>;
  token: () => string;
}): PublishDriver {
  return {
    vertical: 'reel_ai_drama',
    refusesAtRelease: 'cancel',
    live: () => dramaPublishingLive(deps.db),
    requireApproval: () => dramaRequireApproval(deps.db),
    failStale: () => dramaFailStaleAttempts(deps.db),
    releaseDue: () => dramaReleaseDue(deps.db),
    carry: (id) => dramaCarryAttempt({ db: deps.db, meta: deps.meta(), signVideo: deps.signVideo }, id),
    pollInsights: () => pollDramaInsights(deps.db, createExplainerInsightsClient({ token: deps.token() })),
  };
}
