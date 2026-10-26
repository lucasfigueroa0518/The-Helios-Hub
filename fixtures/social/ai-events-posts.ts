/**
 * AI Events This Week sample posts (plan M5): one per look at max copy, and a min-copy variant of each
 * (two cities, one or two events). The events are SAMPLES: plausible but invented names, hosts and
 * venues, never real listings. Raw titles carry the clutter real listings have (emoji, pipes, city and
 * date fragments) so the title cleaner runs on them. Used by the preview route
 * (/social/render/preview?fixture=ae-spotlight&all=1), the gallery (/social/render/preview/ai-events)
 * and tests/ai-events-render.integration.ts.
 */
import type { HookKey } from '@/lib/ai-events/hooks';
import type { Look } from '@/lib/ai-events/looks';
import { buildAiEventsCityPost, buildAiEventsPost } from '@/lib/ai-events/post';
import type { AiEventsCityPostInput, AiEventsMetro, AiEventsPostInput, PickedEvent } from '@/lib/ai-events/types';
import type { AeRankLayout, AeRankTreat, Post } from '@/lib/social/render/types';

type Sample = Partial<PickedEvent> & Pick<PickedEvent, 'title' | 'start'>;

const FREE = { free: true, minCents: 0, maxCents: 0, currency: 'USD' };
const paid = (min: number, max = min) => ({ free: false, minCents: min * 100, maxCents: max * 100, currency: 'USD' });

let seq = 0;
const ev = (metro: AiEventsMetro, s: Sample): PickedEvent => ({
  id: `sample-${metro}-${++seq}`,
  end: null,
  timezone: metro === 'sf' ? 'America/Los_Angeles' : 'America/New_York',
  metro,
  organizer: null,
  venue: null,
  city: null,
  price: FREE,
  access: 'open',
  soldOut: false,
  waitlist: false,
  going: null,
  rsvpUrl: `https://example.com/sample-events/${metro}/${seq}`,
  ...s,
});

export const SAMPLE_WEEK = { weekKey: '2026-W44', weekStart: '2026-10-26', weekEnd: '2026-11-01' } as const;

