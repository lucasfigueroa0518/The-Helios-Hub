import { NextResponse } from 'next/server';

import { isPostingType } from '@/lib/content-type/posting';
import { readProgress } from '@/lib/content-type/progress';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const type = new URL(request.url).searchParams.get('type');
  if (!isPostingType(type)) return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
  try {
    return NextResponse.json({ items: await readProgress(type) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
