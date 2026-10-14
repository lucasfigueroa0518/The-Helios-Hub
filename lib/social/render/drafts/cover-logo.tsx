'use client';

import { ArrowRight } from 'lucide-react';

import type { SlideCopy } from '@/lib/social/render/types';

import { Fit, MIN, SpanRunView, type EyePath } from './blocks';

export const EYE_PATH: EyePath = [
  { id: '1', label: 'Entry', x: 54, y: 74 },
  { id: '2', label: 'Read', x: 42, y: 22 },
  { id: '3', label: 'Settle', x: 91, y: 47 },
];

export const RATIONALE =
  'A cream-or-charcoal monolith is bolted into the bottom-right of the canvas, bleeding off the right and bottom edges, so the company is a physical slab the claim stands on. The logo sits inside it at a confident size and the headline is set at full cover scale on the black above, its last baseline resting on the slab edge. The eye lands on the slab, climbs the claim, and settles on the arrow that sits on the slab edge.';

export function CoverLogoPremium({ slide }: { slide: SlideCopy }) {
  const plate = slide.logoPlate ?? 'light';
  return (
    <div className="helios-cover helios-v2-cover-logo" data-plate={plate}>
      <div className="helios-v2-cover-logo__spine" aria-hidden="true">HELIOS</div>

      <div className="helios-v2-cover-logo__claim">
        <Fit as="h1" className="helios-v2-cover-logo__headline" min={MIN.cover}>
          <SpanRunView run={slide.headline} />
        </Fit>
      </div>

      <div className="helios-v2-cover-logo__edge">
        {slide.photoCaption ? (
          <Fit as="p" className="helios-v2-cover-logo__caption" min={MIN.by}>
            {slide.photoCaption}
          </Fit>
        ) : (
          <span />
        )}
        <ArrowRight className="helios-v2-cover-logo__swipe" strokeWidth={2.25} aria-hidden="true" />
      </div>

      <div className={`helios-logo-card__plate helios-logo-card__plate--${plate} helios-v2-cover-logo__plate`} aria-hidden="true">
        <img
          className={`helios-photo helios-logo-card__logo${slide.logoWide ? ' helios-logo-card__logo--wide' : ''} helios-v2-cover-logo__logo`}
          src={slide.photoUrl}
          alt=""
          data-photo-kind="logo"
        />
      </div>
    </div>
  );
}
