import { NextRequest, NextResponse } from 'next/server';

import { detachMember, setPublished } from '@/lib/reels/repository';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  action?: 'detach' | 'set_published';
  source_id?: string;
  published?: boolean;
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Body | null;

  try {
    if (body?.action === 'detach') {
      if (!body.source_id) {
        return NextResponse.json({ error: 'source_id is required' }, { status: 400 });
      }
      const result = await detachMember(id, body.source_id);
      if (!result) return NextResponse.json({ error: 'Source not found' }, { status: 404 });
      return NextResponse.json({ ok: true, ...result });
    }

    if (body?.action === 'set_published') {
      // Nothing marks itself published in Build 1; this is the manual log that
      // a future publishing step will write to (D-005, D-012, D-061).
      await setPublished(id, body.published === true);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
