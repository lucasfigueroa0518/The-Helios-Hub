/**
 * The upload box's logic, apart from React: which files to send, one at a time, and what each answer
 * means in words. A file goes browser -> signed URL -> private storage, then a finalize request does the
 * rest on the server. `send` is injected so tests run it with no network.
 */
import type { PhotoUploadResponse } from '@/app/api/field-notes/photos/handler';
import { FACES_AUTO_LABEL, MAX_UPLOAD_BYTES, OVERSIZE_MESSAGE, resolveMime, type UploadKind } from '@/app/api/field-notes/photos/rules';

export { MAX_UPLOAD_BYTES };

/** Where a file is: waiting its turn, going to storage, being converted and checked, or finished. */
export type FileStage = 'queued' | 'uploading' | 'processing';
export type FileOutcome =
  | { state: 'done'; name: string; photoId: string; faces: boolean; note: string }
  | { state: 'duplicate'; name: string; exact: boolean; matchId: string; reason: string }
  | { state: 'failed'; name: string; reason: string };

export const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,.jpg,.jpeg,.png,.webp';

/** The near-duplicate threshold is 6 of 64 hash bits; say it as "same shot", not as a number. */
export function describeDuplicate(r: Extract<PhotoUploadResponse, { kind: 'duplicate_exact' | 'duplicate_near' }>): string {
  return r.kind === 'duplicate_exact'
    ? 'Exact duplicate: the same file is already in the photo bank.'
    : `Near duplicate: it looks like the same shot as a photo already in the pool (${r.distance} of 64 hash bits differ).`;
}

/** What the face check did to a stored photo, in words for its row. */
export function describeStored(r: Partial<Extract<PhotoUploadResponse, { kind: 'stored' }>>): { faces: boolean; note: string } {
  if (r.photoKind === 'people' && r.faces?.tagged) return { faces: true, note: `Done: added to the pool and tagged ${FACES_AUTO_LABEL}: a clear face was found.` };
  if (r.faces?.pending) return { faces: false, note: `Done: added to the pool. Faces are checked shortly after upload; a clear face shows as ${FACES_AUTO_LABEL}.` };
  if (r.faces && !r.faces.checked) return { faces: false, note: 'Done: added to the pool. The face check could not run, so it is not tagged Faces.' };
  return { faces: false, note: 'Done: added to the pool.' };
}

/** What to tell the person about one file, before anything is sent: null when it can go. */
export function precheck(file: { name: string; type: string; size: number }): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return OVERSIZE_MESSAGE;
  if (!resolveMime(file.name, file.type)) return 'Field Notes takes HEIC, HEIF, JPEG, PNG or WebP photos.';
  return null;
}

export function outcomeOf(name: string, status: number, json: unknown): FileOutcome {
  const r = json as Partial<PhotoUploadResponse> & { error?: string };
  if (r.kind === 'stored') return { state: 'done', name, photoId: r.photoId!, ...describeStored(r as Extract<PhotoUploadResponse, { kind: 'stored' }>) };
  if (r.kind === 'duplicate_exact' || r.kind === 'duplicate_near') return { state: 'duplicate', name, exact: r.kind === 'duplicate_exact', matchId: r.matchId!, reason: describeDuplicate(r as never) };
  if (r.kind === 'too_large') return { state: 'failed', name, reason: OVERSIZE_MESSAGE };
  if (status === 413) return { state: 'failed', name, reason: OVERSIZE_MESSAGE };
  const reason = (r as { reason?: string }).reason ?? r.error ?? `The upload failed (${status}).`;
  return { state: 'failed', name, reason };
}

/** What the person says a photo shows. Faces are never picked: the server finds them. */
export type PhotoTags = { kind: UploadKind };
/** A file waiting to go, with the kind the person chose for it. */
export type UploadItem = { file: File; kind: UploadKind };

/** `onStage` is told when the file starts going to storage and when the server starts processing it. */
export type SendFile = (file: File, tags: PhotoTags, onStage: (stage: 'uploading' | 'processing') => void) => Promise<{ status: number; json: unknown }>;

/**
 * One file at a time, in order, so a failure on one never loses the rest. `onStage` reports each file
 * moving through uploading and processing; `onOutcome` is called as each finishes.
 */
export async function uploadFiles(
  items: UploadItem[],
  send: SendFile,
  onOutcome: (index: number, outcome: FileOutcome) => void,
  onStage: (index: number, stage: FileStage) => void = () => undefined,
): Promise<FileOutcome[]> {
  const done: FileOutcome[] = [];
  for (let i = 0; i < items.length; i++) {
    const { file, kind } = items[i]!;
    const refusal = precheck(file);
    let outcome: FileOutcome;
    if (refusal) {
      outcome = { state: 'failed', name: file.name, reason: refusal };
    } else {
      try {
        const { status, json } = await send(file, { kind }, (stage) => onStage(i, stage));
        outcome = outcomeOf(file.name, status, json);
      } catch (error) {
        outcome = { state: 'failed', name: file.name, reason: error instanceof Error ? error.message : String(error) };
      }
    }
    done.push(outcome);
    onOutcome(i, outcome);
  }
  return done;
}

const postJson = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

/** Sign, PUT to storage, finalize. A problem at any step comes back as the typed failure the box shows. */
export const sendFile: SendFile = async (file, tags, onStage) => {
  const signed = await postJson('/api/field-notes/photos/sign', { name: file.name, type: file.type, size: file.size });
  if (signed.status !== 200) return signed;
  const { path, uploadUrl } = signed.json as { path: string; uploadUrl: string };
  onStage('uploading');
  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', file);
  const put = await fetch(uploadUrl, { method: 'PUT', body: form, headers: { 'x-upsert': 'false' } });
  if (!put.ok) return { status: put.status, json: { kind: 'failed', reason: `The photo did not reach storage (${put.status}). Try it again.` } };
  onStage('processing');
  return postJson('/api/field-notes/photos/finalize', { path, name: file.name, kind: tags.kind });
};
