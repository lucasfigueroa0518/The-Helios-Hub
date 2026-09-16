import { NextRequest } from 'next/server';

import { LIFECYCLE_STAGES, type LifecycleStage } from '@/lib/delivery-states';
import { draftingErrorResponse, draftingJson } from '@/lib/drafting/api';
import {
  DomainRestingError,
  ExitCriteriaUnmetError,
  InvalidTransitionError,
  requestStage,
  restartWarmupTarget,
} from '@/lib/inboxes/lifecycle';
import { getInboxById } from '@/lib/inboxes/repository';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * Manual stage moves, including the Inboxes tab's named actions:
 *   set to rest      → { stage: 'resting' }
 *   resume           → { stage: 'ramping' }
 *   retire           → { stage: 'retired' }
 *   restart warmup   → { stage: 'restart_warmup' }, routed by account presence
 *
 * Refusals are 409 with a machine-readable `code` so the UI can offer "force"
 * for the ones that are the operator's call, and explain the ones that are not.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  const { id } = await params;
  let body: { stage?: string; force?: boolean; reason?: string };
  try {
    body = await request.json();
  } catch {
    return draftingJson({ error: 'Invalid JSON body' }, 400);
  }

  const inbox = await getInboxById(id);
  if (!inbox) return draftingJson({ error: 'Inbox not found' }, 404);

  const requested = body.stage?.trim().toLowerCase() ?? '';
  const stage: LifecycleStage | null = requested === 'restart_warmup'
    ? restartWarmupTarget(inbox.smartlead_email_account_id !== null)
    : (LIFECYCLE_STAGES as readonly string[]).includes(requested)
      ? (requested as LifecycleStage)
      : null;

  if (!stage) {
    return draftingJson(
      { error: `stage must be one of ${LIFECYCLE_STAGES.join(', ')} or restart_warmup` },
      422,
    );
  }

  try {
    const result = await requestStage({
      inboxId: id,
      stage,
      force: body.force === true,
      reason: body.reason,
    });
    return draftingJson({
      inbox: result.inbox,
      from: result.from,
      to: result.to,
      warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof DomainRestingError) {
      return draftingJson(
        {
          error: error.message,
          code: error.code,
          domain: error.domain,
          rested_since: error.restedSince,
          available_on: error.availableOn,
        },
        409,
      );
    }
    if (error instanceof ExitCriteriaUnmetError) {
      return draftingJson({ error: error.message, code: error.code, unmet: error.unmet }, 409);
    }
    if (error instanceof InvalidTransitionError) {
      return draftingJson({ error: error.message, code: error.code }, 422);
    }
    return draftingErrorResponse(error);
  }
}
