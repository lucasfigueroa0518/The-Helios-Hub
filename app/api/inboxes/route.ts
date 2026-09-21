import { NextRequest } from 'next/server';

import { IDENTITY_SLUGS, type IdentitySlug } from '@/lib/delivery-states';
import { draftingErrorResponse, draftingJson } from '@/lib/drafting/api';
import { applyStagePlanPatchToAll, createInbox, getInboxByEmail } from '@/lib/inboxes/repository';
import { buildInboxRoster } from '@/lib/inboxes/roster';
import { DEFAULT_STAGE_PLAN, mergeStagePlan } from '@/lib/inboxes/stage-plan';
import { getOrgSetting, setOrgSetting } from '@/lib/org-settings';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

function parseIdentity(value: unknown): IdentitySlug | null {
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (IDENTITY_SLUGS as readonly string[]).includes(slug) ? (slug as IdentitySlug) : null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);
  try {
    return draftingJson(await buildInboxRoster());
  } catch (error) {
    return draftingErrorResponse(error);
  }
}

/**
 * Adds a mailbox at `provisioning`. The Smartlead account is matched by email
 * on the next Inboxes load (or Sync), not supplied here.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  let body: {
    email?: string;
    identity_slug?: string;
    from_name?: string;
    signature_html?: string;
  };
  try {
    body = await request.json();
  } catch {
    return draftingJson({ error: 'Invalid JSON body' }, 400);
  }

  const email = body.email?.trim().toLowerCase() ?? '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return draftingJson({ error: 'A valid email address is required' }, 422);
  }
  const identitySlug = parseIdentity(body.identity_slug);
  if (!identitySlug) {
    return draftingJson({ error: 'identity_slug must be lucas or tommy' }, 422);
  }
  if (await getInboxByEmail(email)) {
    return draftingJson({ error: `${email} is already a sender inbox`, code: 'duplicate' }, 409);
  }

  try {
    const inbox = await createInbox({
      email,
      identitySlug,
      fromName: body.from_name?.trim() || null,
      signatureHtml: body.signature_html ?? null,
    });
    return draftingJson({ inbox }, 201);
  } catch (error) {
    return draftingErrorResponse(error);
  }
}

/** Edits the org-wide lifecycle defaults that every mailbox merges over. */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  let body: { stage_plan_default?: unknown; apply_to_all_inboxes?: boolean };
  try {
    body = await request.json();
  } catch {
    return draftingJson({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.stage_plan_default || typeof body.stage_plan_default !== 'object') {
    return draftingJson({ error: 'stage_plan_default must be an object' }, 422);
  }

  try {
    const current = await getOrgSetting('stage_plan.default', DEFAULT_STAGE_PLAN);
    const next = mergeStagePlan(DEFAULT_STAGE_PLAN, current, body.stage_plan_default);
    await setOrgSetting('stage_plan.default', next);
    const applied = body.apply_to_all_inboxes
      ? await applyStagePlanPatchToAll(body.stage_plan_default)
      : 0;
    return draftingJson({ ...(await buildInboxRoster()), applied_to: applied });
  } catch (error) {
    return draftingErrorResponse(error);
  }
}
