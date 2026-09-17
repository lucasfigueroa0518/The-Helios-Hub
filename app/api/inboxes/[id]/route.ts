import { NextRequest } from 'next/server';

import { IDENTITY_SLUGS, type IdentitySlug } from '@/lib/delivery-states';
import { draftingErrorResponse, draftingJson } from '@/lib/drafting/api';
import {
  getInboxById,
  getInboxBySmartleadAccountId,
  linkSmartleadAccount,
  updateInbox,
} from '@/lib/inboxes/repository';
import { getSession } from '@/lib/session';
import { smartleadAdapter } from '@/lib/smartlead/adapter';
import { hasSmartleadApiKey } from '@/lib/smartlead/enabled';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  const { id } = await params;
  const inbox = await getInboxById(id);
  if (!inbox) return draftingJson({ error: 'Inbox not found' }, 404);
  return draftingJson({ inbox });
}

/**
 * Edits identity, display name, signature, the per-inbox stage plan, and the
 * enabled flag. Also carries the "claim an unassigned Smartlead account"
 * action, which is the manual fallback when address matching misses.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  const { id } = await params;
  let body: {
    from_name?: string | null;
    signature_html?: string | null;
    identity_slug?: string;
    stage_plan?: Record<string, unknown>;
    enabled?: boolean;
    smartlead_email_account_id?: number;
  };
  try {
    body = await request.json();
  } catch {
    return draftingJson({ error: 'Invalid JSON body' }, 400);
  }

  const existing = await getInboxById(id);
  if (!existing) return draftingJson({ error: 'Inbox not found' }, 404);

  let identitySlug: IdentitySlug | undefined;
  if (body.identity_slug !== undefined) {
    const slug = body.identity_slug.trim().toLowerCase();
    if (!(IDENTITY_SLUGS as readonly string[]).includes(slug)) {
      return draftingJson({ error: 'identity_slug must be lucas or tommy' }, 422);
    }
    identitySlug = slug as IdentitySlug;
  }

  try {
    if (body.smartlead_email_account_id !== undefined) {
      const accountId = Number(body.smartlead_email_account_id);
      if (!Number.isInteger(accountId) || accountId <= 0) {
        return draftingJson({ error: 'smartlead_email_account_id must be a positive integer' }, 422);
      }
      const claimedBy = await getInboxBySmartleadAccountId(accountId);
      if (claimedBy && claimedBy.id !== id) {
        return draftingJson(
          { error: `Smartlead account ${accountId} already belongs to ${claimedBy.email}`, code: 'account_claimed' },
          409,
        );
      }
      await linkSmartleadAccount(id, accountId);
    }

    const inbox = await updateInbox(id, {
      fromName: body.from_name,
      signatureHtml: body.signature_html,
      identitySlug,
      stagePlan: body.stage_plan,
      enabled: body.enabled,
    });
    const accountId = inbox?.smartlead_email_account_id
      ?? (body.smartlead_email_account_id !== undefined
        ? Number(body.smartlead_email_account_id)
        : existing.smartlead_email_account_id);
    if (
      accountId
      && hasSmartleadApiKey()
      && (body.from_name !== undefined || body.signature_html !== undefined)
    ) {
      try {
        await smartleadAdapter.updateEmailAccount(accountId, {
          ...(body.from_name !== undefined ? { from_name: body.from_name ?? '' } : {}),
          ...(body.signature_html !== undefined ? { signature: body.signature_html ?? '' } : {}),
        });
      } catch {
        // Hub row is saved; the next lifecycle pass retries the Smartlead write.
      }
    }
    return draftingJson({ inbox });
  } catch (error) {
    return draftingErrorResponse(error);
  }
}
