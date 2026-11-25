import type { CSSProperties } from 'react';

import type { TriviaCopy } from '@/lib/stories/render/types';

type TriviaOption = TriviaCopy['options'][number];

import { confettiPieces } from './confetti';
import { critterData, ROOM_H, type CritterDirection } from './critter';
import type { LinePx, QuestionPx, SlideRole } from './layout';
import { bulbsSwapOnAnswer, TIMER_S } from './timeline';
import { OPPONENT_TAG } from '../opponent';

/**
 * One "Are you smarter than AI?" slide, 1080×1920, as static markup for a HyperFrames composition: the approved
 * mock (marquee-create.html) with its preview scaffolding removed. A centred stack: the marquee sign with its
 * bulbs, the question, the choices, and the fixed footer slot (the timer, "Tap to reveal" and the arrow on
 * clip 1; the website call to action on clip 2). On clip 2 the answer line takes the question's slot. The answer slide also carries the reveal's parts, hidden until the
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
  /** The critter's direction (both clips), when the question has one. */
  critter?: CritterDirection;
  /** The opponent model and its pick (AT-74): named before the reveal, its result after. */
  opponent?: { label: string; picked: TriviaOption['letter'] };
};

/**
 * The opponent's speech bubble, right next to the critter (it stands on the sign's right; the bubble's tail points
 * at it). Before the reveal it names the opponent; on clip 2 the reveal swaps it for the result: green with a
 * check when its pick was right, red with a cross when not ("GPT-5 nano selected B").
 */
function OpponentLabel({ s, answer }: { s: SlideInput; answer: boolean }) {
  const o = s.opponent!;
  const right = o.picked === s.correct;
  return (
    <div id="tv-opp" className="opp">
      <div id="tv-opp-pre" className="opp-pre bubble">
        <span className="opp-n">{o.label}</span>
        <span className="opp-t">{OPPONENT_TAG}</span>
      </div>
      {answer ? (
        <div id="tv-opp-post" className={`opp-post bubble ${right ? 'ok' : 'no'}`}>
          <b>{right ? <Check /> : <Cross />}</b>
          <span className="opp-n">{o.label} selected {o.picked}</span>
        </div>
      ) : null}
    </div>
  );
}

/** The website call to action on the answer slide (in the tap row's place once the reveal lands). */
export const CTA_COPY = { main: 'New game daily. Play now', sub: 'link in bio' } as const;
const UP_LEFT_PATH = 'M38 38 L12 12 M12 30 L12 12 L30 12';

const ARROW_PATHS = ['M8 50 C52 34 100 58 150 42', 'M118 14 L154 42 L120 72'];
const CHECK_PATH = 'M12 27 L22 37 L40 15';
const CROSS_PATH = 'M15 15 L37 37 M37 15 L15 37';

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

function UpLeft() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={UP_LEFT_PATH} />
    </svg>
  );
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

/** The opponent's miss mark (AT-74). */
function Cross() {
  return (
    <svg viewBox="0 0 52 52" fill="none" stroke="currentColor" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={CROSS_PATH} />
    </svg>
  );
}

/** The timer: full at 10 on clip 1; on clip 2 (`end`), as clip 1 leaves it: the ring empty, the digit 1. */
function Timer({ end = false }: { end?: boolean }) {
  const digits = Array.from({ length: TIMER_S }, (_, i) => TIMER_S - i);
  const shown = end ? 1 : TIMER_S;
  return (
    <span id="tv-timer" className="timer" style={end ? ({ '--p': '0%' } as CSSProperties) : undefined}>
      {digits.map((d) => <b key={d} id={`tv-d-${d}`} className={d === shown ? 'on' : undefined}>{d}</b>)}
    </span>
  );
}

export function TriviaSlide({ s }: { s: SlideInput }) {
  const answer = s.role === 'answer';
  const at = s.confettiAt ?? { x: 540, y: 960 };
  return (
    <div id="tv-stage" className={`stage ${answer ? 'a' : 'q'}`} style={{ '--qpx': `${s.questionPx}px`, '--lpx': `${s.linePx ?? 54}px`, '--room': `${s.critter || s.opponent ? ROOM_H : 0}px` } as CSSProperties}>
      <div id="tv-sign" className="title">
        {bulbStyles().map((st, i) => <i key={i} className={`bulb p${(i + (answer && bulbsSwapOnAnswer() ? 1 : 0)) % 2}`} style={st} />)}
        {SIGN_COPY}
        {s.opponent ? <OpponentLabel s={s} answer={answer} /> : null}
      </div>
      {/* The question's slot: on clip 2 the answer line takes it over as the question fades (nothing below moves). */}
      <div id="tv-qslot" className="qslot">
        <div id="tv-q" className="question">{s.question}</div>
        {answer ? <div id="tv-lslot" className="lslot"><div id="tv-line" className="line">{s.answerLine}</div></div> : null}
      </div>
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
        {/* Clip 2 opens on clip 1's last frame (the seam), so its tap row is there until the hit. */}
        <div id="tv-tap" className="tap">
          <Timer end={answer} />
          <span>{TAP_LINE}</span>
          <Arrow />
        </div>
        {answer ? (
          <div id="tv-cta" className="cta">
            <div className="cta-card">
              <span className="cta-m">{CTA_COPY.main}</span>
              <span className="cta-s"><UpLeft />{CTA_COPY.sub}</span>
            </div>
          </div>
        ) : null}
      </div>
      {answer
        ? confettiPieces().map((p, k) => (
            <i key={k} id={`tv-cf-${k}`} className="conf" style={{ left: `${Math.round(at.x)}px`, top: `${Math.round(at.y)}px`, background: p.color }} />
          ))
        : null}
      {s.critter ? <div id="tv-critter" className="critter" /> : null}
      {s.critter ? (
        <script id="tv-critter-data" type="application/json" dangerouslySetInnerHTML={{ __html: critterData(s.critter, s.role, s.options.findIndex((o) => o.letter === s.correct), s.opponent ? (s.opponent.picked === s.correct ? 'right' : 'wrong') : null) }} />
      ) : null}
    </div>
  );
}
