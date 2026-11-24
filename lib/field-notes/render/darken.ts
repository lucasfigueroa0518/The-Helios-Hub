/**
 * The photo treatment behind the text (CONTRACT-v4 section 6): a gentle black overlay, full strength over
 * the text block (its `core`) and fading smoothly to nothing `feather` px around it. Feathered, never a box.
 * Baked into the photo here (the browser shows the darkened JPEG), so the readability check and the
 * rendered-pixel check measure exactly the pixels the reader sees.
 */
import type { Rect } from '../types';
import type { RawImage } from './contrast';
import type { PreparedPhoto } from './photo';

export type DarkenZone = { core: Rect; feather: number };

/** Overlay strength (0-1) at a canvas pixel for `darken` over `zone`: `darken` inside the core, smoothstep down to 0 across the feather. */
export function darkenAt(x: number, y: number, zone: DarkenZone, darken: number): number {
  const { core, feather } = zone;
  const dx = Math.max(core.x - x, 0, x - (core.x + core.w));
  const dy = Math.max(core.y - y, 0, y - (core.y + core.h));
  const d = Math.hypot(dx, dy);
  if (d <= 0) return darken;
  if (feather <= 0 || d >= feather) return 0;
  const t = d / feather;
  return darken * (1 - t * t * (3 - 2 * t));
}

/** The raw pixels under the overlay (sRGB compositing, as the browser draws a black layer at that opacity). */
export function applyDarkenRaw(raw: RawImage, zone: DarkenZone, darken: number): RawImage {
  const out = new Uint8Array(raw.data);
  if (darken <= 0) return { ...raw, data: out };
  const { core, feather } = zone;
  const y0 = Math.max(0, Math.floor(core.y - feather));
  const y1 = Math.min(raw.height, Math.ceil(core.y + core.h + feather));
  const x0 = Math.max(0, Math.floor(core.x - feather));
  const x1 = Math.min(raw.width, Math.ceil(core.x + core.w + feather));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const m = darkenAt(x + 0.5, y + 0.5, zone, darken);
      if (m <= 0) continue;
      const k = 1 - m;
      const i = (y * raw.width + x) * raw.channels;
      for (let c = 0; c < Math.min(3, raw.channels); c++) out[i + c] = Math.round(raw.data[i + c]! * k);
    }
  }
  return { ...raw, data: out };
}

/** The prepared photo with the overlay baked in (JPEG re-encoded from the darkened pixels). */
export async function darkenPhoto(photo: PreparedPhoto, zone: DarkenZone, darken: number): Promise<PreparedPhoto> {
  if (darken <= 0) return photo;
  const raw = applyDarkenRaw(photo.raw, zone, darken);
  const sharp = (await import('sharp')).default;
  const jpeg = await sharp(Buffer.from(raw.data), { raw: { width: raw.width, height: raw.height, channels: raw.channels } })
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toBuffer();
  return { ...photo, jpeg, raw };
}
