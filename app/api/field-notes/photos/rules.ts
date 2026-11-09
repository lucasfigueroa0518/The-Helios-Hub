/** Upload rules shared by the routes and the upload box. Pure: no imports, safe in a client bundle. */

/**
 * Photos go browser -> private storage on a signed URL, so the Vercel 4.5 MB request-body cap does not
 * apply. The finalize step downloads the file on the server, so this is a memory and time limit.
 */
export const MAX_UPLOAD_BYTES = 25_000_000;

export const OVERSIZE_MESSAGE = 'This file is over 25 MB. Export a smaller copy and add it again.';

/** Where a file waits between the browser upload and finalize. Finalize accepts only this shape. */
export const INCOMING_PREFIX = 'incoming/field-notes/';
export const INCOMING_PATH = /^incoming\/field-notes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What each stored `kind` is called on screen. `people` is stored as such and shown as "Faces". */
export const PHOTO_KIND_LABEL = { working: 'Working', scenery: 'Scenery', people: 'Faces', event: 'Event' } as const;

/**
 * The kinds a person picks at upload. Faces is never picked: the worker's face check (lib/field-notes/photos/faces-worker.ts)
 * tags a photo `people` on its own when it clearly shows a face, and only then.
 */
export const UPLOAD_KINDS = ['working', 'scenery', 'event'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** How an automatically tagged `people` photo is shown in the pool. */
export const FACES_AUTO_LABEL = 'Faces (auto)';

/** How a photo whose face check has not run yet is shown in the pool (the worker checks it shortly after upload). */
export const FACES_CHECKING_LABEL = 'Checking for faces…';

/** Said in the upload box: how Faces get tagged. */
export const FACES_NOTICE = 'Faces are found automatically shortly after upload: a photo where a face is large and clear is tagged Faces (auto) and can be the first slide.';

/** Said in the upload box: nothing is screened on the way in. */
export const POSTING_NOTICE = 'Assume every photo you add may be posted publicly. Only add photos you are happy to see on Instagram.';

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const BY_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' };

/** The upload's media type: the declared one, else the file extension (browsers send none for HEIC). */
export function resolveMime(name: string, declared: string): string | null {
  const d = declared.toLowerCase().trim();
  if (ACCEPTED.has(d)) return d;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return (d === '' || d === 'application/octet-stream') && BY_EXTENSION[ext] ? BY_EXTENSION[ext]! : null;
}
