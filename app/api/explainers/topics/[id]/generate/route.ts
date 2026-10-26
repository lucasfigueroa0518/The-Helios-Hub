import { NextResponse } from 'next/server';

import { explainersDb } from '@/lib/explainers/connection';
import { requestRender, typicalRenderCostUsd } from '@/lib/explainers/repository';
import { loadSettings } from '@/lib/explainers/settings';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REFUSALS: Record<string, string> = {
  topic_not_found: 'Topic not found.',
  topic_not_renderable: 'An archived topic can’t be generated.',
  topic_published: 'This topic has already been posted.',
  already_in_flight: 'This topic is already being made.',
};

/** A cap is a question, not a wall: the person can confirm one render over it (idea pool standard, 2026-10-21). */
const CAPS: Record<string, string> = {
  daily_render_cap: 'Today’s render cap is used up.',
  daily_spend_cap: 'Today’s spend cap is used up.',
};

/**
 * Generate (E-05, A-5): queue a render for a topic. The worker renders it. Any unpublished topic can be
 * generated. Body `{ overrideCaps: true }` is the person confirming one render over a daily cap.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { overrideCaps?: unknown } | null;

  try {
    const db = await explainersDb();
    const settings = await loadSettings(db);
    const result = await requestRender(db, { topicId: id, trigger: 'click', settings, overrideCaps: body?.overrideCaps === true });
    if (!result.ok) {
      if (result.reason in CAPS) {
        return NextResponse.json({ ask: 'over_cap', reason: result.reason, error: CAPS[result.reason], costUsd: await typicalRenderCostUsd(db, settings) }, { status: 409 });
      }
      return NextResponse.json({ error: REFUSALS[result.reason], reason: result.reason }, { status: 409 });
    }
    return NextResponse.json({ job: result.job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
