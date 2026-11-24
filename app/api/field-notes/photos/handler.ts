import { NextResponse } from 'next/server';

import type { IngestPhotoResult } from '@/lib/field-notes/photos/ingest';
import { isHeif, UnsupportedImageError } from '@/lib/field-notes/photos/heic';

import { INCOMING_PATH, INCOMING_PREFIX, MAX_UPLOAD_BYTES, OVERSIZE_MESSAGE, resolveMime, UPLOAD_KINDS, type UploadKind } from './rules';

export { MAX_UPLOAD_BYTES, OVERSIZE_MESSAGE, resolveMime };

type Session = { email: string } | null;

export const KIND_REQUIRED = `Pick what the photo shows before adding it: ${UPLOAD_KINDS.join(', ')}. Faces are found automatically.`;

export type PhotoUploadResponse =
  | IngestPhotoResult
  | { kind: 'unsupported'; reason: string }
  | { kind: 'too_large'; reason: string }
  | { kind: 'failed'; reason: string };

const json = (r: unknown, status = 200) => NextResponse.json(r, { status });
const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

// ── step 1: a signed upload URL ─────────────────────────────────────────────

export type SignEnv = {
  session: () => Promise<Session>;
  /** A signed upload URL for one object in the photo bank bucket. */
  sign: (path: string) => Promise<{ uploadUrl: string; token: string }>;
  newId: () => string;
};

export type SignResponse = { path: string; uploadUrl: string; token: string };

/** No session is a 401. The file's name, type and size are checked here so a bad file never uploads. */
export async function signUploadRoute(env: SignEnv, input: { name?: unknown; type?: unknown; size?: unknown }): Promise<NextResponse> {
  if (!(await env.session())) return unauthorized();
  const name = typeof input.name === 'string' ? input.name : '';
  if (!name) return json({ error: 'Send the file name.' }, 400);
  if (typeof input.size === 'number' && input.size > MAX_UPLOAD_BYTES) return json({ kind: 'too_large', reason: OVERSIZE_MESSAGE }, 413);
  if (typeof input.size === 'number' && input.size <= 0) return json({ kind: 'unsupported', reason: 'The file is empty.' }, 415);
  if (!resolveMime(name, typeof input.type === 'string' ? input.type : '')) {
    return json({ kind: 'unsupported', reason: 'Field Notes takes HEIC, HEIF, JPEG, PNG or WebP photos.' }, 415);
  }
  const path = `${INCOMING_PREFIX}${env.newId()}`;
  try {
    const signed = await env.sign(path);
    return json({ path, uploadUrl: signed.uploadUrl, token: signed.token } satisfies SignResponse);
  } catch (error) {
    return json({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) }, 500);
  }
}

// ── step 2: finalize ────────────────────────────────────────────────────────

export type FinalizeEnv = {
  session: () => Promise<Session>;
  download: (path: string) => Promise<Buffer>;
  remove: (paths: string[]) => Promise<void>;
  /**
   * lib/field-notes/photos/ingest.ts `ingestPhoto` with the live db and photo bucket bound, faces deferred to the worker
   * (no detector on Vercel). `kind` is the uploader's non-face choice; the detector alone makes a photo `people`.
   */
  ingest: (file: { bytes: Buffer; mime: string; uploadedBy: string; kind: UploadKind }) => Promise<IngestPhotoResult>;
};

/** The stored object has no trusted type, so read it from the first bytes, then the file name. */
export function sniffMime(bytes: Buffer, name: string): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (isHeif(bytes, '')) return 'image/heic';
  return resolveMime(name, '');
}

export type FinalizeInput = { path?: unknown; name?: unknown; kind?: unknown };

/**
 * Read the uploaded object, convert, read EXIF, dedupe, strip location and store it (queued for the face check), then remove the
 * incoming object whatever the outcome. Stored and both kinds of duplicate are a 200 with the typed result.
 */
export async function finalizeUploadRoute(env: FinalizeEnv, input: FinalizeInput): Promise<NextResponse> {
  const session = await env.session();
  if (!session) return unauthorized();
  const path = typeof input.path === 'string' ? input.path : '';
  if (!INCOMING_PATH.test(path)) return json({ error: 'That is not an upload path from this page.' }, 400);
  const kind = UPLOAD_KINDS.find((k) => k === input.kind);
  if (!kind) return json({ error: KIND_REQUIRED }, 400);
  const name = typeof input.name === 'string' ? input.name : '';
  try {
    let bytes: Buffer;
    try {
      bytes = await env.download(path);
    } catch {
      return json({ kind: 'failed', reason: 'The upload did not reach storage, so there is nothing to add. Try the file again.' }, 404);
    }
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return json({ kind: 'too_large', reason: OVERSIZE_MESSAGE }, 413);
    if (bytes.byteLength === 0) return json({ kind: 'unsupported', reason: 'The file is empty.' }, 415);
    const mime = sniffMime(bytes, name);
    if (!mime) return json({ kind: 'unsupported', reason: 'Field Notes takes HEIC, HEIF, JPEG, PNG or WebP photos.' }, 415);
    try {
      return json(await env.ingest({ bytes, mime, uploadedBy: session.email, kind }));
    } catch (error) {
      if (error instanceof UnsupportedImageError) return json({ kind: 'unsupported', reason: error.message }, 415);
      return json({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) }, 500);
    }
  } finally {
    await env.remove([path]).catch(() => undefined);
  }
}
