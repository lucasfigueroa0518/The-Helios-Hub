import type { NextRequest } from 'next/server';

import { ApiError, approve, publishNow, regenerate, reject } from '@/lib/stories/api';
import { storiesRoute } from '@/lib/stories/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Approve, Reject (tags + note), Regenerate, Publish now (plan §8). */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return storiesRoute(async ({ db, email }) => {
    if (action === 'approve') return approve(db, id);
    if (action === 'reject') return reject(db, id, body, email);
    if (action === 'regenerate') return regenerate(db, id, email);
    if (action === 'publish-now') return publishNow(db, id);
    throw new ApiError(404, 'Unknown action.');
  });
}
