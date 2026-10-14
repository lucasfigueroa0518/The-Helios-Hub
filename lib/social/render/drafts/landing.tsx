'use client';

import type { CSSProperties } from 'react';

import type { SlideCopy, Span, SpanRun } from '@/lib/social/render/types';

import { Fit, MIN, RegionPhoto, SpanRunView, type EyePath } from './blocks';

/** Entry: the verb that dwarfs the line. Read: the lead it lands on. Settle: the small body/note after the black pause. */
export const EYE_PATH: EyePath = [
  { id: '1', label: 'Entry', x: 45, y: 43 },
  { id: '2', label: 'Read', x: 22, y: 31 },
  { id: '3', label: 'Settle', x: 27, y: 88 },
];

export const RATIONALE =
  'One word dwarfs the line: the hook verb is set at roughly three times the size of the words around it and stands, baseline flush, on a ground that runs edge to edge (a slim wide scene strip, or a single hairline when there is no photo). Below the ground is a long pause of empty canvas, and only then the small body and note, left-aligned and quiet. The eye hits the orange verb, reads the lead above it, then drops through the black to the settle at bottom left; the whole beat survives the grid crop.';

/** Rough advance width, in em, of Pragmatica Extended Bold: used only to size the verb to the measure. The fitter shrinks if this over-estimates. */
const NARROW = "iljtfI1.,;:'!| ";
const WIDE = 'mwMW@';
function widthEm(text: string): number {
  let w = 0;
  for (const ch of text.trim()) {
    if (NARROW.includes(ch)) w += 0.34;
    else if (WIDE.includes(ch)) w += 0.95;
    else if (ch >= 'A' && ch <= 'Z') w += 0.8;
    else w += 0.62;
  }
  return w;
}

const BASE_PX = 120;
const MEASURE_PX = 840;
const MAX_SCALE = 3;
const MIN_SCALE = 1.25;

function verbScale(text: string): number {
  const raw = MEASURE_PX / (Math.max(widthEm(text), 1) * BASE_PX);
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
}

const DESCENDERS = /[gjpqy,;()]/;

function HeadlineRun({ run }: { run: SpanRun }) {
  const verbIndex = run.findIndex((s) => s.role === 'hook');
  return (
    <>
      {run.map((s: Span, i: number) => {
        if (i === verbIndex) {
          const style: CSSProperties = { fontSize: `${verbScale(s.text).toFixed(3)}em` };
          return (
            <span key={i} className="helios-span helios-span--hook helios-v2-landing__verb" data-descender={DESCENDERS.test(s.text) ? 'true' : 'false'} style={style}>
              {s.text.trim()}
            </span>
          );
        }
        // A second hook would be a second accent: it keeps its emphasis as weight, not colour.
        const role = s.role === 'hook' ? 'narrative' : s.role;
        return (
          <span key={i} className={`helios-span helios-span--${role} helios-v2-landing__lead`}>
            {s.text}
          </span>
        );
      })}
    </>
  );
}

function BodyRun({ run }: { run: SpanRun }) {
  return (
    <>
      {run.map((s: Span, i: number) => (
        <span key={i} className={`helios-span helios-span--${s.role === 'hook' ? 'narrative' : s.role}${s.role === 'hook' ? ' helios-v2-landing__stress' : ''}`}>
          {s.text}
        </span>
      ))}
    </>
  );
}

export function LandingSlidePremium({ slide }: { slide: SlideCopy }) {
  const hasPhoto = !!slide.photoUrl;
  const headline = slide.headline && slide.headline.length > 0 ? slide.headline : undefined;
  const hasVerb = !!headline && headline.some((s) => s.role === 'hook');
  const verb = headline?.find((s) => s.role === 'hook');
  const lastIsVerb = !!headline && headline[headline.length - 1] === verb;
  return (
    <div className="helios-v2-landing" data-has-photo={hasPhoto ? 'true' : 'false'} data-verb={hasVerb ? 'true' : 'false'} data-verb-last={lastIsVerb ? 'true' : 'false'}>
      <div className="helios-v2-landing__stage">
        <Fit as="h1" className="helios-v2-landing__headline" min={MIN.landing}>
          {headline ? (hasVerb ? <HeadlineRun run={headline} /> : <SpanRunView run={headline} />) : null}
        </Fit>
      </div>

      {hasPhoto ? <RegionPhoto slide={slide} className="helios-v2-split__photo helios-v2-landing__strip" /> : <div className="helios-v2-landing__ground" aria-hidden="true" />}
      {hasPhoto ? <div className="helios-v2-landing__strip-scrim" data-scrim="gradient" aria-hidden="true" /> : null}

      {slide.body || slide.note ? (
        <div className="helios-v2-landing__coda">
          {slide.body ? (
            <Fit as="p" className="helios-v2-landing__body" min={MIN.body}>
              <BodyRun run={slide.body} />
            </Fit>
          ) : null}
          {slide.note ? (
            <Fit as="p" className="helios-v2-landing__note" min={MIN.note}>
              {slide.note}
            </Fit>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
