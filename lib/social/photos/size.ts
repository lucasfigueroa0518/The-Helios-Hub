/**
 * Photo size floors (Tommy and Lucas, 2026-10-14). The short side of the
 * photo, in pixels:
 *   - the cover (a carousel's first slide, a Morning Download opener): 1080,
 *     so a full-bleed cover is never upscaled;
 *   - every other slide: 600 (the one floor the stock lanes already had);
 *     a logo is exempt there, since it sits small on a plate.
 * A size the source states is used as is; an unknown one (article and
 * official images rarely state a height) is read from the image itself.
 * Measured 2026-10-14 over a week of posts: 3 of 79 inner photos were under
 * 600, while every carousel had an inner photo of at least 1080.
 */
import sharp from 'sharp';

export const COVER_MIN_SHORT_SIDE = 1080;
export const SLIDE_MIN_SHORT_SIDE = 600;

/** The floor for a slot and lane; 0: no floor. */
export function minShortSide(slot: 'cover' | 'story' | 'stat' | 'quote', lane: string): number {
  if (slot === 'cover') return COVER_MIN_SHORT_SIDE;
  return lane === 'logo' ? 0 : SLIDE_MIN_SHORT_SIDE;
}

/** The image's pixel size, or null when it can't be read (a photo that won't load can't be shown either). */
export type SizeProbe = (url: string) => Promise<{ w: number; h: number } | null>;

/** Reads the image and its header (sharp). One read per URL per probe. */
export function createSizeProbe(http: typeof fetch = fetch): SizeProbe {
  const cache = new Map<string, Promise<{ w: number; h: number } | null>>();
  return (url) => {
    let hit = cache.get(url);
    if (!hit) {
      hit = (async () => {
        try {
          const res = await http(url, { headers: { 'User-Agent': 'HeliosSocial/1.0 (photo size check)' }, signal: AbortSignal.timeout(15_000) });
          if (!res.ok) return null;
          const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
          return meta.width && meta.height ? { w: meta.width, h: meta.height } : null;
        } catch {
          return null;
        }
      })();
      cache.set(url, hit);
    }
    return hit;
  };
}

/**
 * Does the photo clear its floor? Known size first; else the probe; no probe
 * (offline runs, tests) and an unknown size pass, as before this rule.
 */
export async function clearsFloor(photo: { url: string; width: number | null; height: number | null }, min: number, probe: SizeProbe | undefined): Promise<{ ok: boolean; size: string }> {
  if (min <= 0) return { ok: true, size: '' };
  let w = photo.width;
  let h = photo.height;
  if ((!w || !h) && probe) {
    const read = await probe(photo.url);
    if (!read) return { ok: false, size: "couldn't be read" };
    w = read.w;
    h = read.h;
  }
  if (!w || !h) return { ok: true, size: 'size unknown' };
  return { ok: Math.min(w, h) >= min, size: `${w}×${h}` };
}
