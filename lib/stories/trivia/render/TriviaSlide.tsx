import type { CSSProperties } from 'react';

import type { TriviaCopy } from '@/lib/stories/render/types';

type TriviaOption = TriviaCopy['options'][number];

import { confettiPieces } from './confetti';
import type { LinePx, QuestionPx, SlideRole } from './layout';
import { TIMER_S } from './timeline';

/**
 * One "Are you smarter than AI?" slide, 1080×1920, as static markup for a HyperFrames composition: the approved
 * mock (marquee-create.html) with its preview scaffolding removed. A centred stack: the marquee sign with its
 * bulbs, the question, the choices, and the fixed footer slot (the timer, "Tap to reveal" and the arrow on
 * clip 1; the answer line on clip 2). The answer slide also carries the reveal's parts, hidden until the
 * hit: the correct pill's check, and the confetti.
 */
export const SIGN_COPY = 'Are you smarter than AI?';
export const TAP_LINE = 'Tap to reveal';
const LETTERS = ['A', 'B', 'C', 'D'] as const;
/** Bulbs along the sign's top and bottom edges (the mock's bulbs(12)), and down each side. */
export const BULBS_ACROSS = 12;
export const BULBS_DOWN = 3;

export type SlideInput = {
  role: SlideRole;
  question: string;
  options: TriviaOption[];
  correct: TriviaOption['letter'];
  answerLine: string;
  /** The question's font size (the fit rule's pick, the same on both clips). */
  questionPx: QuestionPx;
  /** The answer line's font size (its own fit, clip 2). Default 54. */
  linePx?: LinePx;
  /** The correct pill's centre on the stage (answer slide): where the confetti starts. */
  confettiAt?: { x: number; y: number };
};

const ARROW_PATHS = ['M8 50 C52 34 100 58 150 42', 'M118 14 L154 42 L120 72'];
const CHECK_PATH = 'M12 27 L22 37 L40 15';

/** The mock's bulbs(n): top left to right, right side down, bottom right to left, left side up. */
export function bulbStyles(n: number = BULBS_ACROSS): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  const pct = (i: number, of: number) => `calc(${((i + 0.5) / of) * 100}% - 15px)`;
  for (let i = 0; i < n; i++) out.push({ left: pct(i, n), top: '-15px' });
  for (let i = 0; i < BULBS_DOWN; i++) out.push({ right: '-15px', top: pct(i, BULBS_DOWN) });
  for (let i = n - 1; i >= 0; i--) out.push({ left: pct(i, n), bottom: '-15px' });
  for (let i = BULBS_DOWN - 1; i >= 0; i--) out.push({ left: '-15px', top: pct(i, BULBS_DOWN) });
  return out;
}

function Arrow() {
  return (
    <svg viewBox="0 0 170 90" fill="none" stroke="currentColor" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ARROW_PATHS.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

function Check() {
  return (
    <svg id="tv-check" viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={CHECK_PATH} />
    </svg>
  );
}

function Timer() {
  const digits = Array.from({ length: TIMER_S }, (_, i) => TIMER_S - i);
  return (
    <span id="tv-timer" className="timer">
      {digits.map((d) => <b key={d} id={`tv-d-${d}`} className={d === TIMER_S ? 'on' : undefined}>{d}</b>)}
    </span>
  );
}

export function TriviaSlide({ s }: { s: SlideInput }) {
  const answer = s.role === 'answer';
  const at = s.confettiAt ?? { x: 540, y: 960 };
  return (
    <div id="tv-stage" className={`stage ${answer ? 'a' : 'q'}`} style={{ '--qpx': `${s.questionPx}px`, '--lpx': `${s.linePx ?? 54}px` } as CSSProperties}>
      <div id="tv-sign" className="title">
        {bulbStyles().map((st, i) => <i key={i} className={`bulb p${i % 2}`} style={st} />)}
        {SIGN_COPY}
      </div>
      <div id="tv-q" className="question">{s.question}</div>
      <div id="tv-choices" className="choices">
        {s.options.map((o, i) => {
          const right = answer && o.letter === s.correct;
          return (
            <div key={o.letter} id={`tv-opt-${i}`} className="ch">
              <b>
                <span className="tv-l">{LETTERS[i]}</span>
                {right ? <Check /> : null}
              </b>
              <span className="tv-t">{o.text}</span>
            </div>
          );
        })}
      </div>
      <div id="tv-foot" className="foot">
        {answer ? (
          <div id="tv-line" className="line">{s.answerLine}</div>
        ) : (
          <div id="tv-tap" className="tap">
            <Timer />
            <span>{TAP_LINE}</span>
            <Arrow />
          </div>
        )}
      </div>
      {answer
        ? confettiPieces().map((p, k) => (
            <i key={k} id={`tv-cf-${k}`} className="conf" style={{ left: `${Math.round(at.x)}px`, top: `${Math.round(at.y)}px`, background: p.color }} />
          ))
        : null}
    </div>
  );
}
