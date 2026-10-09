/**
 * Fixture draft (submit_draft shape) for the Super Intelligence Force
 * fixture brief: 6 story slides, every rule the Writer check enforces met
 * (sixth round: a visual and a fallback visual per cover option and slide;
 * slide types text, stat and quote).
 */
import type { DraftSubmission, VisualRequest } from '@/lib/social/writer/draft';

const v = (kind: VisualRequest['kind'], query: string): VisualRequest => ({ kind, query });
const text = (headline: string, hFacts: string[], body: string, bFacts: string[]) => ({
  type: 'text' as const,
  headline: { text: headline, facts: hFacts },
  body: { text: body, facts: bFacts },
  quote_id: null,
  quote_excerpt: null,
  number_ids: [],
});

export function sifDraft(): DraftSubmission {
  return {
    cover_options: [
      { text: "Trump launches a Super Intelligence Force, led by his spy chief", facts: ['F1', 'F2'], visual: v('person', 'Donald Trump'), fallback_visual: v('setting', 'government building'), subject_ids: ['S1', 'S3'], icon: 'landmark' },
      { text: "Trump's new AI task force has 120 days", facts: ['F4'], visual: v('thematic', 'wall clock'), fallback_visual: v('setting', 'briefing room'), subject_ids: ['S1'], icon: 'clock' },
      { text: 'The White House names its AI czar', facts: ['F3'], visual: v('setting', 'government building'), fallback_visual: v('thematic', 'office desk'), subject_ids: [], icon: 'landmark' },
    ],
    chosen_cover: 1,
    slides: [
      { ...text('Announced on Truth Social', ['F1'], 'Trump announced the force in a Sunday morning post on Truth Social.', ['F1']), visual: v('person', 'Donald Trump'), fallback_visual: v('thematic', 'smartphone screen'), subject_ids: ['S1'], icon: 'smartphone' },
      { ...text('Clayton will chair it', ['F3'], 'The Wall Street Journal reports Clayton will chair the force, with three vice chairs.', ['F3']), visual: v('person', 'Jay Clayton'), fallback_visual: v('setting', 'government office'), subject_ids: ['S2'], icon: 'user' },
      {
        type: 'quote', headline: { text: 'His pitch for the force', facts: ['Q1'] }, body: null, quote_id: 'Q1',
        quote_excerpt: 'The Super Intelligence Force is tasked with coordinating the effort of the Federal Government … of all Americans,',
        number_ids: [], visual: v('person', 'Donald Trump'), fallback_visual: v('thematic', 'flag on a pole'), subject_ids: ['S1'], icon: 'message-square-quote',
      },
      { type: 'stat', headline: { text: 'It has a deadline', facts: ['N1'] }, body: null, quote_id: null, quote_excerpt: null, number_ids: ['N1'], visual: v('thematic', 'wall clock'), fallback_visual: v('thematic', 'calendar page'), subject_ids: [], icon: 'clock' },
      { ...text('What the charter says', ['F6'], 'The charter reportedly says it will plan responses to SI-enabled threats while preventing overregulation.', ['F6']), visual: v('thematic', 'legal documents'), fallback_visual: v('setting', 'government office'), subject_ids: [], icon: 'file-text' },
      { ...text('Why the name matters', ['B2'], 'Trump signed an executive order seeking to rebrand AI as super intelligence.', ['B2']), visual: v('thematic', 'pen and paper'), fallback_visual: v('thematic', 'signed document'), subject_ids: ['S1'], icon: 'file-text' },
    ],
    follow: 'Follow Helios for AI news without the hype.',
    caption: { text: 'Trump announced a Super Intelligence Force on Sunday. Source: TechCrunch, October 4, 2026.', facts: ['F1'] },
    edit_notes: [],
  };
}

/** The same draft; kept as the name the handoff tests use (the sixth round has one Writer format). */
export function sifDraftHandoff(): DraftSubmission {
  const d = sifDraft();
  // alt_visuals are required by the handoff check (2026-10-09): two plain scenes per place, distinct from every visual and fallback.
  const alts = (): VisualRequest[] => [{ kind: 'thematic', query: 'server racks' }, { kind: 'setting', query: 'empty meeting room' }];
  d.cover_options.forEach((c) => (c.alt_visuals = alts()));
  d.slides.forEach((x) => (x.alt_visuals = alts()));
  return d;
}
