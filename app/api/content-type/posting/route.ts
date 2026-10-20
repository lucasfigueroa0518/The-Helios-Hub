import { NextResponse } from 'next/server';

import { costPerPost, isPostingType, readPosting, writePosting, type PostingPatch } from '@/lib/content-type/posting';
import { loadHubDataset } from '@/lib/social-hub/views/cached-dataset';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const type = new URL(request.url).searchParams.get('type');
  if (!isPostingType(type)) return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  try {
    // The hub's posts carry their costs: the daily limit's "one more a night costs about $x" (none when unreadable).
    // Read beside the settings, not before them.
    const now = new Date();
    const [state, posts] = await Promise.all([readPosting(type, now), loadHubDataset().then((d) => d.posts).catch(() => null)]);
    return NextResponse.json({ ...state, costPerPostMicros: posts ? costPerPost(posts, type, now) : null });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 });
  }
}

/** Body: `{ type, ...patch }` where the patch is live, generate, autoPublish, perDay, cap (the daily limit) or one series' change. A person's click is the decision. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as ({ type?: unknown } & PostingPatch) | null;
  if (!body || !isPostingType(body.type)) return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  const { type, ...patch } = body;
  try {
    return NextResponse.json(await writePosting(type, patch, session.email));
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}
