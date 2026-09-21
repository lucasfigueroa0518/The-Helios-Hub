import { NextRequest, NextResponse } from 'next/server';

import { getOrgSetting, type WebhookSettings } from '@/lib/org-settings';
import { isSmartleadEnabled } from '@/lib/smartlead/enabled';
import {
  MAX_WEBHOOK_BODY_BYTES,
  applySmartleadEvent,
  ipAllowed,
  normalizeSmartleadEvent,
  verifySmartleadSignature,
  verifyWebhookPathToken,
} from '@/lib/smartlead/webhook';
import type { SmartleadWebhookPayload } from '@/lib/smartlead/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ token: string }> };

/**
 * Smartlead delivery events.
 *
 * Response codes are chosen for Smartlead's retry behaviour, which backs off
 * over six hours and disables the hook after five consecutive failures:
 *   503 while the kill switch is off, so events are retried, not lost
 *   404 on a bad path token, so the endpoint is not enumerable
 *   400 on unparseable input, which retrying cannot fix
 *   200 on anything we understood, including events we chose to ignore
 *   500 only on a database failure, which is worth retrying
 */
export async function POST(request: NextRequest, { params }: Params) {
  if (!isSmartleadEnabled()) {
    return NextResponse.json(
      { error: 'Smartlead delivery is disabled', code: 'smartlead_disabled' },
      { status: 503, headers: { 'Retry-After': '900' } },
    );
  }

  const { token } = await params;
  if (!verifyWebhookPathToken(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const settings = await getOrgSetting<WebhookSettings>('smartlead.webhook', {
    mode: 'path_token',
  });

  const sourceIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  if (!ipAllowed(sourceIp, settings.allowed_ips ?? [])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  if (settings.mode === 'hmac') {
    const signature = request.headers.get('x-smartlead-signature')
      ?? request.headers.get('x-signature');
    if (!verifySmartleadSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let payload: SmartleadWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as SmartleadWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const event = normalizeSmartleadEvent(payload);
  if (!event) {
    // An event type we do not handle is not an error; acknowledging it stops
    // Smartlead retrying something we will never accept.
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const outcome = await applySmartleadEvent(event);
    return NextResponse.json({
      ok: true,
      event: event.type,
      event_id: event.eventId,
      applied: outcome.applied,
      reason: outcome.reason ?? null,
    });
  } catch (error) {
    console.error('[smartlead-webhook] apply failed', {
      event: event.type,
      eventId: event.eventId,
      campaignId: event.smartleadCampaignId,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: 'Failed to record event' }, { status: 500 });
  }
}

/** Smartlead pings the URL when a hook is saved. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { token } = await params;
  if (!verifyWebhookPathToken(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, service: 'helios-smartlead-webhook' });
}
