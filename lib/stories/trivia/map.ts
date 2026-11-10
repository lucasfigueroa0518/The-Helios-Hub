/**
 * The AI Trivia content map (AT-3, AT-24): 20 themes × 20 angles = 400 cells,
 * verbatim from planning/AI Trivia/CONTENT-MAP-DRAFT.md as Lucas approved it.
 * Cell id `t<theme 01-20>a<angle 01-20>`. A cell closes for good when its
 * question posts, so no question ever repeats.
 */

export const THEMES = [
  'The chatbots people use every day',
  'AI hiding inside your phone',
  'AI in the apps you already use (streaming, maps, shopping, social feeds)',
  'Firsts and origins in AI history',
  'Famous AI blunders and fails',
  'The people who built AI',
  'Robots and machines with bodies',
  'AI in games and sports',
  'AI in movies and books versus reality',
  'How AI learns: data and training',
  'Chips, power and the cost of running AI',
  'AI in medicine and health',
  'AI in art, music and writing',
  'Self-driving cars and transport',
  'AI and money: the companies and the deals',
  'The words of AI: where the terms came from',
  'AI rules, laws and lawsuits',
  'AI versus the human brain',
  'AI and internet culture',
  'Discoveries AI made in science',
] as const;

export const ANGLES = [
  'A number that sounds wrong',
  'The first time it happened',
  'Who was really behind it',
  'How it actually works',
  'The myth most people believe',
  'What it cost',
  'Something you use without knowing',
  'A close call or near miss',
  'Where the name came from',
  'Compared with a human',
  "What it still can't do",
  'The record holder',
  'The year it happened',
  'Older than you think',
  'The unexpected place it showed up',
  'What went wrong',
  'The rule nobody knows about',
  'How big it really is',
  'What it was originally built for',
  'The odd one out',
] as const;

export type Cell = { cellId: string; theme: number; angle: number; themeText: string; angleText: string };

const pad = (n: number) => String(n).padStart(2, '0');

export function cellId(theme: number, angle: number): string {
  return `t${pad(theme)}a${pad(angle)}`;
}

const CELL_RE = /^t(\d{2})a(\d{2})$/;

/** A cell by id, or null when the id is not on the map. */
export function cellOf(id: string): Cell | null {
  const m = CELL_RE.exec(id);
  if (!m) return null;
  const theme = Number(m[1]);
  const angle = Number(m[2]);
  const themeText = THEMES[theme - 1];
  const angleText = ANGLES[angle - 1];
  if (!themeText || !angleText) return null;
  return { cellId: id, theme, angle, themeText, angleText };
}

/** Every cell on the map, theme-major. */
export function allCells(): Cell[] {
  return THEMES.flatMap((themeText, t) => ANGLES.map((angleText, a) => ({ cellId: cellId(t + 1, a + 1), theme: t + 1, angle: a + 1, themeText, angleText })));
}
