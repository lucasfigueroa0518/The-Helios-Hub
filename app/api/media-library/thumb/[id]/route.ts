import type { NextRequest } from 'next/server';

import { dbQuery } from '@/lib/db';
import { mediaBucket } from '@/lib/media-bucket';
import { PHOTO_BANK_BUCKET } from '@/lib/media-library/types';
import { getSession } from '@/lib/session';

import { thumbResponse } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A photo bank thumbnail (or `?v=master`), through a short signed URL (DECISIONS_LOG D49). */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return thumbResponse(
    {
      session: getSession,
      query: (text, params) => dbQuery(text, params),
      sign: (objectPath, expiresIn) => mediaBucket(PHOTO_BANK_BUCKET).sign(objectPath, expiresIn),
    },
    id,
    request.nextUrl.searchParams.get('v'),
  );
}
