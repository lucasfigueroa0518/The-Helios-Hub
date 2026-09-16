import { NextRequest } from 'next/server';

import { draftingErrorResponse, draftingJson } from '@/lib/drafting/api';
import { addCalendarDays, formatNyDate } from '@/lib/drafting/send-queue-schedule';
import { listHealth } from '@/lib/inboxes/health';
import { getInboxById } from '@/lib/inboxes/repository';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * Health trend for one mailbox: its own warmup and forecast rows plus its
 * domain's Postmaster rows, which are shared by every mailbox on that domain.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return draftingJson({ error: 'Unauthorized' }, 401);

  const { id } = await params;
  const inbox = await getInboxById(id);
  if (!inbox) return draftingJson({ error: 'Inbox not found' }, 404);

  const requested = Number(request.nextUrl.searchParams.get('days') ?? 30);
  const days = Number.isFinite(requested) ? Math.min(365, Math.max(1, Math.floor(requested))) : 30;
  const today = formatNyDate();

  try {
    const rows = await listHealth({
      scopeKeys: [inbox.id, inbox.domain],
      since: addCalendarDays(today, -days),
    });
    return draftingJson({
      inbox_id: inbox.id,
      email: inbox.email,
      domain: inbox.domain,
      days,
      warmup: rows.filter((row) => row.source === 'smartlead_warmup'),
      postmaster: rows.filter((row) => row.source === 'postmaster'),
      forecast: rows.filter((row) => row.source === 'forecast'),
    });
  } catch (error) {
    return draftingErrorResponse(error);
  }
}
