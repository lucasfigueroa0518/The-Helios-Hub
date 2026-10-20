import type { NextRequest } from 'next/server';

import { getRun } from '@/lib/memes/api';
import { memesRoute } from '@/lib/memes/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return memesRoute(({ db }) => getRun(db, id));
}
