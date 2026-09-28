import { NextResponse } from 'next/server';

import { dbQuery } from '@/lib/db';
import { requireSocialSession } from '@/lib/social/session';

/**
 * Editorial review action — reviewer marks a generated post approved, sends
 * it back for revision, or rejects it outright. Auth-gated; the signed-in
 * user's email is stored as reviewed_by so we can attribute decisions.
 *
 * Body: { status: 'approved' | 'needs_revision' | 'rejected', note?: string }
 *   - 'needs_revision' REQUIRES a non-empty note — that note is the critique
 *     the author will regenerate against.
 *   - 'approved' and 'rejected' accept an optional note.
 * Returns: { status, reviewedAt, reviewedBy, note }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await requireSocialSession();
  const reviewer = session.email;

  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid article id' }, { status: 400 });
  }

  let body: { status?: string; note?: string } = {};
  try {
    body = (await req.json()) as typeof body ?? {};
  } catch {
    return NextResponse.json({ error: 'missing body' }, { status: 400 });
  }

  const status = body.status;
  if (status !== 'approved' && status !== 'rejected' && status !== 'needs_revision') {
    return NextResponse.json(
      { error: 'status must be approved, needs_revision, or rejected' },
      { status: 400 },
    );
  }

  const note = typeof body.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : null;
  if (status === 'needs_revision' && !note) {
    return NextResponse.json(
      { error: 'needs_revision requires a note describing what to change' },
      { status: 400 },
    );
  }

  // Accept both legacy (copy_json) and creator (render_post_json) rows —
  // the presence of either means there's something to review.
  const { rows } = await dbQuery<{ copy_json: unknown; render_post_json: unknown }>(
    `UPDATE helios_social.article_queue
        SET review_status = $1,
            review_note   = $2,
            reviewed_at   = now(),
            reviewed_by   = $3
      WHERE id = $4
        AND (copy_json IS NOT NULL OR render_post_json IS NOT NULL)
    RETURNING copy_json, render_post_json`,
    [status, note, reviewer, id],
  );

  if (!rows[0]) {
    return NextResponse.json(
      { error: 'article not found or has no generated post to review' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    status,
    reviewedAt: new Date().toISOString(),
    reviewedBy: reviewer,
    note,
  });
}
