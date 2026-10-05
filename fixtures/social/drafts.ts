/**
 * Fixture draft (submit_draft shape) for the Super Intelligence Force
 * fixture brief: 6 story slides, every rule the Writer check enforces met.
 */
import type { DraftSubmission } from '@/lib/social/writer/draft';

const stock = (value: string) => ({ kind: 'stock' as const, value });
const text = (headline: string, hFacts: string[], body: string, bFacts: string[]) => ({
  type: 'text' as const,
  headline: { text: headline, facts: hFacts },
  body: { text: body, facts: bFacts },
  quote_id: null,
  quote_excerpt: null,
  number_ids: [],
  spread_with_next: false,
});

export function sifDraft(): DraftSubmission {
  return {
    cover_options: [
      { text: "Trump launches a Super Intelligence Force, led by his spy chief", facts: ['F1', 'F2'], image: { kind: 'subject', value: 'Donald Trump' } },
      { text: "Trump's new AI task force has 120 days", facts: ['F4'], image: stock('wall clock') },
      { text: 'The White House names its AI czar', facts: ['F3'], image: stock('White House') },
    ],
    chosen_cover: 1,
    slides: [
      { ...text('Announced on Truth Social', ['F1'], 'Trump announced the force in a Sunday morning post on Truth Social.', ['F1']), image: { kind: 'subject', value: 'Jay Clayton' } },
      { ...text('Clayton will chair it', ['F3'], 'The Wall Street Journal reports Clayton will chair the force, with three vice chairs.', ['F3']), image: stock('government building') },
      {
        type: 'quote', headline: { text: 'His pitch', facts: ['Q1'] }, body: null, quote_id: 'Q1',
        quote_excerpt: 'The Super Intelligence Force is tasked with coordinating the effort of the Federal Government … of all Americans,',
        number_ids: [], image: stock('flag on a pole'), spread_with_next: false,
      },
      { type: 'stat', headline: { text: 'It has a deadline', facts: ['N1'] }, body: null, quote_id: null, quote_excerpt: null, number_ids: ['N1'], image: stock('wall clock'), spread_with_next: false },
      { ...text('What the charter says', ['F6'], 'The charter reportedly says it will plan responses to SI-enabled threats while preventing overregulation.', ['F6']), image: stock('legal documents') },
      { ...text('Why the name', ['B2'], 'Trump signed an executive order seeking to rebrand AI as super intelligence.', ['B2']), image: stock('pen and paper') },
    ],
    follow: 'Follow Helios for AI news without the hype.',
    caption: { text: 'Trump announced a Super Intelligence Force on Sunday. Source: TechCrunch, October 4, 2026.', facts: ['F1'] },
    edit_notes: [],
  };
}
