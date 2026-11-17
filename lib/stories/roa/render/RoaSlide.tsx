import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FRAME_H, SAFE_BOTTOM, SAFE_TOP } from '@/lib/stories/render/types';
import type { RoaQuestionData, RoaRevealData, SubjectRect } from '@/lib/stories/roa/types';

/**
 * One Real or AI? slide, 1080×1920, a still JPEG through the Stories renderer (CONTRACT §4 Owner B, RA-8, RA-12):
 * the Instagram story-editor look (highlight boxes), set in the Helios pair shared with "Are you smarter than AI?"
 * (RA-25: Pragmatica Extended for the question and the verdict, Roboto for the rest). roa.css owns every rule.
 * Everything level, all type inside the safe band.
 *
 *   question  the photo full-bleed, not dimmed, and "Real or AI?" in Classic text (R6). Nothing else.
 *   reveal    the same photo slightly dimmed; "REAL" in a white highlight box or "AI" in an orange one; one payoff
 *             (RA-26); the proof, small. No tells and no pen circle.
 *               prompt  AI: the prompt that made it, on a white card
 *               effort  effort gap large: what it took (real) or would have taken (AI), in a soft dark box
 *               camera  real, otherwise: the camera, its settings, when and where, on a white card
 *               origin  AI with no prompt to show, otherwise: what made it and where it came from (RA-27)
 *
 * Text never covers the subject (RA-28): with a `subject` (layout.ts), each stack carries `data-avoid` and the renderer
 * moves it into the empty space (lib/stories/render/avoid.ts). The question prefers the top, the reveal the bottom; the
 * reveal may split, its verdict above the subject and the rest below.
 *
 * Every element carries `data-el` (the tests count them). Every text leaf is `.tv-text` with `data-ink` (the contrast
 * check reads them). Text regions carry `data-fit-min` (the renderer's text fit) and `data-safe` (its safe-zone check).
 */
export const QUESTION_LABEL = 'Real or AI?';
export const VERDICT: Record<RoaRevealData['truth'], string> = { real: 'REAL', ai: 'AI' };
/** The prompt card's heading (RA-26). */
export const PROMPT_HEAD = 'The prompt';
/** What each slide may show, in order. */
export const QUESTION_ELEMENTS = ['photo', 'label'] as const;
export const REVEAL_ELEMENTS = ['photo', 'verdict', 'line', 'card', 'proof'] as const;
/** The reveal's dim: "slightly", so the photo still reads. */
export const REVEAL_DIM = 0.3;
/** The text column (the same gutters as AI Trivia), and the band it stays inside. */
const GUTTER = 72;
const BAND_TOP = SAFE_TOP + 12;
const BAND_BOTTOM = FRAME_H - SAFE_BOTTOM - 12;
/** The card's heading ink: grey on white, 6.7:1. */
const HEAD_INK = '#5C5C5C';

export type RoaSlideData = RoaQuestionData | RoaRevealData;
export type RoaCard = { head: string; rows: string[]; typed: boolean };

/* ── The styles: roa.css, read once ─────────────────────────────── */

let cssCache: string | null = null;

export function roaCss(): string {
  if (cssCache) return cssCache;
  cssCache = readFileSync(path.join(process.cwd(), 'lib/stories/roa/render/roa.css'), 'utf8');
  return cssCache;
}

/* ── The slide ──────────────────────────────────────────────────── */

/** The card a reveal shows (RA-26, RA-27): the prompt, the camera card (real) or the origin card (AI), when there is no effort line. */
export function cardOf(data: RoaRevealData): RoaCard | null {
  if (data.payoff === 'prompt') return data.prompt?.trim() ? { head: PROMPT_HEAD, rows: [data.prompt.trim()], typed: true } : null;
  if (data.payoff === 'camera' || data.payoff === 'origin') return data.receipt?.rows.length ? { head: data.receipt.head, rows: data.receipt.rows, typed: false } : null;
  return null;
}

