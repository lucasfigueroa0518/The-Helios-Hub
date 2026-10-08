import { NextResponse } from 'next/server';

import { isSlug, localOnly, readGeneratedPost } from '@/lib/social/render/local-store';

/** One locally generated render Post (plan M6). Local only; no database. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (!localOnly()) return NextResponse.json({ error: 'local preview only' }, { status: 404 });
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  const post = await readGeneratedPost(slug);
  if (!post) return NextResponse.json({ error: 'not found', slug }, { status: 404 });
  return NextResponse.json(post, { headers: { 'cache-control': 'no-store' } });
}
