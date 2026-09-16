import { NextRequest } from 'next/server';

import { draftingErrorResponse, draftingJson } from '@/lib/drafting/api';
import {
  AutomatedReplyInFlightError,
  ThreadNotReplyableError,
  sendHumanReply,
} from '@/lib/drafting/human-reply';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

type Params = { params: Promise<{ itemId: string }> };

/**
 * Human reply inside the five-minute window.
 *
 * A 409 means the Claude fallback already claimed the thread. The UI tells the
 * operator what went out and re-posts with `confirm_duplicate: true` if they
 * still want to add their own reply.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  const { itemId } = await params;
  let body: { body_text?: string; confirm_duplicate?: boolean };
  try {
    body = await request.json();
  } catch {
    return draftingJson({ error: 'Invalid JSON body' }, 400);
  }

  const text = body.body_text?.trim() ?? '';
  if (!text) return draftingJson({ error: 'body_text is required' }, 422);

  try {
    const result = await sendHumanReply({
      draftingItemId: itemId,
      bodyText: text,
      userId: session.userId,
      confirmDuplicate: body.confirm_duplicate === true,
    });
    return draftingJson({
      reply_send_id: result.replySendId,
      cancelled_fallback: result.cancelledFallback,
      provider_message_id: result.providerMessageId,
    });
  } catch (error) {
    if (error instanceof AutomatedReplyInFlightError) {
      return draftingJson(
        {
          error: error.message,
          code: error.code,
          automated_reply: error.automatedReply,
          confirm_required: true,
        },
        409,
      );
    }
    if (error instanceof ThreadNotReplyableError) {
      return draftingJson({ error: error.message, code: error.code }, 409);
    }
    return draftingErrorResponse(error);
  }
}
