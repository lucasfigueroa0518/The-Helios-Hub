import type { NextRequest } from 'next/server';

import { attach, detach } from '@/lib/memes/api';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return memesRoute(({ db }) => attach(db, body));
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return memesRoute(({ db }) => detach(db, body));
}
