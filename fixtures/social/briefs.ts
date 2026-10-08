/**
 * Fixture Reporter brief in the submit_brief shape (structured output,
 * 2026-10-05). Hand-built from TechCrunch, "Trump unveils his new Super
 * Intelligence Force" (Anthony Ha, 2026-10-04); every quote and number is
 * copied exactly from that article's text.
 */
import type { Brief } from '@/lib/social/reporter/brief';

export const TC_URL = 'https://techcrunch.com/2026/10/04/trump-unveils-his-new-super-intelligence-force/';

export const Q1_TEXT =
  'The Super Intelligence Force is tasked with coordinating the effort of the Federal Government to ensure that America continues to lead the World in Super Intelligence, which many say is bigger than the Industrial Revolution, and the Internet, and will protect the interests, and improve the lives, of all Americans,';

const TC = ['TechCrunch'];
const TC_WSJ = ['TechCrunch', 'The Wall Street Journal'];

export function briefSuperIntelligenceForce(): Brief {
  return {
    single_story: { yes: true, note: null },
    the_news: {
      text: 'President Donald Trump announced a new Super Intelligence Force on Sunday, Oct. 4, 2026, to be led by national intelligence director Jay Clayton.',
      ids: ['F1', 'F2'],
    },
    why_it_matters: [
      { text: "The task force's charter reportedly says it will plan responses to SI-enabled threats while preventing overregulation.", ids: ['F6'] },
      { text: 'It will reportedly have 120 days to report on the risks and opportunities presented by AI.', ids: ['F4'] },
    ],
    // The story shape (copy overhaul, 2026-10-07): events in order, plot beats, tensions; every line arranges listed facts.
    timeline: [
      { date: '2026-09', what: 'Trump says he will form an AI Force and appoint an AI czar', ids: ['B1'] },
      { date: '2026-10-04', what: 'Trump announces the Super Intelligence Force on Truth Social', ids: ['F1'] },
    ],
    plot: [
      { beat: 'SETUP', text: 'Trump had promised an AI Force and rebranded AI as super intelligence', ids: ['B1', 'B2'] },
      { beat: 'TRIGGER', text: 'He announces the Super Intelligence Force, led by Jay Clayton', ids: ['F1', 'F2'] },
      { beat: 'CONFLICT', text: 'Its charter pairs planning for SI-enabled threats with preventing overregulation', ids: ['F6'] },
      { beat: 'OPEN', text: 'What its 120-day report will say', ids: ['F4'] },
    ],
    tensions: [{ text: 'The charter aims both to plan for SI-enabled threats and to prevent overregulation', ids: ['F6'] }],
    facts: [
      { id: 'F1', text: 'Trump announced the formation of a new Super Intelligence Force in a Sunday morning post on Truth Social.', sources: TC, claim_by: null, notes: [] },
      { id: 'F2', text: 'Trump said the force will be led by national intelligence director Jay Clayton and other members of his administration.', sources: TC, claim_by: null, notes: [] },
      { id: 'F3', text: 'The Wall Street Journal reports that Clayton will chair the force, with FTC Chair Andrew Ferguson, Undersecretary of War for Research and Engineering Emil Michael and OPM Director Scott Kupor as vice chairs.', sources: TC_WSJ, claim_by: null, notes: [] },
      { id: 'F4', text: 'The task force will reportedly have 120 days to create a report on the risks and opportunities presented by AI.', sources: TC_WSJ, claim_by: null, notes: [] },
      { id: 'F5', text: 'The force is tasked with coordinating the federal effort to ensure America leads in super intelligence.', sources: TC, claim_by: 'Trump', notes: [] },
      { id: 'F6', text: "The task force's charter reportedly says it will develop plans for responding to SI-enabled threats while preventing overregulation.", sources: TC_WSJ, claim_by: null, notes: [] },
    ],
    background: [
      { id: 'B1', text: 'In September, Trump said he would form an AI Force and appoint an AI czar.', sources: TC, claim_by: null, notes: [] },
      { id: 'B2', text: 'Trump signed an executive order seeking to rebrand AI as "super intelligence."', sources: TC, claim_by: null, notes: [] },
    ],
    quotes: [
      { id: 'Q1', text: Q1_TEXT, speaker: 'Donald Trump', speaker_id: 'S1', where: 'Truth Social post', via: TC, single_source: true, cut_off: false, notes: [] },
      { id: 'Q2', text: 'develop plans for responding to SI-enabled threats to our society, while preventing overregulation and regulatory capture that would stifle innovation and competition.', speaker: 'Super Intelligence Force charter', speaker_id: 'S3', where: 'as reported by The Wall Street Journal', via: TC, single_source: true, cut_off: false, notes: [] },
      { id: 'Q3', text: 'not being first.', speaker: 'Jay Clayton', speaker_id: 'S2', where: 'to The Wall Street Journal', via: TC, single_source: true, cut_off: true, notes: [] },
    ],
    numbers: [
      { id: 'N1', value: '120 days', type: 'duration', counts: 'time the task force has to report on the risks and opportunities presented by AI', sources: TC, notes: [] },
    ],
    terms: [
      { name: 'Super Intelligence Force', definition: "a new task force Trump announced to coordinate the federal government's effort on super intelligence", source: 'TechCrunch' },
    ],
    subjects: [
      { id: 'S1', name: 'Donald Trump', role: 'President of the United States', type: 'person' },
      { id: 'S2', name: 'Jay Clayton', role: 'national intelligence director; chair of the Super Intelligence Force', type: 'person' },
      // Everyone quoted is a SUBJECT (Tommy, 2026-10-07): Q2 quotes the task force's charter.
      { id: 'S3', name: 'Super Intelligence Force', role: 'new federal AI task force; its charter is quoted', type: 'organization' },
    ],
    events: [],
    article_photos: [
      { caption: null, credit: 'Image Credits:Kevin Dietsch / Staff / Getty Images', url: 'https://techcrunch.com/wp-content/uploads/2026/09/GettyImages-2297764008.jpg', page: TC_URL },
    ],
    not_answered: ["The task force's budget and staff.", 'When the 120 days start.'],
    sources: [{ outlet: 'TechCrunch', date: 'October 4, 2026', url: TC_URL, kind: 'original' }],
    fetch_failures: [],
  };
}
