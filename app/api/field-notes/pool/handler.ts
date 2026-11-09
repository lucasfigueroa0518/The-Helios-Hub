import { NextResponse } from 'next/server';

import { PHOTO_KINDS, type PhotoKind } from '@/lib/field-notes/types';

export type PoolAction = 'reject' | 'restore' | 'tag';

export type FieldNotesPoolEnv = {
  session: () => Promise<{ email: string } | null>;
  /** lib/field-notes/photos/store.ts `retirePhoto`: false when the photo is not in the pool. */
  reject: (photoId: string, reason: string) => Promise<boolean>;
  /** lib/field-notes/photos/store.ts `restorePhotoToPool`: false when it is not retired. */
  restore: (photoId: string) => Promise<boolean>;
  /** lib/field-notes/photos/store.ts `setPhotoTags`: false when the photo is not in the pool. */
  tag: (photoId: string, tags: { kind?: PhotoKind; opener?: boolean }) => Promise<boolean>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REASON_REQUIRED = 'A rejection needs a reason: a readable private screen, a recognizable stranger, or a prominent third-party logo.';
export const REASON_MAX_CHARS = 300;

export type PoolBody = { action: 'reject'; photoId: string; reason: string } | { action: 'restore'; photoId: string } | { action: 'tag'; photoId: string; kind?: PhotoKind; opener?: boolean };

/** `{ action: 'reject', photoId, reason }` or `{ action: 'restore', photoId }`; an error string when malformed. */
export function parsePoolBody(body: unknown): PoolBody | { error: string } {
  const b = body as { action?: unknown; photoId?: unknown; reason?: unknown; kind?: unknown; opener?: unknown } | null;
  if (!b || typeof b !== 'object' || (b.action !== 'reject' && b.action !== 'restore' && b.action !== 'tag')) return { error: 'Expected { action: reject | restore | tag, photoId }.' };
  if (typeof b.photoId !== 'string' || !UUID.test(b.photoId)) return { error: 'Expected a photo id.' };
  const photoId = b.photoId.toLowerCase();
  if (b.action === 'restore') return { action: 'restore', photoId };
  if (b.action === 'tag') {
    const kind = b.kind === undefined ? undefined : PHOTO_KINDS.find((k) => k === b.kind);
    if (b.kind !== undefined && !kind) return { error: `Kind must be one of ${PHOTO_KINDS.join(', ')}.` };
    if (b.opener !== undefined && typeof b.opener !== 'boolean') return { error: 'Opener must be true or false.' };
    if (kind === undefined && b.opener === undefined) return { error: 'Send a kind, an opener flag, or both.' };
    return { action: 'tag', photoId, ...(kind ? { kind } : {}), ...(b.opener !== undefined ? { opener: b.opener as boolean } : {}) };
  }
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!reason) return { error: REASON_REQUIRED };
  if (reason.length > REASON_MAX_CHARS) return { error: `Keep the reason under ${REASON_MAX_CHARS} characters.` };
  return { action: 'reject', photoId, reason };
}

/** Manual Reject (with a required reason), Restore, and Tag (kind and opener star) on one pool photo. No session is a 401, a malformed body a 400, before anything is written. */
export async function fieldNotesPoolRoute(env: FieldNotesPoolEnv, body: unknown): Promise<NextResponse> {
  const session = await env.session();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = parsePoolBody(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    if (parsed.action === 'tag') {
      return (await env.tag(parsed.photoId, { kind: parsed.kind, opener: parsed.opener }))
        ? NextResponse.json({ ok: true, note: 'Saved.' })
        : NextResponse.json({ ok: false, note: 'That photo is not in the pool.' }, { status: 404 });
    }
    if (parsed.action === 'reject') {
      return (await env.reject(parsed.photoId, parsed.reason))
        ? NextResponse.json({ ok: true, note: 'Rejected. The photo will not be used.' })
        : NextResponse.json({ ok: false, note: 'That photo is not in the pool.' }, { status: 404 });
    }
    return (await env.restore(parsed.photoId))
      ? NextResponse.json({ ok: true, note: 'Restored to the pool.' })
      : NextResponse.json({ ok: false, note: 'That photo is not rejected.' }, { status: 409 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
