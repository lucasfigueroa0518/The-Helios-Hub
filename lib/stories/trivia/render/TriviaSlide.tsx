import type { CSSProperties } from 'react';

import type { TriviaOption } from '@/lib/stories/trivia/types';

import { confettiPieces, CONFETTI_SEED } from './confetti';
import { arrowPaths, seedOf } from './pen';

/**
 * One AI Trivia slide, 1080×1920, as static markup for a HyperFrames composition (AT-33–AT-35):
 * built the way someone would in Instagram's own story editor (the Stories homemade style is the
 * reference): Classic text (Inter Medium) in the editor's highlight boxes, a quiz-sticker-like white
 * card for the choices, a pen-tool arrow. Everything sits level (AT-37: no tilt anywhere). No credit,
 * no logo, no decoration: the dimmed photo is the only backdrop.
 *
 *   question slide  exactly five elements: "AI Trivia", the question, the choices, "Tap to reveal",
 *                   and a pen arrow to the right of it, pointing right (AT-33)
 *   answer slide    "AI Trivia", the question, the choices and the answer line in a white box. The
 *                   correct row carries the reveal's parts (AT-38), all invisible until the hit: an
 *                   orange fill for the wipe, a drawn check mark in its letter circle, and the confetti
 *
 * Every element carries `data-el` (the tests count them). Every text leaf is `.tv-text` (the contrast
 * check reads them; `data-ink` names the colour to judge). Regions with `data-fit-min` shrink to fit
 * (text-fit.ts); the sizes found are baked in through `sizes`.
 */
export const HEADLINE = 'AI Trivia';
export const TAP_LINE = 'Tap to reveal';
/** What each slide may show (AT-33), in order. */
export const QUESTION_ELEMENTS = ['title', 'question', 'choices', 'tap', 'arrow'] as const;
export const ANSWER_ELEMENTS = ['title', 'question', 'choices', 'answer'] as const;

export type SlideRole = 'question' | 'answer';
export type SlideInput = {
  role: SlideRole;
  question: string;
  options: TriviaOption[];
  correct: TriviaOption['letter'];
  answerLine: string;
  /** Path of the photo inside the project (e.g. assets/photo.jpg), or null for a plain backdrop. */
  photo: string | null;
  focus?: { x: number; y: number };
  /** Black overlay strength over the photo, 0–1. */
  dim: number;
  /** Fitted font sizes (px) by `data-fit-id`. */
  sizes?: Record<string, number>;
  /** The confetti's seed (answer slide); the timeline must use the same one. */
  confettiSeed?: number;
};

const px = (sizes: SlideInput['sizes'], id: string): CSSProperties | undefined => (sizes?.[id] ? { fontSize: `${sizes[id]}px` } : undefined);

/** The pen-tool arrow, drawn to the right: the side people tap to go on. */
function PenArrow({ w = 190, h = 100 }: { w?: number; h?: number }) {
  const { shaft, head } = arrowPaths(w, h, seedOf(TAP_LINE));
  return (
    <svg id="tv-arrow" className="tv-pen" data-el="arrow" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={shaft} />
      <path d={head} />
    </svg>
  );
}

/** The check mark, a drawn stroke (not a glyph), pathLength 1 so the timeline can draw it on. */
function CheckMark() {
  return (
    <svg id="tv-check" className="tv-check" width={40} height={40} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M9.5 21 L17 28.5 L31 13" pathLength={1} />
    </svg>
  );
}

/** The burst's pieces, stacked at their launch points on the row; the timeline flings them. */
function Confetti({ seed }: { seed: number }) {
  return (
    <div id="tv-confetti" className="tv-confetti" aria-hidden="true">
      {confettiPieces(seed).map((p, k) => (
        <i key={k} id={`tv-cf-${k}`} className="tv-cf" style={{ left: `${p.left}%`, width: `${p.w}px`, height: `${p.h}px`, marginLeft: `${-p.w / 2}px`, marginTop: `${-p.h / 2}px` }}>
          <i className="tv-cf-in" style={{ background: p.color, borderRadius: p.round ? '50%' : '3px' }} />
        </i>
      ))}
    </div>
  );
}

export function TriviaSlide({ s }: { s: SlideInput }) {
  const answer = s.role === 'answer';
  const focus = s.focus ? `${Math.round(s.focus.x * 100)}% ${Math.round(s.focus.y * 100)}%` : '50% 50%';
  return (
    <div className={`tv-frame ${answer ? 'tv--answer' : 'tv--question'}`}>
      <div className="tv-bg">
        <div id="tv-photo" className="tv-photo" style={{ transformOrigin: focus }}>
          {s.photo ? <img src={s.photo} alt="" style={{ objectPosition: focus }} /> : null}
        </div>
        <div className="tv-dim" style={{ background: `rgba(6,6,8,${s.dim})` }} />
      </div>
      <div className="tv-stack">
        <div id="tv-head" className="tv-line tv-head" data-el="title" data-fit-min={answer ? 48 : 60} data-fit-id="head" style={px(s.sizes, 'head')}>
          <span className="tv-hl tv-box--orange tv-text" data-ink="#FFFFFF">{HEADLINE}</span>
        </div>
        <div id="tv-q" className="tv-line tv-q" data-el="question" data-fit-min={answer ? 36 : 44} data-fit-id="q" style={px(s.sizes, 'q')}>
          <span className="tv-hl tv-box--soft tv-text" data-ink="#FFFFFF">{s.question}</span>
        </div>
        <div id="tv-opts" className="tv-quiz" data-el="choices">
          {s.options.map((o, i) => {
            const right = answer && o.letter === s.correct;
            return (
              <div key={o.letter} id={`tv-opt-${i}`} className={`tv-opt-wrap${right ? ' tv-opt-wrap--correct' : ''}`}>
                <div className="tv-opt">
                  {right ? <span className="tv-fill" /> : null}
                  <span className="tv-chip">
                    <span className="tv-chip-l tv-ink tv-text">{o.letter}</span>
                    {right ? <CheckMark /> : null}
                  </span>
                  <span className="tv-opt-t tv-ink tv-text" data-fit-min={34} data-fit-id={`opt${i}`} style={px(s.sizes, `opt${i}`)}>
                    {o.text}
                  </span>
                </div>
                {right ? <Confetti seed={s.confettiSeed ?? CONFETTI_SEED} /> : null}
              </div>
            );
          })}
        </div>
        {answer ? (
          <div id="tv-ans" className="tv-line tv-ans" data-el="answer" data-fit-min={36} data-fit-id="ans" style={px(s.sizes, 'ans')}>
            <span className="tv-hl tv-box--white tv-text" data-ink="#000000">{s.answerLine}</span>
          </div>
        ) : (
          <div id="tv-tap" className="tv-tap">
            <span className="tv-line tv-tap-t" data-el="tap">
              <span className="tv-hl tv-box--soft tv-text" data-ink="#FFFFFF">{TAP_LINE}</span>
            </span>
            <PenArrow />
          </div>
        )}
      </div>
    </div>
  );
}
