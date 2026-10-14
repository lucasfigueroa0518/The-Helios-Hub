import type { Post, SlideCopy, SpanRun } from '@/lib/social/render/types';

const svg = (body: string) => `data:image/svg+xml;charset=utf-8,${encodeURIEncoding(body)}`;

function encodeURIEncoding(body: string) {
  return encodeURIComponent(body);
}

const TALL = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="#6d7c89"/><rect y="820" width="1080" height="530" fill="#c4b8a4"/><rect x="140" y="380" width="300" height="680" fill="#d9d3c7"/><rect x="500" y="240" width="400" height="820" fill="#efeae2"/><rect x="560" y="320" width="72" height="72" fill="#6d7c89"/><rect x="700" y="320" width="72" height="72" fill="#6d7c89"/></svg>`);
const WIDE = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#6d7c89"/><rect y="520" width="1600" height="380" fill="#c4b8a4"/><rect x="180" y="280" width="420" height="420" fill="#efeae2"/><rect x="700" y="160" width="520" height="540" fill="#d9d3c7"/></svg>`);
const LOGO = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200"><text x="16" y="148" font-family="Arial,Helvetica,sans-serif" font-size="132" font-weight="700" fill="#111">ACME</text></svg>`);
const FACE = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="#8d735c"/><circle cx="200" cy="156" r="72" fill="#f0d7c4"/><ellipse cx="200" cy="360" rx="120" ry="90" fill="#1c1c1c"/></svg>`);

const say = (...spans: SpanRun) => spans;
const n = (text: string) => ({ text, role: 'narrative' as const });
const hook = (text: string) => ({ text, role: 'hook' as const });
const pivot = (text: string) => ({ text, role: 'pivot' as const });
const credit = 'Photo: Helios · placeholder';

function one(slide: Omit<SlideCopy, 'position' | 'altText'> & { altText?: string }): Post {
  return {
    format: 'carousel',
    storyType: 'tech',
    source: 'Helios',
    sourceUrl: 'https://heliosgroup.ai',
    publishedAt: '2026-10-08T12:00:00.000Z',
    issueNumber: 42,
    caption: '',
    slides: [{ position: 0, altText: slide.altText ?? 'Template study', ...slide }],
  };
}

export type TemplateFamily =
  | 'cover-bleed'
  | 'cover-split'
  | 'cover-logo'
  | 'cover-icon'
  | 'text'
  | 'landing'
  | 'stat'
  | 'split-stat'
  | 'quote'
  | 'image'
  | 'follow';

export type CatalogEntry = {
  id: string;
  family: TemplateFamily;
  name: string;
  role: string;
  post: Post;
};

export const TEMPLATE_FAMILIES: { id: TemplateFamily; name: string; job: string }[] = [
  { id: 'cover-bleed', name: 'Cover · bleed', job: 'Stop the scroll. Scene photo + claim.' },
  { id: 'cover-split', name: 'Cover · split', job: 'Name the person. Face clear of type.' },
  { id: 'cover-logo', name: 'Cover · logo', job: 'Company as subject. Logo on a Helios plate.' },
  { id: 'cover-icon', name: 'Cover · icon', job: 'No photo. Icon atmosphere + claim.' },
  { id: 'text', name: 'Text', job: 'Headline + body. Photo in its own region.' },
  { id: 'landing', name: 'Landing', job: 'One punch line. Optional photo below.' },
  { id: 'stat', name: 'Stat', job: 'One number is the story.' },
  { id: 'split-stat', name: 'Split stat', job: 'Two numbers in tension.' },
  { id: 'quote', name: 'Quote', job: 'Someone said it. The words are the slide.' },
  { id: 'image', name: 'Image / spread', job: 'Scene first. Type as caption.' },
  { id: 'follow', name: 'Follow', job: 'Close the loop. Ask for the follow.' },
];

export const CATALOG: CatalogEntry[] = [
  {
    id: 'cover-bleed',
    family: 'cover-bleed',
    name: 'Cover, full bleed',
    role: 'Hook cover',
    post: one({
      layoutVariant: 'cover',
      coverMode: 'bleed',
      photoUrl: TALL,
      photoKind: 'scene',
      photoSize: { w: 1080, h: 1350 },
      photoCredit: credit,
      icon: 'cpu',
      headline: say(n('A lab '), hook('sells'), n(' the '), pivot('model')),
    }),
  },
  {
    id: 'cover-split',
    family: 'cover-split',
    name: 'Cover, split',
    role: 'Hook cover',
    post: one({
      layoutVariant: 'cover',
      coverMode: 'split',
      photoUrl: TALL,
      photoKind: 'subject',
      photoSize: { w: 1080, h: 1350 },
      photoCredit: credit,
      icon: 'user',
      headline: say(n('She '), hook('quit'), n(' on '), pivot('Monday')),
    }),
  },
  {
    id: 'cover-logo',
    family: 'cover-logo',
    name: 'Cover, logo',
    role: 'Hook cover',
    post: one({
      layoutVariant: 'cover',
      coverMode: 'logo',
      photoUrl: LOGO,
      photoKind: 'logo',
      logoPlate: 'light',
      photoCredit: credit,
      icon: 'building-2',
      headline: say(n('Acme '), hook('raises'), n(' a '), pivot('round')),
    }),
  },
  {
    id: 'cover-icon',
    family: 'cover-icon',
    name: 'Cover, icon',
    role: 'Hook cover',
    post: one({
      layoutVariant: 'cover',
      coverMode: 'icon',
      icon: 'shield',
      headline: say(n('The '), hook('lock'), n(' on '), pivot('training')),
    }),
  },
  {
    id: 'text-photo-below',
    family: 'text',
    name: 'Text, photo below',
    role: 'Story beat',
    post: one({
      layoutVariant: 'text',
      photoPlacement: 'below',
      photoUrl: WIDE,
      photoKind: 'scene',
      photoSize: { w: 1600, h: 900 },
      photoCredit: credit,
      icon: 'server',
      headline: say(n('Chips '), hook('ran out')),
      body: say(n('The '), pivot('plants'), n(' kept the line '), hook('dark')),
    }),
  },
  {
    id: 'text-photo-top',
    family: 'text',
    name: 'Text, photo on top',
    role: 'Story beat',
    post: one({
      layoutVariant: 'text',
      photoPlacement: 'top',
      photoUrl: WIDE,
      photoKind: 'scene',
      photoSize: { w: 1600, h: 900 },
      photoCredit: credit,
      icon: 'factory',
      headline: say(n('The floor '), hook('stopped')),
      body: say(pivot('Tuesday'), n(' the line went '), hook('quiet')),
    }),
  },
  {
    id: 'text-only-top',
    family: 'text',
    name: 'Text, type at top',
    role: 'Story beat',
    post: one({
      layoutVariant: 'text',
      textAnchor: 'top',
      icon: 'scale',
      iconSide: 'right',
      headline: say(n('No photo. '), hook('Just'), n(' the '), pivot('rule')),
      body: say(n('The '), hook('court'), n(' said '), pivot('wait')),
    }),
  },
  {
    id: 'text-only-low',
    family: 'text',
    name: 'Text, type low',
    role: 'Story beat',
    post: one({
      layoutVariant: 'text',
      textAnchor: 'bottom',
      icon: 'landmark',
      iconSide: 'left',
      headline: say(n('Copy sits '), hook('low')),
      body: say(pivot('Congress'), n(' left it '), hook('open')),
    }),
  },
  {
    id: 'landing',
    family: 'landing',
    name: 'Landing',
    role: 'Punch line',
    post: one({
      layoutVariant: 'landing',
      photoUrl: WIDE,
      photoKind: 'scene',
      photoSize: { w: 1600, h: 900 },
      photoCredit: credit,
      icon: 'zap',
      headline: say(n('Then it '), hook('broke')),
      body: say(pivot('Friday'), n(' the '), hook('feed'), n(' died')),
    }),
  },
  {
    id: 'landing-type',
    family: 'landing',
    name: 'Landing, type only',
    role: 'Punch line',
    post: one({
      layoutVariant: 'landing',
      icon: 'zap',
      headline: say(n('Then it '), hook('broke')),
      body: say(pivot('Friday'), n(' the '), hook('feed'), n(' died')),
      note: 'The outage lasted six hours.',
    }),
  },
  {
    id: 'stat',
    family: 'stat',
    name: 'Stat',
    role: 'Proof',
    post: one({
      layoutVariant: 'stat',
      icon: 'banknote',
      headline: say(n('The '), hook('bill')),
      body: say(n('What '), pivot('labs'), n(' now '), hook('pay')),
      title: say(n('$2B')),
      numberNote: 'spent on chips this year',
    }),
  },
  {
    id: 'stat-backdrop',
    family: 'stat',
    name: 'Stat, photo behind',
    role: 'Proof',
    post: one({
      layoutVariant: 'stat',
      photoUrl: TALL,
      photoKind: 'scene',
      photoSize: { w: 1080, h: 1350 },
      photoCredit: credit,
      icon: 'banknote',
      headline: say(n('The '), hook('bill')),
      body: say(pivot('Labs'), n(' now '), hook('pay')),
      title: say(n('$2B')),
      numberNote: 'spent on chips this year',
    }),
  },
  {
    id: 'split-stat',
    family: 'split-stat',
    name: 'Split stat',
    role: 'Proof',
    post: one({
      layoutVariant: 'split_stat',
      icon: 'users',
      headline: say(n('Two '), hook('counts')),
      body: say(pivot('Before'), n(' and '), hook('after')),
      title: say(n('12%')),
      numberNote: 'last year',
      secondNumber: '41%',
      secondNote: 'this year',
    }),
  },
  {
    id: 'quote-speaker',
    family: 'quote',
    name: 'Quote, speaker',
    role: 'Voice',
    post: one({
      layoutVariant: 'quote',
      photoUrl: FACE,
      photoKind: 'subject',
      photoSize: { w: 400, h: 400 },
      photoIsSpeaker: true,
      photoCredit: credit,
      icon: 'message-square-quote',
      headline: say(n('In her '), hook('words')),
      quoteText: say(n('We '), hook('missed'), n(' the '), pivot('cutoff')),
      quoteBy: 'Ada Lovelace',
      body: say(n('She said it '), hook('twice')),
    }),
  },
  {
    id: 'quote-backdrop',
    family: 'quote',
    name: 'Quote, photo behind',
    role: 'Voice',
    post: one({
      layoutVariant: 'quote',
      photoUrl: TALL,
      photoKind: 'scene',
      photoSize: { w: 1080, h: 1350 },
      photoIsSpeaker: false,
      photoCredit: credit,
      icon: 'message-square-quote',
      headline: say(n('On the '), hook('record')),
      quoteText: say(n('We '), hook('missed'), n(' the '), pivot('cutoff')),
      quoteBy: 'Ada Lovelace',
    }),
  },
  {
    id: 'quote-type',
    family: 'quote',
    name: 'Quote, type',
    role: 'Voice',
    post: one({
      layoutVariant: 'quote',
      icon: 'message-square-quote',
      headline: say(n('No face, '), hook('just'), n(' the line')),
      quoteText: say(n('We '), hook('missed'), n(' the '), pivot('cutoff')),
      quoteBy: 'Ada Lovelace',
      quoteRole: 'Researcher',
    }),
  },
  {
    id: 'image',
    family: 'image',
    name: 'Image, full bleed',
    role: 'Atmosphere',
    post: one({
      layoutVariant: 'image',
      photoUrl: TALL,
      photoKind: 'scene',
      photoSize: { w: 1080, h: 1350 },
      photoCredit: credit,
      icon: 'globe',
      headline: say(n('Night shift, '), hook('empty')),
      body: say(n('The '), pivot('hall'), n(' stayed '), hook('dark')),
    }),
  },
  {
    id: 'spread-left',
    family: 'image',
    name: 'Spread, left / text low',
    role: 'Atmosphere',
    post: one({
      layoutVariant: 'image',
      panoramaSide: 'left',
      bleedText: 'bottom',
      photoUrl: WIDE,
      photoKind: 'scene',
      photoSize: { w: 1600, h: 900 },
      photoCredit: credit,
      icon: 'globe',
      headline: say(n('Left half, '), hook('low')),
      body: say(pivot('One'), n(' photo, two '), hook('slides')),
    }),
  },
  {
    id: 'spread-right',
    family: 'image',
    name: 'Spread, right / text high',
    role: 'Atmosphere',
    post: one({
      layoutVariant: 'image',
      panoramaSide: 'right',
      bleedText: 'top',
      photoUrl: WIDE,
      photoKind: 'scene',
      photoSize: { w: 1600, h: 900 },
      photoCredit: credit,
      icon: 'globe',
      headline: say(n('Right half, '), hook('high')),
      body: say(n('The '), pivot('copy'), n(' sits '), hook('up')),
    }),
  },
  {
    id: 'follow',
    family: 'follow',
    name: 'Follow',
    role: 'Close',
    post: one({
      layoutVariant: 'follow',
      icon: 'rocket',
      storySpecificLine: 'The lab sold the model. Follow Helios for the next one.',
    }),
  },
];
