import { uploadFrameObject } from '@/lib/reels/visual/storage';

/**
 * Keep the clean Kling clip (the video before its words) beside the composed reel, so a wording
 * revision can re-lay new text over it instead of double-burning the old words. The key mirrors
 * rawKeyFor (lib/revisions/descriptions/text-on-screen.ts): `<dir>/reel.mp4` -> `<dir>/raw.mp4`.
 * Best effort: a failure here is logged and never touches the reel run.
 */
export function cleanClipKey(videoPath: string): string | null {
  const m = /^(.*)\/reel\.mp4$/.exec(videoPath);
  return m ? `${m[1]}/raw.mp4` : null;
}

export async function keepCleanClip(
  videoPath: string,
  bytes: Buffer,
  upload: (key: string, body: Buffer, contentType: string) => Promise<void> = uploadFrameObject,
  log: (line: string) => void = (line) => console.warn(line),
): Promise<boolean> {
  try {
    const key = cleanClipKey(videoPath);
    if (!key) return false;
    await upload(key, bytes, 'video/mp4');
    return true;
  } catch (error) {
    try {
      log(`reels video: could not keep the clean clip beside ${videoPath}: ${error instanceof Error ? error.message : String(error)}`);
    } catch {
      /* logging must never fail the run */
    }
    return false;
  }
}
