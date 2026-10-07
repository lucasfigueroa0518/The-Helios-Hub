import { NextResponse } from 'next/server';

import { explainersDb } from '@/lib/explainers/connection';
import { getJob, saveFeedback } from '@/lib/explainers/repository';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Lucas's review (E-08): approve or reject, failure tags, optional note. Saving again replaces it. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { verdict?: unknown; tags?: unknown; note?: unknown } | null;
  if (body?.verdict !== 'approved' && body?.verdict !== 'rejected') {
    return NextResponse.json({ error: 'verdict must be approved or rejected' }, { status: 400 });
  }
  const tags = Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === 'string') : [];
  const note = typeof body.note === 'string' ? body.note.slice(0, 4000) : null;
  try {
    const db = await explainersDb();
    const job = await getJob(db, id);
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (job.status === 'requested' || job.status === 'running') {
      return NextResponse.json({ error: 'This reel is still rendering.' }, { status: 409 });
    }
    const feedback = await saveFeedback(db, { jobId: id, verdict: body.verdict, tags, note, createdBy: session.email });
    return NextResponse.json({ feedback });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: /unknown failure tag/.test(message) ? 400 : 500 });
  }
}
