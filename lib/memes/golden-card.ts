/**
 * Golden cards (planning/Memes/GOLDEN_SET.md G4): how each template really
 * works, coded from its top real uses on Imgflip, its tech-tag memes, its
 * flops and Know Your Meme (G3 dossiers). The writer reads them in place of
 * our old logic and usage lines; the judges read the mechanism and the test.
 *
 * The data lives in golden-cards.generated.ts, written from the dossiers by
 * scripts/memes_golden_cards.ts. The examples are ours, written in the real
 * register; no real caption is copied into a prompt. Like the catalog, a
 * change needs Lucas's approval.
 */
import { GOLDEN_CARDS } from './golden-cards.generated';

export type GoldenPattern = {
  id: string;
  /** The abstract form, with [slot] placeholders. */
  form: string;
  /** The joke device (petty vs proper, escalation, literalism, …). */
  device: string;
  /** Its share of the coded top uses (0–1). */
  share: number;
};

export type GoldenExample = { pattern: string; story: string; fills: Record<string, string> };

export type GoldenSlotTarget = { p50: number; p90: number; form: string };

export type GoldenCard = {
  /** What the image shows and where the boxes sit. */
  picture: string;
  /** Who the figure stands for in real uses. */
  figure: string;
  /** Why it is funny: the engine of the joke. */
  mechanism: string;
  patterns: GoldenPattern[];
  /** How real boxes are written: label vs sentence, person, tense, casing. */
  voice: string;
  /** Per writable slot: the real lengths and the usual form of the line. */
  slotTargets: Record<string, GoldenSlotTarget>;
  examples: GoldenExample[];
  misreads: string[];
  /** One yes/no question; yes means the meme uses the format correctly. */
  test: string;
  newsFit: 'strong' | 'ok' | 'weak';
};

export function goldenCard(templateId: string): GoldenCard | null {
  return GOLDEN_CARDS[templateId] ?? null;
}

/** Problems with a golden card, for the tests and the generator. */
export function goldenCardProblems(id: string, g: GoldenCard, writable: string[]): string[] {
  const out: string[] = [];
  if (!g.mechanism.trim()) out.push(`${id}: no mechanism`);
  if (!g.test.trim()) out.push(`${id}: no test`);
  if (g.patterns.length < 2) out.push(`${id}: ${g.patterns.length} patterns (at least 2)`);
  if (new Set(g.patterns.map((p) => p.id)).size !== g.patterns.length) out.push(`${id}: duplicate pattern ids`);
  if (g.examples.length < 3) out.push(`${id}: ${g.examples.length} examples (at least 3)`);
  for (const e of g.examples) {
    if (!g.patterns.some((p) => p.id === e.pattern)) out.push(`${id}: example uses unknown pattern "${e.pattern}"`);
    for (const s of Object.keys(e.fills)) if (!writable.includes(s)) out.push(`${id}: example fills unknown slot "${s}"`);
  }
  for (const s of Object.keys(g.slotTargets)) if (!writable.includes(s)) out.push(`${id}: slot target for unknown slot "${s}"`);
  return out;
}
