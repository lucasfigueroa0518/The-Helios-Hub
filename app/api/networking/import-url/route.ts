import { NextRequest, NextResponse } from 'next/server';

import { importUrl } from '@/lib/networking/ingest';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { url?: string; force?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const url = body.url?.trim();
  if (!url) return NextResponse.json({ error: 'URL is required' }, { status: 400 });

  try {
    const result = await importUrl(url, { force: body.force !== false });
    if (!result.ok) {
      return NextResponse.json(
        { error: `Event did not pass keep rules: ${result.reasons.join(', ')}`, reasons: result.reasons },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, event: result.event });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to import URL';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
