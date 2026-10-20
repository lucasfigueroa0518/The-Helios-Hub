/**
 * The meme cover's composition from the meme's shape (width / height). A meme wide enough to leave the hook its
 * room runs full bleed across the top at its own height; a squarer or taller one sits whole as a rounded card on the
 * slide, as tall as the hook allows. The hook banner takes whatever height is left, its type sized to that room.
 * Never a plate or band around the meme.
 */
export const LFD_COVER = { w: 1080, h: 1350, copyMin: 330, margin: 48 } as const;
export function lfdCoverMemeBox(aspect: number | undefined): { fit: 'bleed' | 'card'; w: number; h: number; areaH: number; copy: 'l' | 'm' | 's' } {
  const a = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : LFD_COVER.w / 900;
  const maxH = LFD_COVER.h - LFD_COVER.copyMin;
  let fit: 'bleed' | 'card';
  let w: number;
  let h: number;
  let areaH: number;
  if (LFD_COVER.w / a <= maxH) {
    fit = 'bleed';
    w = LFD_COVER.w;
    h = Math.round(LFD_COVER.w / a);
    areaH = h;
  } else {
    fit = 'card';
    const boxW = LFD_COVER.w - 2 * LFD_COVER.margin;
    const boxH = maxH - LFD_COVER.margin;
    h = Math.min(boxH, Math.round(boxW / a));
    w = Math.round(h * a);
    areaH = maxH;
  }
  const copyH = LFD_COVER.h - areaH;
  return { fit, w, h, areaH, copy: copyH >= 600 ? 'l' : copyH >= 450 ? 'm' : 's' };
}
