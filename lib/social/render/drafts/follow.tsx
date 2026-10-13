'use client';

import { CornerRightDown } from 'lucide-react';

import type { SlideCopy } from '@/lib/social/render/types';

import { Fit, MIN, type EyePath } from './blocks';

export const EYE_PATH: EyePath = [
  { id: '1', label: 'Entry', x: 24, y: 32 },
  { id: '2', label: 'Read', x: 88, y: 65 },
  { id: '3', label: 'Settle', x: 50, y: 74 },
];

export const RATIONALE =
  'A hard rule bleeds in from the left edge and turns into an elbow arrow at the right margin. The story\'s closing line sits on top of the rule, the follow handle hangs below it at full measure in the single orange. The eye reads the line, rides the rule to the arrow, and drops onto the handle; the HELIOS wordmark signs off at the foot with full clear space.';

const HANDLE = '@heliosgroup.ai';

export function FollowSlidePremium({ slide }: { slide: SlideCopy }) {
  return (
    <div className="helios-v2-follow">
      <div className="helios-v2-follow__story">
        <Fit as="p" className="helios-v2-follow__line" min={MIN.headline}>
          {slide.storySpecificLine ?? ''}
        </Fit>
      </div>
      <div className="helios-v2-follow__rule" aria-hidden="true">
        <span className="helios-v2-follow__rule-bar" />
        <CornerRightDown className="helios-v2-follow__elbow" width={120} height={120} strokeWidth={1.6} absoluteStrokeWidth={false} />
      </div>
      <div className="helios-v2-follow__ask">
        <Fit as="p" className="helios-v2-follow__handle" min={MIN.headline}>
          {HANDLE}
        </Fit>
      </div>
      <div className="helios-v2-follow__sign" aria-hidden="true">
        HELIOS
      </div>
    </div>
  );
}
