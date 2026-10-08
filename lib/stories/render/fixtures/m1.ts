/**
 * M1 fixture sets: real news from the carousel's September runs and real
 * Commons photos (fixtures/photos/credits.json), written by hand. No model
 * calls. Used for the design mock-ups and the renderer's offline tests.
 */
import credits from './photos/credits.json';
import { BACKDROPS, type Backdrop, type Frame, type FrameData, type Photo, type Series } from '../types';

type CreditKey = keyof typeof credits;
const DIR = 'lib/stories/render/fixtures/photos';

function photo(key: CreditKey, kind: Photo['kind'], focus?: Photo['focus']): Photo {
  const c = credits[key];
  const credit = kind === 'logo' ? `Logo: ${c.artist} · ${c.license} · Wikimedia Commons` : `Photo: ${c.artist} · ${c.license} · Wikimedia Commons`;
  return { src: `${DIR}/${c.file}`, credit, kind, ...(focus ? { focus } : {}) };
}

export const MORNING_DOWNLOAD: FrameData[] = [
  { role: 'opener', date: 'Thursday, October 8', storyCount: 3, photo: photo('capitol', 'scene', { x: 0.5, y: 0.5 }) },
  {
    role: 'story',
    headline:
      'California Gov. Gavin Newsom signed an executive order on Sept. 18 calling for a kill switch on frontier AI models. A state working group has two months to turn it into rules.',
    source: { verb: 'via', name: 'The Verge' },
    photo: photo('newsom', 'person', { x: 0.5, y: 0.12 }),
  },
  {
    role: 'story',
    headline: 'Anthropic says Claude now leads 26% of its own research and development work. The AI is helping build the next version of itself.',
    source: { verb: 'reported by', name: 'Bloomberg' },
    photo: photo('amodei', 'person', { x: 0.5, y: 0.1 }),
  },
  {
    role: 'story',
    headline:
      'AI data center builder Crusoe raised $3.9 billion this week, tripling its value to $30.9 billion in 10 months. OpenAI rents one of its biggest sites, in Abilene, Texas.',
    source: { verb: 'via', name: 'TechCrunch' },
    photo: photo('datacenter', 'scene', { x: 0.3, y: 0.5 }),
  },
  { role: 'closer' },
];

/** Typographic fallbacks (S-14: no photo clears the bar). */
export const MORNING_DOWNLOAD_TYPE: FrameData[] = [
  { role: 'opener', date: 'Thursday, October 8', storyCount: 3 },
  {
    role: 'story',
    headline: 'Anthropic says Claude now leads 26% of its own research and development work. The AI is helping build the next version of itself.',
    source: { verb: 'reported by', name: 'Bloomberg' },
  },
];

/** Guess the Number: intro, then question and answer, one set per family (S-13, S-49). */
export const GUESS_THE_NUMBER: Record<'photo' | 'marquee' | 'type', [FrameData, FrameData, FrameData]> = {
  photo: [
    { role: 'intro', difficulty: 'medium', topic: 'How many people use ChatGPT' },
    {
      role: 'question',
      family: 'photo',
      question: 'How many people use ChatGPT every week?',
      photo: photo('altman', 'person', { x: 0.62, y: 0.18 }),
    },
    {
      role: 'answer',
      family: 'photo',
      number: '800M',
      label: 'people use ChatGPT every week',
      meaning: 'That’s about one in ten people on Earth, three years after launch.',
      source: { verb: 'from', name: 'OpenAI' },
      photo: photo('openai_hq', 'scene', { x: 0.45, y: 0.5 }),
    },
  ],
  marquee: [
    { role: 'intro', difficulty: 'high', topic: 'What one AI data center builder is worth' },
    {
      role: 'question',
      family: 'marquee',
      question: 'What’s AI data center builder Crusoe worth after this week’s raise?',
      photo: photo('datacenter', 'scene', { x: 0.35, y: 0.55 }),
    },
    {
      role: 'answer',
      family: 'marquee',
      number: '$30.9B',
      label: 'after a $3.9 billion raise',
      meaning: 'It tripled in 10 months, riding the rush to build AI data centers.',
      source: { verb: 'via', name: 'TechCrunch' },
      photo: photo('datacenter', 'scene', { x: 0.75, y: 0.5 }),
    },
  ],
  type: [
    { role: 'intro', difficulty: 'medium', topic: 'How much of its own R&D Claude now runs' },
    {
      role: 'question',
      family: 'type',
      question: 'How much of Anthropic’s own R&D is Claude now leading?',
    },
    {
      role: 'answer',
      family: 'type',
      number: '26%',
      label: 'of Anthropic’s R&D work is led by Claude',
      meaning: 'More than one task in four. The AI is helping build its own successor.',
      source: { verb: 'reported by', name: 'Bloomberg' },
    },
  ],
};

export const FREE_VS_PAID: [FrameData, FrameData, FrameData] = [
  { role: 'intro' },
  {
    role: 'paid',
    tool: 'Adobe Photoshop',
    price: '$22.99',
    period: 'a month',
    tease: 'There’s a free editor that covers most of what people pay Photoshop for.',
    logo: photo('photoshop', 'logo'),
  },
  {
    role: 'free',
    tool: 'GIMP',
    what: 'A full photo editor with layers, masks, retouching and RAW files.',
    how: 'Free download at gimp.org',
    platforms: 'Mac, Windows and Linux',
    paidPrice: '$22.99/mo',
    logo: photo('gimp', 'logo'),
  },
];

/** Number a list of frame data as one set on one backdrop. */
export function asSet(series: Series, backdrop: Backdrop, data: FrameData[]): Frame[] {
  return data.map((d, i) => ({ series, backdrop, index: i + 1, total: data.length, data: d }));
}

export { BACKDROPS };
