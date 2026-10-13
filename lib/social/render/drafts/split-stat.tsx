'use client';

import type { CSSProperties } from 'react';

import type { SlideCopy, SpanRun } from '@/lib/social/render/types';

import { Fit, MIN, type EyePath } from './blocks';

export const EYE_PATH: EyePath = [
  { id: '1', label: 'Entry', x: 30, y: 19 },
  { id: '2', label: 'Read', x: 52, y: 46 },
  { id: '3', label: 'Settle', x: 30, y: 76 },
];

export const RATIONALE =
  'Two counts stacked on a left measuring line: the first number sits small and white up top, the second is set at roughly twice its size, nearly edge to edge, and carries the only orange on the slide. The eye drops from the small number, down the axis, into the giant one, so the jump in scale is the comparison; the notes hang off each number like axis labels. The framing headline and context line sit at the foot as the settle, below the point of the Instagram grid crop.';

/** Rough advance width, in em, of Pragmatica Extended Bold at -0.045em tracking. Only seeds the starting size; the fitter does the exact work. */
function emWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (/[0-9]/.test(ch)) w += 0.8;
    else if (ch === '%') w += 1.0;
    else if (ch === ',' || ch === '.') w += 0.36;
    else if (ch === ' ') w += 0.36;
    else if (/[A-Z$€£]/.test(ch)) w += 0.84;
    else w += 0.74;
    w -= 0.045;
  }
  return Math.max(w, 0.6);
}

const runText = (run: SpanRun | undefined): string => (run ?? []).map((s) => s.text).join('');

/** The accent is the second number's alone, so a hook span anywhere else reads as narrative on this slide. */
function Spans({ run }: { run: SpanRun | undefined }) {
  if (!run) return null;
  return (
    <>
      {run.map((span, i) => (
        <span key={i} className={`helios-span helios-span--${span.role === 'hook' ? 'narrative' : span.role}`}>
          {span.text}
        </span>
      ))}
    </>
  );
}

const BIG_W = 924;
const BIG_MAX = 420;
const SMALL_W = 420;
const SMALL_MAX = 190;

export function SplitStatSlidePremium({ slide }: { slide: SlideCopy }) {
  const first = runText(slide.title);
  const second = slide.secondNumber ?? '';
  const bigPx = Math.min(BIG_MAX, Math.floor(BIG_W / emWidth(second)));
  const smallPx = Math.max(MIN.splitNumber, Math.min(SMALL_MAX, Math.floor(SMALL_W / emWidth(first)), Math.round(bigPx * 0.5)));
  const style = { '--v2-split-a': `${smallPx}px`, '--v2-split-b': `${bigPx}px` } as CSSProperties;

  return (
    <div className="helios-v2-split-stat" style={style}>
      <div className="helios-v2-split-stat__axis" aria-hidden="true">
        <span className="helios-v2-split-stat__tick helios-v2-split-stat__tick--a" />
        <span className="helios-v2-split-stat__tick helios-v2-split-stat__tick--b" />
      </div>

      <div className="helios-v2-split-stat__first">
        <Fit className="helios-v2-split-stat__num-a" min={MIN.splitNumber}>
          <Spans run={slide.title} />
        </Fit>
        {slide.numberNote && (
          <Fit as="p" className="helios-v2-split-stat__note-a" min={MIN.note}>
            {slide.numberNote}
          </Fit>
        )}
      </div>

      <div className="helios-v2-split-stat__second">
        <Fit className="helios-v2-split-stat__num-b" min={MIN.splitNumber}>
          {second}
        </Fit>
        {slide.secondNote && (
          <Fit as="p" className="helios-v2-split-stat__note-b" min={MIN.note}>
            {slide.secondNote}
          </Fit>
        )}
      </div>

      <div className="helios-v2-split-stat__foot">
        {slide.headline && (
          <Fit as="h2" className="helios-v2-split-stat__headline" min={MIN.headline}>
            <Spans run={slide.headline} />
          </Fit>
        )}
        {slide.body && (
          <Fit as="p" className="helios-v2-split-stat__body" min={MIN.body}>
            <Spans run={slide.body} />
          </Fit>
        )}
      </div>
    </div>
  );
}
