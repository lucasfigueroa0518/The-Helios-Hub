'use client';

import { ArrowRight } from 'lucide-react';

import type { SlideCopy } from '@/lib/social/render/types';

import { Fit, MIN, RegionPhoto, SpanRunView, type EyePath } from './blocks';

export const EYE_PATH: EyePath = [
  { id: '1', label: 'Entry', x: 50, y: 28 },
  { id: '2', label: 'Read', x: 40, y: 67 },
  { id: '3', label: 'Settle', x: 92, y: 90 },
];

export const RATIONALE =
  'The face gets its own full-width region across the top with nothing on it. The claim sits below on the canvas at full cover size, so the eye goes from the person to what they did. A footer row carries the HELIOS mark, the optional name line and the swipe arrow.';

export function CoverSplitPremium({ slide }: { slide: SlideCopy }) {
  return (
    <div className="helios-cover helios-v2-cover-split">
      <RegionPhoto slide={slide} className="helios-cover__photo helios-v2-cover-split__photo" />
      <div className="helios-v2-cover-split__claim">
        <Fit as="h1" className="helios-v2-cover-split__headline" min={MIN.cover}>
          <SpanRunView run={slide.headline} />
        </Fit>
      </div>
      <div className="helios-v2-cover-split__foot">
        <span className="helios-v2-cover-split__mark" aria-hidden="true">HELIOS</span>
        {slide.photoCaption ? (
          <Fit as="p" className="helios-v2-cover-split__caption" min={MIN.by}>
            {slide.photoCaption}
          </Fit>
        ) : (
          <span className="helios-v2-cover-split__gap" />
        )}
        <ArrowRight className="helios-v2-cover-split__swipe" strokeWidth={2.25} aria-hidden="true" />
      </div>
    </div>
  );
}
