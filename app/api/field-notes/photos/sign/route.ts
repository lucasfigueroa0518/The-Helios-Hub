import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';

import { getSession } from '@/lib/session';

import { signUploadRoute } from '../handler';
import { createPhotoBankSignedUpload } from '../signed-upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Step 1 of a photo upload: JSON `{name, type, size}` in, `{path, uploadUrl, token}` out. The browser PUTs the file to `uploadUrl`. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return signUploadRoute({ session: getSession, sign: (path) => createPhotoBankSignedUpload(path), newId: randomUUID }, body);
}
