import { NextResponse, type NextRequest } from 'next/server';

import { ApiError, memeImage } from '@/lib/memes/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV !== 'development') {
    const { getSession } = await import('@/lib/session');
    if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const { labDb } = await import('@/lib/memes/live');
  try {
    const png = await memeImage(await labDb(), id);
    return new NextResponse(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' } });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
