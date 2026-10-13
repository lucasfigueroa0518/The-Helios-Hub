'use client';

import { ArrowRight } from 'lucide-react';

import type { SlideCopy } from '@/lib/social/render/types';

import { BleedPhoto, Fit, MIN, SpanRunView, type EyePath } from './blocks';

export const EYE_PATH: EyePath = [
  { id: '1', label: 'Entry', x: 64, y: 38 },
  { id: '2', label: 'Read', x: 38, y: 68 },
  { id: '3', label: 'Settle', x: 30, y: 82 },
];

export const RATIONALE =
  'The photograph is the whole slide; a single plumb line at the outer margin hangs the caption from the frame and thickens exactly where the headline sits, so type reads as a label on the picture rather than a card laid over it. The scrim is a wedge that hugs the caption corner and falls to nothing before the far side, so most of the scene stays untouched. The eye enters on the open scene, drops down the rule into the headline, and settles on the small caption line. On a panorama pair the rails sit on the outer margins and the left half carries one arrow toward the seam.';

export function ImageSlidePremium({ slide, spread }: { slide: SlideCopy; spread?: 'left' | 'right' }) {
  const band = slide.bleedText === 'top' ? 'top' : 'bottom';
  const classes = ['helios-v2-image', `helios-v2-image--${band}`, spread ? `helios-v2-image--spread-${spread}` : ''].filter(Boolean).join(' ');
  return (
    <div className={classes} data-fade={slide.fade === 'strong' ? 'strong' : 'normal'} data-band={band}>
      <BleedPhoto slide={slide} spread={spread} />
      <div className="helios-v2-image__rail" aria-hidden="true" />
      <div className="helios-v2-image__caption">
        <div className="helios-v2-image__fade" aria-hidden="true">
          <div className="helios-v2-image__scrim" data-scrim="gradient" />
        </div>
        {slide.headline ? (
          <div className="helios-v2-image__head">
            <Fit as="h2" className="helios-v2-image__headline" min={MIN.headline}>
              <SpanRunView run={slide.headline} />
            </Fit>
          </div>
        ) : null}
        {slide.body ? (
          <Fit as="p" className="helios-v2-image__body" min={MIN.body}>
            <SpanRunView run={slide.body} />
          </Fit>
        ) : null}
      </div>
      {spread === 'left' ? <ArrowRight className="helios-v2-image__swipe" aria-hidden="true" strokeWidth={1.5} /> : null}
    </div>
  );
}
