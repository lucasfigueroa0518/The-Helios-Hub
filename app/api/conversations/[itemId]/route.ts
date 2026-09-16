import { NextRequest } from 'next/server';

import { draftingErrorResponse, draftingJson } from '@/lib/drafting/api';
import {
  draftingItemIdForEmailSend,
  getConversationThread,
} from '@/lib/drafting/conversations';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ itemId: string }> };

/**
 * A conversation is now keyed on the drafting item, so one thread holds every
 * sequence step. Links minted before that change carried `email_sends.id`;
 * those still resolve here by mapping the send back to its item.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  const { itemId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) {
    return draftingJson({ error: 'Invalid conversation id' }, 400);
  }

  try {
    let thread = await getConversationThread({
      ownerId: session.userId,
      draftingItemId: itemId,
    });

    if (!thread) {
      const draftingItemId = await draftingItemIdForEmailSend(itemId);
      if (draftingItemId) {
        thread = await getConversationThread({ ownerId: session.userId, draftingItemId });
      }
    }

    if (!thread) return draftingJson({ error: 'Conversation not found' }, 404);
    return draftingJson({ thread });
  } catch (error) {
    return draftingErrorResponse(error);
  }
}
