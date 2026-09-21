/**
 * Named-subject photo lookup — the Path A source.
 *
 * A story's core subject (a CEO, researcher, founder) resolves to their
 * Wikipedia article URL. The compose pipeline hands that URL to
 * lib/social/ingest/extract-image.ts which returns the article's og:image
 * (typically a press photo). We mirror the file into public/social/ or
 * Supabase Storage so we don't hotlink Wikipedia on every render.
 *
 * Add subjects as stories come through. Keys are lowercased for
 * case-insensitive lookup; values are the full Wikipedia article URL.
 */
export const NAMED_SUBJECTS: Record<string, string> = {
  'sam altman': 'https://en.wikipedia.org/wiki/Sam_Altman',
  'dario amodei': 'https://en.wikipedia.org/wiki/Dario_Amodei',
  'daniela amodei': 'https://en.wikipedia.org/wiki/Dario_Amodei',
  'mira murati': 'https://en.wikipedia.org/wiki/Mira_Murati',
  'julie sweet': 'https://en.wikipedia.org/wiki/Julie_Sweet',
  'satya nadella': 'https://en.wikipedia.org/wiki/Satya_Nadella',
  'sundar pichai': 'https://en.wikipedia.org/wiki/Sundar_Pichai',
  'demis hassabis': 'https://en.wikipedia.org/wiki/Demis_Hassabis',
  'mark zuckerberg': 'https://en.wikipedia.org/wiki/Mark_Zuckerberg',
  'jensen huang': 'https://en.wikipedia.org/wiki/Jensen_Huang',
  'yann lecun': 'https://en.wikipedia.org/wiki/Yann_LeCun',
  'ilya sutskever': 'https://en.wikipedia.org/wiki/Ilya_Sutskever',
};

/** Return the Wikipedia URL for a subject name, or null if unknown. */
export function resolveSubject(name: string): string | null {
  return NAMED_SUBJECTS[name.trim().toLowerCase()] ?? null;
}
