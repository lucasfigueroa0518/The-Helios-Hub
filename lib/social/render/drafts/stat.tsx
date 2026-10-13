'use client';

import type { SlideCopy } from '@/lib/social/render/types';

import { Backdrop, Fit, MIN, SpanRunView, type EyePath } from './blocks';

export const EYE_PATH: EyePath = [
  { id: '1', label: 'Entry', x: 50, y: 48 },
  { id: '2', label: 'Read', x: 25, y: 69 },
  { id: '3', label: 'Settle', x: 28, y: 89 },
];

export const RATIONALE =
  'The number is set so wide it nearly touches both margins, and a measuring scale runs beneath it as if the figure were being read off an instrument; the stat note sits on that scale as its caption. The label above stays small and cold so the squint test leaves one shape, and the context sentence is parked at the foot across a deliberate gap. The eye lands on the numeral in the middle of the grid crop, drops to the scale caption to learn what is being counted, then settles on the one-line consequence.';

export function StatSlidePremium({ slide }: { slide: SlideCopy }) {
  const hasPhoto = !!slide.photoUrl;
  return (
    <div className={`helios-v2-stat${hasPhoto ? ' helios-v2-stat--photo' : ''}`}>
      {hasPhoto ? (
        <>
          <Backdrop slide={slide} />
          <div className="helios-v2-stat__scrim" data-scrim="gradient" aria-hidden="true" />
        </>
      ) : null}
      <Fit as="h2" className="helios-v2-stat__label" min={MIN.headline}>
        <SpanRunView run={slide.headline} />
      </Fit>
      <div className="helios-v2-stat__figure">
        <Fit as="div" className="helios-v2-stat__number" min={MIN.number}>
          <SpanRunView run={slide.title} />
        </Fit>
        <div className="helios-v2-stat__scale" aria-hidden="true" />
        <Fit as="p" className="helios-v2-stat__note" min={MIN.note}>
          {slide.numberNote}
        </Fit>
      </div>
      <Fit as="p" className="helios-v2-stat__body" min={MIN.body}>
        <SpanRunView run={slide.body} />
      </Fit>
    </div>
  );
}
