import { NextResponse } from 'next/server';

import { humanizePost } from '@/lib/social/copy/humanize';
import type { Post } from '@/lib/social/render/types';

/**
 * Preview-only humanizer endpoint. The preview page posts the fixture Post,
 * we run it through humanize (Haiku 4.5 + prompt caching), and return the
 * rewritten Post + usage stats.
 *
 * User-triggered by the ?humanized=1 preview flag → this stays inside the
 * "human-authorized run" boundary from CLAUDE.md Rule 1.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { post: Post };
    if (!body?.post) {
      return NextResponse.json({ error: 'Missing `post` in body.' }, { status: 400 });
    }
    const result = await humanizePost(body.post);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'humanize failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
