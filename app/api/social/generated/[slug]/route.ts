import { NextResponse } from 'next/server';

import { isSlug, localOnly, readGeneratedPost } from '@/lib/social/render/local-store';
import { socialQuery, socialStoreKind } from '@/lib/social/store';
import { getPostRender } from '@/lib/social/store/pg';

/** One generated render Post (plan M6): social.posts first (storage spec 2026-10-08), then the local file. Local only. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (!localOnly()) return NextResponse.json({ error: 'local preview only' }, { status: 404 });
  const { slug } = await params;
  if (!isSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 400 });
  let post = null;
  if (socialStoreKind() === 'postgres') {
    try {
      post = await getPostRender(await socialQuery(), slug);
    } catch {
      post = null; // database unreachable: the file below
    }
  }
  post ??= await readGeneratedPost(slug);
  if (!post) return NextResponse.json({ error: 'not found', slug }, { status: 404 });
  return NextResponse.json(post, { headers: { 'cache-control': 'no-store' } });
}
