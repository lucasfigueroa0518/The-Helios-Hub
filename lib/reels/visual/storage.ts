import { bucketSignedUrl, isRetryableUploadStatus, mediaBucket } from '@/lib/media-bucket';

/**
 * Trial Reels' private `reels-frames` bucket (background stills, Kling videos,
 * song previews) on the shared Supabase Storage client (lib/media-bucket.ts).
 * Signed links let Fal and Meta fetch an object; the bucket stays private.
 */
const frames = mediaBucket('reels-frames');

export { isRetryableUploadStatus };

/** The `/storage/v1` prefix fix for signed paths (lib/media-bucket.ts). */
export const frameSignedUrl = bucketSignedUrl;

export function uploadFrameObject(objectPath: string, body: Buffer, contentType = 'image/png'): Promise<void> {
  return frames.upload(objectPath, body, contentType);
}

/** Short-lived URL so Fal (or Meta) can fetch the object. */
export function signFrameObject(objectPath: string, expiresIn = 3600): Promise<string> {
  return frames.sign(objectPath, expiresIn);
}

export function downloadFrameObject(objectPath: string): Promise<Buffer> {
  return frames.download(objectPath);
}

/** Hard-delete objects (D-141). Missing objects are not an error. */
export function deleteFrameObjects(objectPaths: string[]): Promise<void> {
  return frames.remove(objectPaths);
}
