import { NextResponse } from 'next/server';

import { listProperties } from '@/lib/seo/repository';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const properties = await listProperties();
  return NextResponse.json({ properties });
}
