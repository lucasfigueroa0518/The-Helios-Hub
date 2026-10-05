import { NextResponse } from 'next/server';

import { listGeneratedSlugs, localOnly } from '@/lib/social/render/local-store';

/** Lists the locally generated posts for the preview page (plan M6). Local only; no database. */
export async function GET(): Promise<Response> {
  if (!localOnly()) return NextResponse.json({ error: 'local preview only' }, { status: 404 });
  return NextResponse.json({ slugs: await listGeneratedSlugs() }, { headers: { 'cache-control': 'no-store' } });
}
