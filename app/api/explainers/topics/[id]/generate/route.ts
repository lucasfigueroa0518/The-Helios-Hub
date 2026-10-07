import { NextResponse } from 'next/server';

import { explainersDb } from '@/lib/explainers/connection';
import { requestRender } from '@/lib/explainers/repository';
import { loadSettings } from '@/lib/explainers/settings';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REFUSALS: Record<string, string> = {
  topic_not_found: 'Topic not found.',
  topic_not_renderable: 'Only a pool topic can be generated.',
  already_in_flight: 'A render for this topic is already queued or running.',
  daily_render_cap: 'Production daily render cap reached.',
  daily_spend_cap: 'Production daily spend cap reached.',
};

/** Generate (E-05, A-5): queue a render for a pool topic. The worker renders it. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const db = await explainersDb();
    const result = await requestRender(db, { topicId: id, trigger: 'click', settings: await loadSettings(db) });
    if (!result.ok) {
      return NextResponse.json({ error: REFUSALS[result.reason], reason: result.reason }, { status: 409 });
    }
    return NextResponse.json({ job: result.job });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
