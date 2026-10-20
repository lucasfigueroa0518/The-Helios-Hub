import { NextResponse, type NextRequest } from 'next/server';

import { ApiError } from '@/lib/memes/api';
import { simImage } from '@/lib/memes/lfd-sim/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A slide of a simulated post: ?f=original/slide-01.jpg or final/slide-slide-01.png. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV !== 'development') {
    const { getSession } = await import('@/lib/session');
    if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const rel = request.nextUrl.searchParams.get('f') ?? '';
  try {
    const body = simImage(id, rel);
    return new NextResponse(new Uint8Array(body), { headers: { 'Content-Type': rel.endsWith('.png') ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
