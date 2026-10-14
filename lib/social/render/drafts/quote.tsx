'use client';

import { Backdrop, Fit, MIN, RegionPhoto, SpanRunView, type EyePath } from './blocks';
import type { SlideCopy, SpanRun } from '@/lib/social/render/types';

/**
 * One path for all three modes. In the speaker mode the portrait column stands on the
 * right edge; the eye still enters on the mark and the first line at the left hairline.
 */
export const EYE_PATH: EyePath = [
  { id: '1', label: 'Entry', x: 20, y: 30 },
  { id: '2', label: 'Read', x: 40, y: 54 },
  { id: '3', label: 'Settle', x: 22, y: 77 },
];

export const RATIONALE =
  'The quote is the architecture: one vertical hairline hangs from an oversized opening mark, the words sit against it at the largest size the box allows, and the attribution is the point where the hairline ends. The mark is the entry, the quote is the read, the mono name closes the line and settles the eye. In the speaker mode the same hairline structure holds and the verified face is a tall, narrow column of its own beside the words, never under them.';

type Mode = 'speaker' | 'backdrop' | 'type';

const textOf = (run: SpanRun | undefined): number => (run ? run.reduce((n, s) => n + s.text.length, 0) : 0);

/** Size tier by quote length. CSS owns the pixel size per tier (the fitter resets inline sizes). */
function tierOf(chars: number): number {
  if (chars <= 28) return 1;
  if (chars <= 56) return 2;
  if (chars <= 96) return 3;
  if (chars <= 150) return 4;
  if (chars <= 220) return 5;
  return 6;
}

function modeOf(slide: SlideCopy): Mode {
  if (!slide.photoUrl) return 'type';
  return slide.photoIsSpeaker === true ? 'speaker' : 'backdrop';
}

export function QuoteSlidePremium({ slide }: { slide: SlideCopy }) {
  const mode = modeOf(slide);
  const tier = tierOf(textOf(slide.quoteText));
  const hasHook = !!slide.quoteText?.some((s) => s.role === 'hook');
  const hasBody = !!slide.body && slide.body.length > 0;
  // The speaker's role follows the name unless there is a verified photo of them, or the name already carries it (photo spec §4).
  const role = mode !== 'speaker' && slide.quoteRole && !slide.quoteBy?.toLowerCase().includes(slide.quoteRole.toLowerCase()) ? slide.quoteRole : null;

  return (
    <div className={`helios-v2-quote helios-v2-quote--${mode}`}>
      {mode === 'backdrop' && (
        <>
          <Backdrop slide={slide} />
          <div className="helios-v2-quote__scrim" data-scrim="gradient" aria-hidden="true" />
        </>
      )}

      {slide.headline && slide.headline.length > 0 && (
        <Fit as="h2" className="helios-v2-quote__headline" min={MIN.headline}>
          <SpanRunView run={slide.headline} />
        </Fit>
      )}

      <div className="helios-v2-quote__stage">
        <div className="helios-v2-quote__main">
          <div className={`helios-v2-quote__mark${hasHook ? '' : ' helios-v2-quote__mark--hook'}`} aria-hidden="true">
            <span>{'“'}</span>
          </div>
          <div className="helios-v2-quote__group">
            <Fit as="blockquote" className={`helios-v2-quote__text helios-v2-quote__text--t${tier}`} min={MIN.quote}>
              <SpanRunView run={slide.quoteText} />
            </Fit>
            {(slide.quoteBy || role) && (
              <Fit as="p" className="helios-v2-quote__by" min={MIN.by}>
                {slide.quoteBy && <span className="helios-v2-quote__name">{slide.quoteBy}</span>}
                {role && <span className="helios-v2-quote__role">{role}</span>}
              </Fit>
            )}
            {hasBody && (
              <Fit as="p" className="helios-v2-quote__context" min={MIN.body}>
                <SpanRunView run={slide.body} />
              </Fit>
            )}
          </div>
        </div>

        {mode === 'speaker' && (
          <div className="helios-v2-quote__face">
            <RegionPhoto slide={slide} className="helios-v2-quote__speaker helios-quote__speaker" />
          </div>
        )}
      </div>
    </div>
  );
}