/** Every field at the longest the slides take (lib/ai-events/post.ts COPY_MAX), all four cities, three events each. */
export const SAMPLE_MAX: AiEventsPostInput['cities'] = [
  {
    metro: 'miami',
    remainingCount: 12,
    picks: [
      ev('miami', {
        title: '🚀 Founders & Funders: Applied AI in Healthcare, Fintech and Real Estate | Miami | Oct 27',
        start: '2026-10-27T22:30:00Z',
        organizer: 'South Florida Applied AI Collective',
        venue: 'Brickell Innovation Hub, 1450 Brickell Ave, Miami, FL',
        city: 'Miami',
        access: 'apply',
        signals: { format: 'networking' },
      }),
      ev('miami', {
        title: 'Generative AI Product Demo Night with Local Founders and Operators!!',
        start: '2026-10-28T23:00:00Z',
        organizer: 'Wynwood Product Builders Guild',
        venue: 'Wynwood Commons Event Loft',
        city: 'Miami',
        price: paid(25),
      }),
      ev('miami', {
        title: 'Agents in Production: Lessons From Teams Shipping LLM Systems (In-Person)',
        start: '2026-10-29T22:00:00Z',
        organizer: 'Miami Machine Learning Society',
        venue: 'Downtown Miami Technology Hall',
        city: 'Miami',
        soldOut: true,
        waitlist: true,
        signals: { format: 'talk' },
      }),
    ],
  },
  {
    metro: 'boston',
    remainingCount: 27,
    picks: [
      ev('boston', {
        title: 'Robotics and AI Founders Breakfast in the Seaport Innovation District ☕',
        start: '2026-10-27T12:30:00Z',
        organizer: 'Seaport Robotics and AI Founders',
        venue: 'Harborview Innovation Center',
        city: 'Boston',
      }),
      ev('boston', {
        title: 'Oct 28: Applied LLM Research Night on Evaluation, Safety and Reliability (Boston)',
        start: '2026-10-28T22:00:00Z',
        organizer: 'Cambridge Applied ML Reading Group',
        venue: 'Kendall Square Commons, 1 Main St',
        city: 'Cambridge',
        access: 'approval',
      }),
      ev('boston', {
        title: 'AI HACK NIGHT: BUILD AN AGENT IN THREE HOURS WITH MENTORS FROM LOCAL LABS',
        start: '2026-10-31T17:00:00Z',
        organizer: 'Boston AI Hack Collective',
        venue: 'Back Bay Builders Loft',
        city: 'Boston',
        price: paid(15),
      }),
    ],
  },
  {
    metro: 'nyc',
    remainingCount: 31,
    picks: [
      ev('nyc', {
        title: 'Data and AI Leaders Dinner for Founders, Investors and Operators • NYC',
        start: '2026-10-27T23:00:00Z',
        organizer: 'Flatiron AI Leaders Circle',
        venue: 'Flatiron Commons Rooftop',
        city: 'New York',
        price: paid(85, 150),
      }),
      ev('nyc', {
        title: 'Multimodal AI Meetup: Vision, Voice and Video Models in Production 🎥',
        start: '2026-10-28T22:30:00Z',
        organizer: 'NYC Multimodal AI Meetup Group',
        venue: 'Chelsea Studios Event Space',
        city: 'New York',
      }),
      ev('nyc', {
        title: 'Fireside Chat: Building an AI-Native Startup From Zero to Series A - Thu, Oct 29',
        start: '2026-10-29T22:00:00Z',
        organizer: 'Hudson Yards Founders Forum',
        venue: 'Hudson Yards Conference Hall',
        city: 'New York',
        soldOut: true,
      }),
    ],
  },
  {
    metro: 'sf',
    remainingCount: 40,
    picks: [
      ev('sf', {
        title: 'Bay Area Applied AI Conference 2026: Agents, Infrastructure and Product',
        start: '2026-10-28T16:00:00Z',
        end: '2026-10-30T00:30:00Z',
        organizer: 'Bay Area Applied AI Conference',
        venue: 'Moscone Center West, 800 Howard St',
        city: 'San Francisco',
        price: paid(299, 899),
        signals: { format: 'conference' },
      }),
      ev('sf', {
        title: '[SF] Open Source AI Builders Demo Night: Agents, Evals and Developer Tools',
        start: '2026-10-29T01:30:00Z',
        organizer: 'Mission District Open Source AI',
        venue: 'Mission Bay Developer Commons',
        city: 'San Francisco',
      }),
      ev('sf', {
        title: 'AI Founders Dinner for Second-Time Founders Building in Applied AI @ Palo Alto',
        start: '2026-10-30T02:00:00Z',
        organizer: 'Sand Hill Second Founders',
        venue: 'Palo Alto Garden Room',
        city: 'Palo Alto',
        access: 'apply',
      }),
    ],
  },
];

/** The fewest the post allows: two cities, one and two events, short copy, one city with nothing more on the calendar. */
export const SAMPLE_MIN: AiEventsPostInput['cities'] = [
  {
    metro: 'boston',
    remainingCount: 0,
    picks: [ev('boston', { title: '☕ AI Builders Breakfast | Boston', start: '2026-10-28T12:00:00Z', venue: 'Fort Point Hall' })],
  },
  {
    metro: 'sf',
    remainingCount: 6,
    picks: [
      ev('sf', { title: 'Agents Hack Night', start: '2026-10-28T01:00:00Z', organizer: 'SoMa Builders', venue: 'SoMa Commons', city: 'San Francisco' }),
      ev('sf', { title: 'Evals Meetup', start: '2026-10-30T01:30:00Z', organizer: 'Bay Evals Club', venue: 'Hacker Hall', city: 'San Jose', price: paid(10) }),
    ],
  },
];

export const sampleInput = (look: Look, hookKey: HookKey, copy: 'max' | 'min' = 'max'): AiEventsPostInput => ({
  ...SAMPLE_WEEK,
  cities: copy === 'max' ? SAMPLE_MAX : SAMPLE_MIN,
  hookKey,
  look,
  issueNumber: 1,
});

