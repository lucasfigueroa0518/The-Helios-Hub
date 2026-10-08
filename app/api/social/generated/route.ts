import { NextResponse } from 'next/server';

import { listGeneratedSlugs, localOnly } from '@/lib/social/render/local-store';
import { socialQuery, socialStoreKind } from '@/lib/social/store';
import { listPosts } from '@/lib/social/store/pg';

/** Lists the generated posts for the preview page (plan M6): social.posts plus the local files (storage spec 2026-10-08). Local only. */
export async function GET(): Promise<Response> {
  if (!localOnly()) return NextResponse.json({ error: 'local preview only' }, { status: 404 });
  const slugs = new Set(await listGeneratedSlugs());
  if (socialStoreKind() === 'postgres') {
    try {
      for (const p of await listPosts(await socialQuery(), { limit: 500 })) slugs.add(p.slug);
    } catch {
      // database unreachable: the files only
    }
  }
  return NextResponse.json({ slugs: [...slugs].sort() }, { headers: { 'cache-control': 'no-store' } });
}
