import type { NextRequest } from 'next/server';

import { dbQuery } from '@/lib/db';
import { mediaBucket } from '@/lib/media-bucket';
import { SLIDE_BUCKET } from '@/lib/social/overnight/config';
import { getSession } from '@/lib/session';

import { slideResponse } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A Field Notes slide's rendered JPEG; field_notes.posts.slide_objects holds the current render's paths in SLIDE_BUCKET. */
export async function GET(_request: NextRequest, context: { params: Promise<{ postId: string; n: string }> }) {
  const { postId, n } = await context.params;
  return slideResponse(
    {
      session: getSession,
      slideObjects: async (id) => (await dbQuery<{ slide_objects: unknown }>(`SELECT slide_objects FROM field_notes.posts WHERE id = $1`, [id])).rows[0]?.slide_objects ?? null,
      sign: (objectPath, expiresIn) => mediaBucket(SLIDE_BUCKET).sign(objectPath, expiresIn),
    },
    postId,
    n,
  );
}
