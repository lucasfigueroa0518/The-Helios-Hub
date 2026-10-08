import type { Queryable } from '@/lib/explainers/db';
import { createExplainerInsightsClient, pollExplainerInsights } from '@/lib/explainers/publish/insights';
import type { ReelMetaClient } from '@/lib/explainers/publish/meta';
import { carryAttempt, failStaleAttempts } from '@/lib/explainers/publish/publish';
import { publishingLive, releaseDueSchedules, requireApproval } from '@/lib/explainers/publish/schedule';

import type { PublishDriver } from './types';

/**
 * Explainers for the publisher: lib/explainers/publish's own rules, on the
 * spine. Approval is enforced when a due slot is queued (the review verdict,
 * mirrored onto the spine), as before.
 */
export function explainersDriver(deps: {
  db: Queryable;
  meta: () => ReelMetaClient;
  signVideo: (objectPath: string, expiresIn: number) => Promise<string>;
  token: () => string;
}): PublishDriver {
  return {
    vertical: 'explainers',
    live: () => publishingLive(deps.db),
    requireApproval: () => requireApproval(deps.db),
    failStale: () => failStaleAttempts(deps.db),
    releaseDue: () => releaseDueSchedules(deps.db),
    carry: (id) => carryAttempt({ db: deps.db, meta: deps.meta(), signVideo: deps.signVideo }, id),
    pollInsights: () => pollExplainerInsights(deps.db, createExplainerInsightsClient({ token: deps.token() })),
  };
}
