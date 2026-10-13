import type { HubMedia } from '@/lib/social-hub/types';

/**
 * The images a Today's Content card steps through with its arrows: rendered
 * slides (or their photo when only the outline exists) and story frames.
 * `remote`: a third-party photo, loaded without a referrer.
 */
export function mediaFrames(media: HubMedia): Array<{ src: string; remote: boolean }> {
  if (media.kind === 'slides') {
    return media.slides.flatMap((s): Array<{ src: string; remote: boolean }> => (s.src ? [{ src: s.src, remote: false }] : s.photo ? [{ src: s.photo, remote: true }] : []));
  }
  if (media.kind === 'frames') return media.frames.flatMap((f): Array<{ src: string; remote: boolean }> => (f.src ? [{ src: f.src, remote: false }] : []));
  return [];
}
