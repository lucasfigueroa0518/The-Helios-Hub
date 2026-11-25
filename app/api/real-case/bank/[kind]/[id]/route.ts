import fs from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { loadCutouts } from '@/lib/real-case/bank';
import { getSession } from '@/lib/session';
import { logoFor } from '@/lib/social-hub/logo-bank';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A banked logo or approved cutout, by id, for the lab's player thumbnails. Local only. */
export async function GET(_request: Request, context: { params: Promise<{ kind: string; id: string }> }) {
  if (!(await getSession()) && process.env.NODE_ENV !== 'development') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { kind, id } = await context.params;
  if (!/^[a-z0-9-]+$/.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const rel = kind === 'logo' ? logoFor(id)?.file : kind === 'cutout' ? loadCutouts().find((c) => c.id === id && c.approved)?.file : null;
  const file = rel ? path.join(process.cwd(), rel) : null;
  if (!file || !fs.existsSync(file)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(file)), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400' } });
}
