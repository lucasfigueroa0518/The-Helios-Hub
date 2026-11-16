/**
 * The reveal's confetti (CONTRACT-2 §2): 30 pieces burst from the correct pill's centre, copied from the
 * approved mock (marquee-create.html). The pieces are fixed by their index (the mock's formula), so every
 * render throws the same burst: piece i flies out at angle i/30 of a turn, 240–499 px, 1.3× taller than
 * wide, spun i·47°, in white, green and the sign's dark, in turn.
 */

export const CONFETTI_COUNT = 30;
export const CONFETTI_COLORS = ['#FFFFFF', '#138510', '#170b04'] as const;
/** Each piece: 26×14 px, 3 px corners (the mock's `.conf`). */
export const CONFETTI_SIZE = { w: 26, h: 14, radius: 3 } as const;

/** Every piece also falls this far, so none comes to rest on the correct pill's text. */
export const CONFETTI_FALL = 160;
/** Half the correct pill's size plus a margin: no piece ends inside it. */
export const PILL_CLEAR = { x: 470, y: 80 } as const;
export type ConfettiPiece = { color: string; dx: number; dy: number; rot: number };

export function confettiPieces(): ConfettiPiece[] {
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => {
    const a = (i / CONFETTI_COUNT) * Math.PI * 2;
    const d = 240 + ((i * 97) % 260);
    const dx = Math.round(Math.cos(a) * d);
    let dy = Math.round(Math.sin(a) * d * 1.3 + CONFETTI_FALL);
    // A piece that would come to rest on the pill row is pushed clear of it.
    if (Math.abs(dy) < PILL_CLEAR.y && Math.abs(dx) < PILL_CLEAR.x) dy += dy < 0 ? -PILL_CLEAR.y : PILL_CLEAR.y;
    return { color: CONFETTI_COLORS[i % 3]!, dx, dy, rot: (i * 47) % 360 };
  });
}
