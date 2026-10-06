import { NextRequest } from 'next/server';

import type { SenderIdentitySlug } from '@/lib/agentmail-inboxes';
import { draftingErrorResponse, draftingJson } from '@/lib/drafting/api';
import {
  cancelSendQueueItems,
  formatNyDate,
  listSendQueue,
  moveSendQueueItems,
} from '@/lib/drafting/send-queue';
import { sendQueueBoardWindow } from '@/lib/drafting/send-queue-schedule';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uniqueParams(url: URL, key: string): string[] {
  return [...new Set(url.searchParams.getAll(key).map((value) => value.trim()).filter(Boolean))];
}

function isUuid(value: string): boolean {
  return UUID.test(value);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  const url = request.nextUrl;
  const today = formatNyDate();
  const boardWindow = sendQueueBoardWindow(today);
  const from = url.searchParams.get('from') ?? boardWindow.from;
  const to = url.searchParams.get('to') ?? boardWindow.to;
  const campaignIds = uniqueParams(url, 'campaign_id').filter(isUuid);
  if (campaignIds.length !== uniqueParams(url, 'campaign_id').length) {
    return draftingJson({ error: 'campaign_id must be a uuid' }, 400);
  }
  const identitySlugs = uniqueParams(url, 'identity').filter(
    (slug): slug is SenderIdentitySlug => slug === 'lucas' || slug === 'tommy',
  );
  const inboxEmails = uniqueParams(url, 'inbox');

  try {
    const result = await listSendQueue({
      ownerId: session.userId,
      from,
      to,
      campaignIds,
      identitySlugs,
      inboxEmails,
    });
    return draftingJson({
      ...result,
      owner_id: session.userId,
    });
  } catch (error) {
    return draftingErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  let body: { ids?: string[]; target_date?: string; user_id?: string };
  try {
    body = await request.json();
  } catch {
    return draftingJson({ error: 'Invalid JSON body' }, 400);
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return draftingJson({ error: 'ids are required' }, 400);
  }
  if (typeof body.target_date !== 'string') {
    return draftingJson({ error: 'target_date is required' }, 400);
  }

  try {
    const result = await moveSendQueueItems({
      ownerId: session.userId,
      ids: body.ids,
      targetDate: body.target_date,
    });
    return draftingJson(result);
  } catch (error) {
    return draftingErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  let body: { ids?: string[]; user_id?: string };
  try {
    body = await request.json();
  } catch {
    return draftingJson({ error: 'Invalid JSON body' }, 400);
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0) {
    return draftingJson({ error: 'ids are required' }, 400);
  }

  try {
    const result = await cancelSendQueueItems({
      ownerId: session.userId,
      ids: body.ids,
    });
    return draftingJson(result);
  } catch (error) {
    return draftingErrorResponse(error);
  }
}
