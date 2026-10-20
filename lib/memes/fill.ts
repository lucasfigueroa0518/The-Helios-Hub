/**
 * A meme as the writer fills it, and as the renderer draws it. The writer
 * fills only writable slots (catalog.ts); code resolves fixed text, repeats
 * and derived slots, and turns a player id into its exact name and logo
 * (ME-10). Pure, so tests cover it without a browser.
 */
import { bluePlayer, type BluePlayer } from '@/lib/social-hub/blue-chip-players';
import { logoForPlayer } from '@/lib/social-hub/logo-bank';

import { templateCard } from './catalog';
import { TEMPLATE_GEOMETRY, type SlotBox } from './geometry';

export type SlotFill =
  | { slot: string; kind: 'entity'; playerId: string }
  | { slot: string; kind: 'text'; text: string; factIds: string[] }
  | { slot: string; kind: 'viewer'; situationId: string; text: string };

export type MemeFill = { templateId: string; fills: SlotFill[] };

export type RenderContent =
  | { type: 'text'; text: string }
  | {
      type: 'chip';
      name: string;
      logo: { file: string; plate: 'light' | 'dark' } | null;
      /** A company's wordmark already spells its name, so the chip is the logo alone; a symbol or a person shows the name. */
      showName: boolean;
      /** A person's chip may drop the logo when it can't fit; their name alone still names them exactly. */
      logoOptional: boolean;
    };

export type RenderItem = { slot: string; box: SlotBox; content: RenderContent };

export type RenderSpec = { templateId: string; image: string; width: number; height: number; items: RenderItem[] };

/** The format's line around the writer's part: "You guys are getting {x}?" with x filled. */
export function applyPattern(pattern: string, x: string): string {
  return pattern.replace('{x}', x.trim().replace(/[?.!,]+$/, ''));
}

/** "tHiS iS fInE": alternating case over letters only, the way the format is written. */
export function mockingCase(text: string): string {
  let i = 0;
  return [...text].map((c) => (/[a-z]/i.test(c) ? (i++ % 2 === 0 ? c.toLowerCase() : c.toUpperCase()) : c)).join('');
}

export function chipFor(p: BluePlayer): RenderContent {
  const logo = logoForPlayer(p);
  const person = p.kind === 'person';
  return {
    type: 'chip',
    name: p.name,
    logo: logo ? { file: logo.file, plate: logo.plate } : null,
    showName: person || !logo || logo.mark === 'symbol',
    logoOptional: person,
  };
}

function contentOf(fill: SlotFill): RenderContent {
  if (fill.kind === 'entity') {
    const p = bluePlayer(fill.playerId);
    if (!p) throw new Error(`unknown player id "${fill.playerId}"`);
    return chipFor(p);
  }
  return { type: 'text', text: fill.text };
}

/** Every slot to draw, in card order. Throws when a fill is missing or names an unknown slot. */
export function resolveMeme(meme: MemeFill): RenderSpec {
  const card = templateCard(meme.templateId);
  const geo = TEMPLATE_GEOMETRY[meme.templateId];
  if (!card || !geo) throw new Error(`unknown template "${meme.templateId}"`);
  const bySlot = new Map(meme.fills.map((f) => [f.slot, f]));
  for (const f of meme.fills) {
    if (!card.slots.some((x) => x.id === f.slot && x.accepts.length > 0)) throw new Error(`${card.id} has no writable slot "${f.slot}"`);
  }
  const items: RenderItem[] = [];
  for (const slot of card.slots) {
    const box = geo.slots[slot.id];
    if (!box) throw new Error(`${card.id}.${slot.id} has no geometry`);
    if (slot.fixed) {
      items.push({ slot: slot.id, box, content: { type: 'text', text: slot.fixed } });
      continue;
    }
    if (slot.derived) {
      const src = bySlot.get(slot.derived.from);
      if (!src) throw new Error(`${card.id}.${slot.id} derives from an empty slot`);
      // A derived slot with its own format line wraps the writer's part, not the source's printed line (Oprah's top line).
      if (slot.pattern && src.kind !== 'entity') {
        items.push({ slot: slot.id, box, content: { type: 'text', text: applyPattern(slot.pattern, src.text) } });
        continue;
      }
      const drawn = items.find((i) => i.slot === slot.derived!.from);
      const base = drawn?.content ?? contentOf(src);
      if (slot.derived.as === 'repeat' || base.type === 'chip') items.push({ slot: slot.id, box, content: base });
      else if (slot.derived.as === 'mocking-case') items.push({ slot: slot.id, box, content: { type: 'text', text: mockingCase(base.text) } });
      else items.push({ slot: slot.id, box, content: { type: 'text', text: `${base.text} everywhere` } });
      continue;
    }
    const fill = bySlot.get(slot.id);
    if (!fill) {
      if (slot.fallback) {
        items.push({ slot: slot.id, box, content: { type: 'text', text: slot.fallback } });
        continue;
      }
      if (slot.optional) continue;
      throw new Error(`${card.id}.${slot.id} is empty`);
    }
    if (!slot.accepts.includes(fill.kind)) throw new Error(`${card.id}.${slot.id} takes ${slot.accepts.join('/')}, not ${fill.kind}`);
    const content = contentOf(fill);
    items.push({ slot: slot.id, box, content: slot.pattern && content.type === 'text' ? { type: 'text', text: applyPattern(slot.pattern, content.text) } : content });
  }
  return { templateId: card.id, image: `lib/memes/assets/templates/${card.image}`, width: card.width, height: card.height, items };
}