function Photo({ data, dim }: { data: RoaSlideData; dim: number }) {
  const focus = data.photo.focus ?? { x: 0.5, y: 0.5 };
  const pos = `${Math.round(focus.x * 100)}% ${Math.round(focus.y * 100)}%`;
  return (
    <div className="tv-bg rs-photo" data-el="photo" data-decor="true">
      <img src={data.photo.src} alt="" style={{ objectPosition: pos }} />
      {dim > 0 ? <div className="tv-dim" style={{ background: `rgba(6,6,8,${dim})` }} /> : null}
    </div>
  );
}

/** The renderer's cue to keep this stack off the subject (RA-28); nothing when the subject is unknown. */
function avoid(subject: SubjectRect | undefined, prefer: 'top' | 'bottom', split = false): Record<string, string> {
  if (!subject) return {};
  return { 'data-avoid': JSON.stringify(subject), 'data-band': `${BAND_TOP},${BAND_BOTTOM}`, 'data-prefer': prefer, ...(split ? { 'data-split': '' } : {}) };
}

function Question({ data }: { data: RoaQuestionData }) {
  return (
    <>
      <Photo data={data} dim={0} />
      <div className="rs-stack" style={{ top: BAND_TOP, left: GUTTER, right: GUTTER }} {...avoid(data.subject, 'top')}>
        <div className="tv-line rs-label" data-el="label" data-safe="true" data-fit-min={64}>
          <span className="tv-hl tv-box--soft tv-text" data-ink="#FFFFFF">
            {QUESTION_LABEL}
          </span>
        </div>
      </div>
    </>
  );
}

function Card({ card }: { card: RoaCard }) {
  return (
    <div className={`rs-card${card.typed ? ' rs-card--typed' : ''}`} data-el="card" data-safe="true" data-fit-min={26}>
      <div className="rs-card-h tv-text" data-ink={HEAD_INK}>
        {card.head}
      </div>
      {card.rows.map((r, i) => (
        <div key={i} className={`rs-card-r tv-text${i === 0 && !card.typed ? ' rs-card-r--lead' : ''}`} data-ink="#000000">
          {r}
        </div>
      ))}
    </div>
  );
}

function Reveal({ data }: { data: RoaRevealData }) {
  const card = cardOf(data);
  const line = data.payoff === 'effort' ? data.line?.trim() : '';
  return (
    <>
      <Photo data={data} dim={REVEAL_DIM} />
      <div className="rs-stack rs-stack--bottom" style={{ bottom: FRAME_H - BAND_BOTTOM, left: GUTTER, right: GUTTER }} {...avoid(data.subject, 'bottom', true)}>
        <div className="tv-line rs-verdict" data-el="verdict" data-safe="true" data-fit-min={96}>
          <span className={`tv-hl ${data.truth === 'real' ? 'tv-box--white' : 'tv-box--orange'} tv-text`} data-ink={data.truth === 'real' ? '#000000' : '#FFFFFF'}>
            {VERDICT[data.truth]}
          </span>
        </div>
        {line ? (
          <div className="tv-line rs-line" data-el="line" data-safe="true" data-fit-min={40}>
            <span className="tv-hl tv-box--soft tv-text" data-ink="#FFFFFF">
              {line}
            </span>
          </div>
        ) : null}
        {card ? <Card card={card} /> : null}
        <div className="tv-line rs-proof" data-el="proof" data-safe="true" data-fit-min={26}>
          <span className="tv-hl tv-box--soft tv-text" data-ink="#FFFFFF">
            {data.proof}
          </span>
        </div>
      </div>
    </>
  );
}

export function RoaSlide({ data }: { data: RoaSlideData }) {
  const reveal = data.role === 'roa_reveal';
  return (
    <div className={`st-frame rs-frame ${reveal ? 'rs--reveal' : 'rs--question'}`} data-role={data.role} data-round={data.round}>
      <style dangerouslySetInnerHTML={{ __html: roaCss() }} />
      {reveal ? <Reveal data={data} /> : <Question data={data} />}
    </div>
  );
}
