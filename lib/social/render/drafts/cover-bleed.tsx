'use client';

import { ArrowRight } from 'lucide-react';

import type { SlideCopy } from '@/lib/social/render/types';

import { BleedPhoto, Fit, MIN, SpanRunView, type EyePath } from './blocks';

export const EYE_PATH: EyePath = [
  { id: '1', label: 'Entry', x: 40, y: 58 },
  { id: '2', label: 'Read', x: 40, y: 72 },
  { id: '3', label: 'Settle', x: 14, y: 89 },
];

export const RATIONALE =
  'The scene photo fills the slide and a single dark fade rises from the bottom edge. The claim is set at full cover size, left-aligned, low in the frame so it lands inside the grid crop. The eye reads the claim top to bottom and settles on the swipe arrow.';

export function CoverBleedPremium({ slide }: { slide: SlideCopy }) {
  return (
    <div className="helios-cover helios-v2-cover-bleed">
      <BleedPhoto slide={slide} />
      <div className="helios-v2-cover-bleed__scrim" data-scrim="gradient" aria-hidden="true" />
      <div className="helios-v2-cover-bleed__mark" aria-hidden="true">HELIOS</div>
      <div className="helios-v2-cover-bleed__claim">
        <Fit as="h1" className="helios-v2-cover-bleed__headline" min={MIN.cover}>
          <SpanRunView run={slide.headline} />
        </Fit>
      </div>
      <ArrowRight className="helios-v2-cover-bleed__swipe" strokeWidth={2.25} aria-hidden="true" />
    </div>
  );
}
