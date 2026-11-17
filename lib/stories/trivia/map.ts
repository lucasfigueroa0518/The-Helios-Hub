/**
 * The AI Trivia content map (AT-3, AT-24): 20 themes × 20 angles = 400 cells,
 * verbatim from planning/AI Trivia/CONTENT-MAP-DRAFT.md as Lucas approved it.
 * AT-52/53: themes 6, 11, 15, 16 and 17 were replaced in place with everyday
 * themes, so the indices, the cell ids and the schema seed are unchanged.
 * Cell id `t<theme 01-20>a<angle 01-20>`. A cell holds many questions and
 * retires when the writer twice reports it spent (AT-78, cells.ts).
 * AT-63: weak themes and angles are retired in place: their cells stay on the
 * grid (ids and table unchanged) but are never offered. AT-65 adds angle 6. 18 × 12 = 216 active cells.
 */

export const THEMES = [
  'The chatbots people use every day',
  'AI hiding inside your phone',
  'AI in the apps you already use (streaming, maps, shopping, social feeds)',
  'Firsts and origins in AI history',
  'Famous AI blunders and fails',
  "AI at work: the jobs and tasks it's changing",
  'Robots and machines with bodies',
  'AI in games and sports',
  'AI in movies and books versus reality',
  'How AI learns: data and training',
  'Scams, fakes and deepfakes',
  'AI in medicine and health',
  'AI in art, music and writing',
  'Self-driving cars and transport',
  'AI at home: speakers, cameras and smart gadgets',
  'AI in school and homework',
  'AI in dating, friendships and social life',
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

/** AT-63, by 1-based index. Themes: How AI learns (10), Discoveries AI made in science (20). */
export const RETIRED_THEMES: ReadonlySet<number> = new Set([10, 20]);
/** AT-63. Angles: the first time (2), how it actually works (4), something you use without knowing (7), a close call (8), the year it happened (13), what went wrong (16), the rule nobody knows about (17). AT-65: what it cost (6). */
export const RETIRED_ANGLES: ReadonlySet<number> = new Set([2, 4, 6, 7, 8, 13, 16, 17]);

/** A cell the daily writer may be offered (AT-63). */
export function isActive(c: Pick<Cell, 'theme' | 'angle'>): boolean {
  return !RETIRED_THEMES.has(c.theme) && !RETIRED_ANGLES.has(c.angle);
}

/** Every cell on the grid, theme-major, retired ones included (the table holds all of them). */
export function allCells(): Cell[] {
  return THEMES.flatMap((themeText, t) => ANGLES.map((angleText, a) => ({ cellId: cellId(t + 1, a + 1), theme: t + 1, angle: a + 1, themeText, angleText })));
}
