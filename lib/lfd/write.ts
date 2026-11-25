/**
 * Slide-copy rules for Last Few Days. The writer itself is the shared news writer (lib/news-writer writeStories('lfd'),
 * used by the run and the Social Hub's wording fix); what is left here is code: the ordinal keys the model sees, the
 * limits a person's edit is held to, and normalize (dash, final period, highlight, setup count).
 */
import { FORMATS } from '@/lib/news-writer/prompts';

import type { StoryCopy } from './types';

/** A person's edit is held to the news writer's caps (headline, body); a setup line (older posts) to 90 characters. */
export const LIMITS = { setup: 90, headline: FORMATS.lfd.caps.headline, body: FORMATS.lfd.caps.body } as const;
export const MAX_SETUPS = 2;

/** The trims normalize applies. */
const cleanHeadline = (h: string) => h.trim().replace(/^[–-]\s*/, '').trim();
const cleanBody = (b: string) => b.trim().replace(/\.+$/, '');

export function normalize(copies: StoryCopy[], rank: string[]): StoryCopy[] {
  const order = (k: string) => { const i = rank.indexOf(k); return i === -1 ? rank.length : i; };
  const setupKeys = new Set(
    copies.filter((s) => s.setup.trim()).sort((a, b) => order(a.key) - order(b.key)).slice(0, MAX_SETUPS).map((s) => s.key),
  );
  return copies.map((s) => {
    const headline = cleanHeadline(s.headline);
    const highlight = s.highlight && headline.includes(s.highlight) ? s.highlight : '';
    return {
      ...s,
      headline,
      highlight,
      setup: setupKeys.has(s.key) ? s.setup.trim() : '',
      body: cleanBody(s.body),
      names: s.names.filter((n) => n.trim()),
    };
  });
}

/** The key the model sees for item i: short ordinals, so long feed keys never reach the model (code maps them back). */
export const ordinalKey = (i: number) => `s${i + 1}`;
