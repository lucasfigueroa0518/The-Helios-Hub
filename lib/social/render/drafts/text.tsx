'use client';

import type { SlideCopy } from '@/lib/social/render/types';

import { Fit, MIN, RegionPhoto, SpanRunView, type EyePath } from './blocks';

/**
 * Drawn for text-photo-below (the commonest mode): the monumental headline
 * (its orange last line) is the entry, the hung body on the page axis is the
 * read, the photo band is the settle. The other three modes keep the same headline -> body
 * order; only the photo band and the anchor move.
 */
export const EYE_PATH: EyePath = [
  { id: '1', label: 'Entry', x: 60, y: 23 },
  { id: '2', label: 'Read', x: 68, y: 38 },
  { id: '3', label: 'Settle', x: 45, y: 76 },
];

export const RATIONALE =
  'A hard scale cliff: the headline is set monumental and the body drops to a small column hung on the page axis (x = 540) under the headline, like a footnote to it. The photo is a cropped band that bleeds off one canvas edge while its other edge lands on a type margin, so the picture is built from the same grid as the words. Without a photo, the headline is the architecture and the body hangs from the same axis, anchored top or low. The eye lands on the headline, steps right onto the axis to read, and settles on the band edge.';

type Mode = 'photo-below' | 'photo-top' | 'only-top' | 'only-low';

function modeOf(slide: SlideCopy): Mode {
  if (slide.photoUrl) return slide.photoPlacement === 'top' ? 'photo-top' : 'photo-below';
  return slide.textAnchor === 'bottom' ? 'only-low' : 'only-top';
}

function Plate({ slide }: { slide: SlideCopy }) {
  return (
    <div className="helios-v2-text__plate">
      <RegionPhoto slide={slide} className="helios-v2-split__photo helios-v2-text__photo" />
      <div className="helios-v2-text__scrim" data-scrim="gradient" aria-hidden="true" />
    </div>
  );
}

export function TextSlidePremium({ slide }: { slide: SlideCopy }) {
  const mode = modeOf(slide);
  const hasBottom = !!slide.bodyBottom && slide.bodyBottom.length > 0;
  // Type may overlap the photo edge only for scene photography; a person or a logo stays in its own region.
  const lap = mode === 'photo-top' && (slide.photoKind ?? 'scene') === 'scene';
  const root = ['helios-v2-text', `helios-v2-text--${mode}`, hasBottom ? 'helios-v2-text--has-bottom' : '', lap ? 'helios-v2-text--lap' : '']
    .filter(Boolean)
    .join(' ');

  const copy = (
    <div className="helios-v2-text__copy">
      {slide.headline && slide.headline.length > 0 ? (
        <Fit as="h2" className="helios-v2-text__headline" min={MIN.headline}>
          <SpanRunView run={slide.headline} />
        </Fit>
      ) : null}
      {slide.body && slide.body.length > 0 ? (
        <Fit as="p" className="helios-v2-text__body" min={MIN.body}>
          <SpanRunView run={slide.body} />
        </Fit>
      ) : null}
      {mode !== 'photo-below' && hasBottom ? (
        <Fit as="p" className="helios-v2-text__body helios-v2-text__body--second" min={MIN.body}>
          <SpanRunView run={slide.bodyBottom} />
        </Fit>
      ) : null}
    </div>
  );

  return (
    <div className={root} data-text-mode={mode}>
      {mode === 'photo-top' ? <Plate slide={slide} /> : null}
      {copy}
      {mode === 'photo-below' ? <Plate slide={slide} /> : null}
      {mode === 'photo-below' && hasBottom ? (
        <Fit as="p" className="helios-v2-text__body helios-v2-text__body--foot" min={MIN.body}>
          <SpanRunView run={slide.bodyBottom} />
        </Fit>
      ) : null}
    </div>
  );
}
