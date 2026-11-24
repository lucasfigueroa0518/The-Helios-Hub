import type { Entry, EntryField, OneBoxInput } from './types';

/**
 * Each pool's existing input, as the agent must return it (design: "it should give each content type back exactly what it needs
 * currently"). These are the fields the pool's add function takes today; the one-box invents no new shape. Fields the code
 * fills from the verified page (Text on Screen's text, Explainers' source text) or from the person's own words (Stories
 * Headline's notes) are not asked of the agent.
 */
export type Shape = { required: EntryField[]; optional: EntryField[]; urlField: 'url' | 'sourceUrl'; label: string };

export const SHAPES = {
  reels: { label: 'Text on Screen', required: ['headline', 'url'], optional: [], urlField: 'url' },
  carousels: { label: 'Carousels', required: ['url', 'headline'], optional: [], urlField: 'url' },
  last_few_days: { label: 'Last Few Days', required: ['url', 'headline'], optional: [], urlField: 'url' },
  stories: { label: 'Stories, Morning Download', required: ['headline', 'url'], optional: [], urlField: 'url' },
  explainers: { label: 'Explainers', required: ['title', 'sourceUrl'], optional: [], urlField: 'sourceUrl' },
  field_notes: { label: 'Field Notes', required: ['headline', 'url'], optional: [], urlField: 'url' },
} as const satisfies Record<string, Shape>;

export type ShapeKey = keyof typeof SHAPES;

/** Trivia, Real or AI? and AI Drama are filed by their own runners, not by the source search, so they have no shape here. */
export function shapeKey(input: Pick<OneBoxInput, 'vertical'>): ShapeKey {
  if (!(input.vertical in SHAPES)) throw new Error(`${input.vertical} has no search shape; its runner files it.`);
  return input.vertical as ShapeKey;
}

export const shapeOf = (input: Pick<OneBoxInput, 'vertical'>): Shape => SHAPES[shapeKey(input)];

/** The fields that are missing or blank (empty when the entry is complete). */
export function missingFields(shape: Shape, entry: Entry): EntryField[] {
  return shape.required.filter((f) => !entry[f]?.trim());
}

/** The page this entry stands on: its url / sourceUrl. */
export const entryUrl = (shape: Shape, entry: Entry): string => (entry[shape.urlField] ?? '').trim();

/** A short name for an entry, for messages and the duplicate check. */
export const entryTitle = (entry: Entry): string => entry.headline ?? entry.title ?? entry.toolName ?? entry.fact ?? entry.url ?? entry.sourceUrl ?? '';
