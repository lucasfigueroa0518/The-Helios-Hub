import type { NextRequest } from 'next/server';

import { dbQuery } from '@/lib/db';
import { restorePhotoToPool, retirePhoto, setPhotoTags } from '@/lib/field-notes/photos/store';
import { getSession } from '@/lib/session';

import { fieldNotesPoolRoute } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const db = (text: string, params?: unknown[]) => dbQuery(text, params as never) as never;

/** Reject (reason required), Restore and Tag on the Field Notes photo pool. Writes only field_notes.pool; no model call. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  return fieldNotesPoolRoute({ session: getSession, reject: (id, reason) => retirePhoto(db, id, reason), restore: (id) => restorePhotoToPool(db, id), tag: (id, tags) => setPhotoTags(db, id, tags) }, body);
}
