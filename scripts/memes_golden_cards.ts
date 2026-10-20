/**
 * Write lib/memes/golden-cards.generated.ts from the G3 dossiers
 * (.memes-local/golden/dossiers/<id>.json; planning/Memes/GOLDEN_SET.md G4).
 * Only what the writer and judges read is kept: the picture, the figure, the
 * mechanism, the patterns, the voice, the slot targets, our own examples,
 * the misreads and the test. Checks each card against the catalog's
 * writable slots and fails on a problem. Offline, no model calls.
 *
 *   npx tsx scripts/memes_golden_cards.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { TEMPLATE_CATALOG, writableSlots } from '@/lib/memes/catalog';
import type { TemplateSlot } from '@/lib/memes/types';
import { goldenCardProblems, type GoldenCard } from '@/lib/memes/golden-card';
import { GOLDEN_DIR } from '@/lib/memes/golden';

type Dossier = {
  templateId: string;
  picture: string;
  figure: string;
  mechanism: string;
  patterns: Array<{ id: string; form: string; share: number; device: string }>;
  voice: string;
  slotTargets: Record<string, { p50: number; p90: number; form: string }>;
  misreads: string[];
  examples: Array<{ pattern: string; story: string; fills: Record<string, string> }>;
  test: string;
  newsFit: 'strong' | 'ok' | 'weak';
  slotProposal: { slots: Array<{ id: string; where?: string; role?: string; accepts?: string[]; must?: string; optional?: boolean; fixed?: string | null; derived?: unknown }> } | null;
};

/**
 * Templates whose slot structure was rebuilt by hand in catalog.ts and
 * geometry.ts from their dossier (new or moved boxes). The overlay leaves
 * them alone.
 */
const HAND_RESTRUCTURED = new Set<string>([
  'disaster-girl', 'waiting-skeleton', 'bike-fall', 'buff-doge-cheems', 'anakin-padme', 'marked-safe-from', 'zero-days-without', 'trophy', 'absolute-cinema',
  'roll-safe', 'they-dont-know', 'hide-the-pain', 'pawn-stars', 'megamind-peeking', 'two-guys-bus', 'thinking-about', 'spiderman-triple', 'where-monkey', 'three-headed-dragon', 'bad-luck-brian', 'something-of-a-scientist', 'inhaling-seagull', 'mocking-spongebob', 'imagination-spongebob', 'laughing-leo',
]);
type SlotOver = Partial<Pick<TemplateSlot, 'where' | 'role' | 'must' | 'accepts' | 'optional'>>;
const KINDS = new Set(['entity', 'text', 'viewer']);

/** Benched cards (ME-103) are out of rotation; their dossiers stay in GOLDEN_SET.md only. */
const BENCHED = new Set(['mocking-spongebob', 'imagination-spongebob', 'laughing-leo']);
const dir = path.join(GOLDEN_DIR, 'dossiers');
const cards: Record<string, GoldenCard> = {};
const slots: Record<string, Record<string, SlotOver>> = {};
const problems: string[] = [];
for (const t of TEMPLATE_CATALOG) {
  const f = path.join(dir, `${t.id}.json`);
  if (BENCHED.has(t.id)) continue;
  if (!fs.existsSync(f)) {
    problems.push(`${t.id}: no dossier`);
    continue;
  }
  const d = JSON.parse(fs.readFileSync(f, 'utf8')) as Dossier;
  const writable = writableSlots(t).map((s) => s.id);
  const card: GoldenCard = {
    picture: d.picture.trim(),
    figure: d.figure.trim(),
    mechanism: d.mechanism.trim(),
    patterns: d.patterns.map((p) => ({ id: p.id, form: p.form.trim(), device: p.device.trim(), share: Math.round(p.share * 100) / 100 })),
    voice: d.voice.trim(),
    slotTargets: Object.fromEntries(Object.entries(d.slotTargets).filter(([s]) => writable.includes(s)).map(([s, v]) => [s, { p50: Math.round(v.p50), p90: Math.round(v.p90), form: v.form.trim() }])),
    // A fixed or derived slot is printed by code, so an example's text for it is dropped; an
    // example built on a slot the catalog doesn't have (a proposal not taken) is dropped whole.
    examples: d.examples.filter((e) => Object.keys(e.fills).every((k) => t.slots.some((x) => x.id === k))).map((e) => ({
      pattern: e.pattern,
      story: e.story.trim(),
      fills: Object.fromEntries(
        Object.entries(e.fills).filter(([k, v]) => String(v).trim() && !t.slots.some((x) => x.id === k && (x.fixed || x.derived))).map(([k, v]) => [k, String(v).trim()]),
      ),
    })),
    misreads: d.misreads.map((m) => m.trim()).filter(Boolean),
    test: d.test.trim(),
    newsFit: d.newsFit,
  };
  problems.push(...goldenCardProblems(t.id, card, writable));
  cards[t.id] = card;
  // The proposal's text for slots that keep their id; a new or removed slot is a hand change (HAND_RESTRUCTURED).
  if (d.slotProposal && !HAND_RESTRUCTURED.has(t.id)) {
    const over: Record<string, SlotOver> = {};
    for (const x of d.slotProposal.slots) {
      const cur = t.slots.find((y) => y.id === x.id);
      if (!cur || cur.fixed || cur.derived || x.fixed || x.derived) continue;
      const accepts = (x.accepts ?? []).filter((k) => KINDS.has(k)) as TemplateSlot['accepts'][number][];
      const o: SlotOver = {};
      if (x.where?.trim()) o.where = x.where.trim();
      if (x.role?.trim()) o.role = x.role.trim();
      if (x.must?.trim()) o.must = x.must.trim();
      if (accepts.length && JSON.stringify([...accepts].sort()) !== JSON.stringify([...cur.accepts].sort())) o.accepts = accepts;
      if (typeof x.optional === 'boolean' && x.optional !== Boolean(cur.optional)) o.optional = x.optional;
      if (Object.keys(o).length) over[x.id] = o;
    }
    if (Object.keys(over).length) slots[t.id] = over;
  }
}

const out = path.join(process.cwd(), 'lib', 'memes', 'golden-cards.generated.ts');
fs.writeFileSync(
  out,
  `// Generated by scripts/memes_golden_cards.ts from .memes-local/golden/dossiers. Do not edit by hand.\nimport type { GoldenCard } from './golden-card';\n\nexport const GOLDEN_CARDS: Readonly<Record<string, GoldenCard>> = ${JSON.stringify(cards, null, 2)};\n`,
);
console.log(`Wrote ${Object.keys(cards).length} golden cards to ${out}`);
const slotsOut = path.join(process.cwd(), 'lib', 'memes', 'golden-slots.generated.ts');
fs.writeFileSync(
  slotsOut,
  `// Generated by scripts/memes_golden_cards.ts from .memes-local/golden/dossiers. Do not edit by hand.\nimport type { TemplateSlot } from './types';\n\nexport const GOLDEN_SLOTS: Readonly<Record<string, Readonly<Record<string, Partial<Pick<TemplateSlot, 'where' | 'role' | 'must' | 'accepts' | 'optional'>>>>>> = ${JSON.stringify(slots, null, 2)};\n`,
);
console.log(`Wrote slot rewrites for ${Object.keys(slots).length} templates to ${slotsOut}`);
if (problems.length) {
  console.log(`\n${problems.length} problems:\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exitCode = 1;
}
