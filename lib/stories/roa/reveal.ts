/**
 * The reveal's payoff (roa-reveal@2; RA-26). No tells and no pen circle: every round closes on what made the image.
 *
 *   AI, ours (generated)       the prompt that made it, shown on a card. No model call.
 *   AI, no prompt to show      (imported, RA-27) the effort gap: a line saying what a real photo of it would have
 *                              taken when large, else the origin card (model, where it came from), built by code
 *   real, effort gap large     a line saying what it took to get the shot (written with the image attached)
 *   real, effort low/unclear   the camera card (camera, settings, when and where), built by code from the provenance
 *
 * writeStructured caches the tools and the system prompt; the image rides in the uncached user turn (this file wraps
 * `create` to put it there, so the stable prefix and its breakpoint are unchanged).
 */
import sharp from 'sharp';

import { material } from '@/lib/stories/prompts';
import type { StoriesSettings } from '@/lib/stories/settings';
import { writeStructured, type WriterCreate } from '@/lib/stories/writer';
import type { StoriesDb } from '@/lib/stories/db';

import { originOf, receiptOf } from './camera';
import { ROA_REVEAL, type RoaRevealMaterial, type RoaRevealOut } from './prompts';
import type { Provenance, RoaPayoff, Truth } from './types';
import { ROA_REVEAL_MAX_CHARS, ROA_REVEAL_MAX_WORDS } from './types';
import { lineProblems, promptProblems, text } from './validate';

const EMOJI_ANY = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20E3\uFE0F]/gu;

/** The attached image: long side at most this (Claude's vision sweet spot). */
export const REVEAL_IMAGE_MAX_SIDE = 1568;
/**
 * Tries at a clean line. Each retry sees the earlier line and exactly what to cut. After the last try the round fails
 * open (Lucas, 2026-11-15: "We shouldn't be dropping photos because of the reveal line"): the best line is kept, cleaned,
 * and flagged for the approval step.
 */
export const REVEAL_TRIES = 3;

export type RevealDeps = { db: StoriesDb; write: WriterCreate; settings: StoriesSettings; setId?: string | null };
export type RevealInput = { jpeg: Buffer; truth: Truth; provenance: Provenance; about?: Extract<RoaRevealMaterial, { image: 'real photo' }>['about'] };
export type RevealResult =
  | {
      ok: true;
      payoff: RoaPayoff;
      /** The effort line (payoff `effort`), else empty. */
      line: string;
      /** For the approval step: a line that failed open, or a camera card with nothing on it. */
      flags?: string[];
    }
  | { ok: false; archive: boolean; problems: string[] };

/** Wrap `create` so the first user turn carries the image before the material. */
export function withImage(create: WriterCreate, jpegBase64: string): WriterCreate {
  return (params) => {
    const messages = (params.messages as Array<{ role: string; content: unknown }>).map((m, i) =>
      i === 0 && typeof m.content === 'string'
        ? { ...m, content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } }, { type: 'text', text: m.content }] }
        : m,
    );
    return create({ ...params, messages });
  };
}

export function revealMaterial(input: RevealInput, problems?: string[]): RoaRevealMaterial {
  const p = input.provenance;
  const extra = problems?.length ? { problems } : {};
  if (input.truth === 'ai') {
    const from = p.kind === 'dataset' ? `the ${p.dataset} dataset` : p.kind === 'viral' ? 'a post shared online' : 'an image model';
    const model = 'model' in p && p.model ? p.model : undefined;
    return { image: 'AI image', made: { ...(model ? { model } : {}), from }, ...extra };
  }
  const about = input.about ?? (p.kind === 'bank' || p.kind === 'commons' || p.kind === 'nasa' ? { place: p.place, year: p.year } : null);
  return { image: 'real photo', source: 'photo archive', about, ...extra };
}

/** The card shown when there is no effort line: the camera card (real) or the origin card (AI). */
function cardPayoff(input: RevealInput): { payoff: RoaPayoff; flags?: string[] } {
  if (input.truth === 'ai') return { payoff: 'origin' };
  return { payoff: 'camera', ...(receiptOf(input.provenance) ? {} : { flags: ['camera card: no camera details, date or place'] }) };
}

/** Choose and check the payoff. Throws only when the model call itself fails. */
export async function writeReveal(deps: RevealDeps, input: RevealInput): Promise<RevealResult> {
  const p = input.provenance;
  // An AI image we generated shows the prompt that made it (RA-26). One with no usable prompt goes by the effort gap
  // like a real photo (RA-27), so imported images are never dropped for want of a prompt.
  if (input.truth === 'ai' && p.kind === 'generated' && !promptProblems(p.prompt).length) return { ok: true, payoff: 'prompt', line: '' };
  const small = await sharp(input.jpeg).resize({ width: REVEAL_IMAGE_MAX_SIDE, height: REVEAL_IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const create = withImage(deps.write, small.toString('base64'));
  let problems: string[] = [];
  let best: { line: string; problems: string[] } | null = null;
  for (let attempt = 0; attempt < REVEAL_TRIES; attempt++) {
    const out = (await writeStructured<RoaRevealOut>({
      create, db: deps.db, setId: deps.setId ?? null, component: 'roa-reveal', model: deps.settings.models.copy,
      system: ROA_REVEAL.system, tool: ROA_REVEAL.tool, user: material(revealMaterial(input, problems)),
    })).value;
    if (out?.effort !== 'large') {
      const card = cardPayoff(input);
      return { ok: true, payoff: card.payoff, line: '', ...(card.flags ? { flags: card.flags } : {}) };
    }
    const line = text(out.line);
    const found = lineProblems(line);
    if (!found.length) return { ok: true, payoff: 'effort', line };
    if (line && (!best || found.length < best.problems.length || (found.length === best.problems.length && line.length < best.line.length))) best = { line, problems: found };
    problems = revisionNotes(line, found);
  }
  // Fail open: never drop a good image over its copy.
  if (best) {
    const line = cleanLine(best.line);
    const flags = lineProblems(line);
    return { ok: true, payoff: 'effort', line, ...(flags.length ? { flags } : {}) };
  }
  // A large gap with no usable line: the card closes the round instead.
  const card = cardPayoff(input);
  return { ok: true, payoff: card.payoff, line: '', flags: ['effort line: empty after every try', ...(card.flags ?? [])] };
}

/** What the next try sees: the earlier line and exactly what to change, so it revises instead of starting over. */
export function revisionNotes(line: string, found: string[]): string[] {
  if (!line) return ['The earlier line was empty. Write a line.'];
  const words = line.split(/\s+/).filter(Boolean).length;
  const notes = [`The earlier line was: "${line}" (${words} words, ${line.length} characters).`];
  if (words > ROA_REVEAL_MAX_WORDS || line.length > ROA_REVEAL_MAX_CHARS)
    notes.push(`Keep its meaning and cut it to at most ${ROA_REVEAL_MAX_WORDS} words and ${ROA_REVEAL_MAX_CHARS} characters: drop filler words first.`);
  for (const f of found) if (!/words|chars/.test(f)) notes.push(f);
  return notes;
}

/** The fail-open line: exclamation marks become full stops, emoji go. Length is left alone: the slide fits its text. */
export function cleanLine(line: string): string {
  return line.replace(/!+/g, '.').replace(EMOJI_ANY, '').replace(/\s{2,}/g, ' ').trim();
}
