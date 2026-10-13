'use client';

import { ArrowRight } from 'lucide-react';

import type { SlideCopy } from '@/lib/social/render/types';

import { Fit, IconBackground, MIN, SpanRunView, type EyePath } from './blocks';

export const EYE_PATH: EyePath = [
  { id: '1', label: 'Entry', x: 40, y: 58 },
  { id: '2', label: 'Read', x: 40, y: 72 },
  { id: '3', label: 'Settle', x: 14, y: 89 },
];

export const RATIONALE =
  'No photo, so the claim is the whole slide: full cover size, left-aligned, low in the frame. The faint story icon sits behind it as atmosphere only. The eye reads the claim top to bottom and settles on the swipe arrow.';

export function CoverIconPremium({ slide }: { slide: SlideCopy }) {
  return (
    <div className="helios-cover helios-v2-cover-icon">
      <IconBackground slide={slide} cover />
      <div className="helios-v2-cover-icon__mark" aria-hidden="true">HELIOS</div>
      <div className="helios-v2-cover-icon__claim">
        <Fit as="h1" className="helios-v2-cover-icon__headline" min={MIN.cover}>
          <SpanRunView run={slide.headline} />
        </Fit>
      </div>
      <ArrowRight className="helios-v2-cover-icon__swipe" strokeWidth={2.25} aria-hidden="true" />
    </div>
  );
}