/** A #1 for each post city, held back on the tease (AE-29); at max copy. */
const RANKED_TOP: Record<'miami' | 'boston', PickedEvent> = {
  miami: ev('miami', {
    title: 'Coral Gables AI Night: Founders, Operators and Investors Mixer at the Shores',
    start: '2026-10-27T22:00:00Z',
    organizer: 'Coral Gables Founders Circle',
    venue: 'The Shores Innovation Center',
    city: 'South Miami',
  }),
  boston: ev('boston', {
    title: 'Boston Applied AI Summit Side Event: Founders, Researchers and Investors Night',
    start: '2026-10-29T22:30:00Z',
    organizer: 'Cambridge Venture Builders Forum',
    venue: 'Kendall Square Innovation Commons',
    city: 'Cambridge',
  }),
};

/**
 * One city's ranked post (AE-29): #1 plus the city's three max-copy samples as #2–#4 (`min`: #1 and
 * a single spotlight, the fewest the post allows).
 */
export const sampleCityInput = (look: Look, metro: 'miami' | 'boston', copy: 'max' | 'min' = 'max'): AiEventsCityPostInput => {
  const city = SAMPLE_MAX.find((c) => c.metro === metro)!;
  const picks = copy === 'max' ? [RANKED_TOP[metro], ...city.picks] : [RANKED_TOP[metro], city.picks[0]!];
  return { ...SAMPLE_WEEK, metro, picks, totalCount: copy === 'max' ? picks.length + city.remainingCount : picks.length, look, issueNumber: 1 };
};

/**
 * Real listings from the week of Oct 22, 2026, with their organizers' posters (copies in
 * public/social/ae-samples): for judging the rank slide against real posters, which carry their own
 * type, colours and shapes (square, wide). #1 has no poster, as some events won't.
 */
const POSTERS: Record<'miami' | 'boston', PickedEvent[]> = {
  miami: [
    ev('miami', { title: "AI Demo Night: OpenAI's Newest Tools, AI Red Teaming, and Surprise Guests", start: '2026-10-22T22:00:00Z', organizer: 'DeepStation', venue: '2750 NW 3rd Ave #24', city: 'Miami' }),
    ev('miami', { title: 'Miami Tech Halloween 2026: AI Rehab 🤖 5th Edition, Presented by BeatQuest', start: '2026-10-31T01:00:00Z', organizer: 'BeatQuest', venue: 'Miami', city: 'Miami', image: '/social/ae-samples/halloween.jpg' }),
    ev('miami', { title: 'Miami Tech Mixer 2026', start: '2026-10-29T22:00:00Z', organizer: 'Miami Tech Mixer', venue: 'Arlo Wynwood', city: 'Miami', image: '/social/ae-samples/miamitech.jpg' }),
    ev('miami', { title: 'Base44 Day at Mana Tech: AI Curious, Future Founders, Education Leaders, and Beyond', start: '2026-10-22T14:00:00Z', organizer: 'Base44', venue: 'Mana Tech, 21 SE 1st Ave', city: 'Miami', image: '/social/ae-samples/base44.jpg' }),
    ev('miami', { title: 'Trick or Build: Mel × Prompt Anything × AI Builders', start: '2026-10-29T22:00:00Z', organizer: 'Mel', venue: '300 NE 2nd Ave', city: 'Miami', image: '/social/ae-samples/wp7gehbn.jpg' }),
    ev('miami', { title: 'Mindstone Miami October AI Meetup', start: '2026-10-29T22:00:00Z', organizer: 'Mindstone AI Meetup', venue: 'Miami Tower', city: 'Miami', image: '/social/ae-samples/malzjb9l.jpg' }),
    ev('miami', { title: 'Inspire Hackathon', start: '2026-10-28T21:00:00Z', organizer: 'Jerry Pierre', venue: 'Miami Shores', city: 'Miami Shores', image: '/social/ae-samples/8rjc8xmf.jpg' }),
    ev('miami', { title: 'The $50 AI Employee That Does a $50K Job', start: '2026-10-28T21:00:00Z', organizer: 'Matthew Brenner', venue: '300 SW 1st Ave', city: 'Fort Lauderdale', image: '/social/ae-samples/mwst012g.jpg' }),
  ],
  boston: [
    RANKED_TOP.boston,
    ev('boston', { title: 'Party Mode: AI Coalition @ Reservoir HQ', start: '2026-10-22T21:30:00Z', organizer: 'AI Coalition', venue: '50 Terminal St, Charlestown', city: 'Boston', image: '/social/ae-samples/partymode.jpg' }),
    ev('boston', { title: 'Agentic Builders Boston', start: '2026-10-29T21:00:00Z', organizer: 'Agentic Builders Boston', venue: '300 A St', city: 'Boston', image: '/social/ae-samples/agentic.jpg' }),
    ev('boston', { title: 'Reshoring Rare Earths: Fireside Chat with Phoenix Tailings (+Startup Showcase)', start: '2026-10-26T17:30:00Z', organizer: 'ven^x', venue: 'Boston', city: 'Boston', image: '/social/ae-samples/phoenix.jpg' }),
    ev('boston', { title: 'Different Domain, Same Problems: Physical AI across Air, Land, and Sea', start: '2026-10-28T21:00:00Z', organizer: 'LeafLabs', venue: '1280 Cambridge St', city: 'Cambridge', image: '/social/ae-samples/7qay8zdt.jpg' }),
    ev('boston', { title: 'Ditch the Deck: AI Show Not Tell', start: '2026-10-28T22:00:00Z', organizer: 'FoundersEdge Events', venue: '1 N Market St', city: 'Boston', image: '/social/ae-samples/xe95mbwr.jpg' }),
    ev('boston', { title: 'AI x Tough Tech Founders & Builders Walk', start: '2026-10-28T13:00:00Z', organizer: 'Alex Grant', venue: '500 Technology Square', city: 'Cambridge', image: '/social/ae-samples/g4mnr7c2.jpg' }),
    ev('boston', { title: 'The Room × Zeteon.ai | AI for Science Panel', start: '2026-10-29T22:00:00Z', organizer: 'The Room Community', venue: 'Boston', city: 'Boston', image: '/social/ae-samples/wbluuqnz.jpg' }),
  ],
};

