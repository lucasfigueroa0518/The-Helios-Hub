import { NextRequest, NextResponse } from 'next/server';

import { addReviewFlag } from '@/lib/reels/repository';
import { getSession } from '@/lib/session';
import type { ReviewFlagKind } from '@/lib/reels/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KINDS: ReadonlySet<string> = new Set<ReviewFlagKind>([
  'wrong_merge',
  'missed_link',
  'junk_source',
]);

/**
 * Marks from the review page. These are the calibration set (STY-04 / D-054):
 * every flag is stored so grouping thresholds can be tuned against Lucas's own
 * labels rather than a number invented up front.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    kind?: string;
    post_idea_id?: string | null;
    source_id?: string | null;
    note?: string | null;
  } | null;

  if (!body?.kind || !KINDS.has(body.kind)) {
    return NextResponse.json({ error: 'Unknown flag kind' }, { status: 400 });
  }
  if (!body.post_idea_id && !body.source_id) {
    return NextResponse.json({ error: 'A post idea or a source is required' }, { status: 400 });
  }

  try {
    await addReviewFlag({
      kind: body.kind as ReviewFlagKind,
      postIdeaId: body.post_idea_id ?? null,
      sourceId: body.source_id ?? null,
      note: body.note ?? null,
      createdBy: session.email,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
