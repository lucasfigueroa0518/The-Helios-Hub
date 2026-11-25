/**
 * "Are you smarter than AI?" layout (CONTRACT-2 §2), as plain geometry so tests can read it.
 *
 * The stage is 1080×1920, a flex column centred inside the safe area (padding 220 top, 280 bottom, 84 sides,
 * gap 50): the sign, the question, the choices, then the footer slot. The footer slot is a fixed 210 px box
 * (6 px top margin) whose content (the tap row on clip 1, the answer line on clip 2) never changes its size,
 * so the stack's height, and with it every box above the slot, depends only on the sign, the question and
 * the choices. Those are the same on both clips, so both clips put them on the same pixels.
 *
 * Fit rule: when the stack is taller than the safe area (or a word of the question is wider than it), the
 * question steps down QUESTION_PX (66 → 60 → 54 → 48). The step is picked once, from the content, and both
 * clips are drawn at it.
 */

export const STAGE_W = 1080;
export const STAGE_H = 1920;
export const PAD = { top: 220, bottom: 280, x: 84 } as const;
export const GAP = 50;
/** The safe area the stack is centred in. */
export const SAFE = { x: PAD.x, y: PAD.top, w: STAGE_W - 2 * PAD.x, h: STAGE_H - PAD.top - PAD.bottom } as const;
/** The footer slot: fixed height, and its top margin. */
export const FOOT_H = 210;
export const FOOT_MARGIN = 6;
/** The question's font size steps (px), largest first. */
export const QUESTION_PX = [66, 60, 54, 48] as const;
/** The answer line's sizes, largest first: it steps down until it fits its slot (clip 2 only; nothing else moves). */
export const LINE_PX = [54, 48, 42, 38] as const;
export type LinePx = (typeof LINE_PX)[number];
/** How far the answer line's slot reaches into the gaps above and below the question (trivia.css --lpad). */
export const LINE_PAD = 32;
/** The answer line's slot on clip 2: the question's box plus LINE_PAD above and below. */
export const lineSlotH = (questionH: number) => questionH + 2 * LINE_PAD;
/** The largest answer-line size whose measured height fits its slot (`slotH`), or null when none does. */
export function fitLinePx(heights: Partial<Record<number, number>>, slotH: number): LinePx | null {
  for (const px of LINE_PX) { const h = heights[px]; if (h !== undefined && h <= slotH + 1) return px; }
  return null;
}
export type QuestionPx = (typeof QUESTION_PX)[number];

export type Size = { w: number; h: number };
export type Box = { x: number; y: number; w: number; h: number };
/** What the stack holds above the footer slot, measured at one question size. */
export type StackContent = { sign: Size; question: Size; choices: Size; room?: number };
/** The same, plus whether a word of the question is wider than the safe area at that size. */
export type Measured = StackContent & { questionWide: boolean };
export type SlideRole = 'question' | 'answer';
export type StackBoxes = { sign: Box; question: Box; choices: Box; foot: Box };

/** The stack's total height: three gaps, the footer margin and the fixed slot, whatever the slot holds. */
export function stackHeight(c: StackContent): number {
  return (c.room ?? 0) + c.sign.h + c.question.h + c.choices.h + 3 * GAP + FOOT_MARGIN + FOOT_H;
}

/**
 * Where each block of a slide sits on the stage. `role` only picks what the footer slot holds; it changes
 * nothing above it (CONTRACT-2 §2). Overflow is split above and below, as `justify-content: center` does.
 */
export function slideLayout(role: SlideRole, c: StackContent): { role: SlideRole; boxes: StackBoxes; height: number; fits: boolean } {
  const height = stackHeight(c);
  // The critter's room (critter.ts ROOM_H) is the sign's top margin: it sits above the sign in the stack.
  let y = SAFE.y + (SAFE.h - height) / 2 + (c.room ?? 0);
  const place = (s: Size): Box => {
    const b = { x: (STAGE_W - s.w) / 2, y, w: s.w, h: s.h };
    y += s.h + GAP;
    return b;
  };
  const sign = place(c.sign);
  const question = place(c.question);
  const choices = place(c.choices);
  const foot = { x: SAFE.x, y: y + FOOT_MARGIN, w: SAFE.w, h: FOOT_H };
  return { role, boxes: { sign, question, choices, foot }, height, fits: height <= SAFE.h + 0.5 };
}

/**
 * The fit rule: the largest question size at which the stack fits the safe area and no word of the question
 * is wider than it. `measures` holds the content at each size (the preflight measures it on clip 1; the
 * content is the same on clip 2). Null when even the smallest size does not fit.
 */
export function fitQuestionPx(measures: Partial<Record<number, Measured>>): { px: QuestionPx; content: Measured } | null {
  for (const px of QUESTION_PX) {
    const m = measures[px];
    if (m && !m.questionWide && slideLayout('question', m).fits) return { px, content: m };
  }
  return null;
}

/** The largest difference between two boxes' edges (px). */
export function boxDelta(a: Box, b: Box): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
}