export const posterCityInput = (look: Look, metro: 'miami' | 'boston', rankLayout: AeRankLayout, rankTreat?: AeRankTreat[]): AiEventsCityPostInput => ({
  ...SAMPLE_WEEK,
  metro,
  picks: POSTERS[metro],
  totalCount: metro === 'miami' ? 14 : 22,
  look,
  issueNumber: 1,
  rankLayout,
  ...(rankTreat ? { rankTreat } : {}),
});

/** Max copy uses the bank's two longest hooks; min copy the shortest. `ae-ranked-*` are the ranked city posts (AE-29). */
export const AI_EVENTS_FIXTURES: Record<string, Post> = {
  'ae-ranked-spotlight': buildAiEventsCityPost(sampleCityInput('spotlight', 'miami')),
  'ae-ranked-glass': buildAiEventsCityPost(sampleCityInput('glass', 'boston')),
  'ae-ranked-daylight': buildAiEventsCityPost(sampleCityInput('daylight', 'miami')),
  'ae-ranked-orb': buildAiEventsCityPost(sampleCityInput('orb', 'boston')),
  'ae-ranked-spotlight-min': buildAiEventsCityPost(sampleCityInput('spotlight', 'boston', 'min')),
  'ae-ranked-daylight-min': buildAiEventsCityPost(sampleCityInput('daylight', 'boston', 'min')),
  'ae-spotlight': buildAiEventsPost(sampleInput('spotlight', 'group_chat')),
  'ae-glass': buildAiEventsPost(sampleInput('glass', 'rsvps_close')),
  'ae-daylight': buildAiEventsPost(sampleInput('daylight', 'group_chat')),
  'ae-orb': buildAiEventsPost(sampleInput('orb', 'rsvps_close')),
  'ae-spotlight-min': buildAiEventsPost(sampleInput('spotlight', 'find_your_city', 'min')),
  'ae-glass-min': buildAiEventsPost(sampleInput('glass', 'week_planned', 'min')),
  'ae-daylight-min': buildAiEventsPost(sampleInput('daylight', 'find_your_city', 'min')),
  'ae-orb-min': buildAiEventsPost(sampleInput('orb', 'one_event', 'min')),
};
