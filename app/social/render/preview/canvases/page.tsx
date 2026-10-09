'use client';

import { SlideTemplate, type SlideCanvas } from '@/lib/social/render/SlideTemplate';
import type { Post, SlideCopy, SpanRun } from '@/lib/social/render/types';

import '../preview.css';

const CANVASES: SlideCanvas[] = ['green', 'orange', 'white'];

const svg = (body: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}`;
const TALL = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="#8ea4b8"/><rect y="780" width="1080" height="570" fill="#c4b8a4"/><rect x="160" y="430" width="280" height="620" fill="#d9d3c7"/><rect x="520" y="300" width="360" height="750" fill="#efeae2"/><rect x="560" y="360" width="80" height="80" fill="#8ea4b8"/><rect x="680" y="360" width="80" height="80" fill="#8ea4b8"/></svg>`);
const WIDE = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#8ea4b8"/><rect y="520" width="1600" height="380" fill="#c4b8a4"/><rect x="180" y="280" width="420" height="420" fill="#efeae2"/><rect x="700" y="160" width="520" height="540" fill="#d9d3c7"/><rect x="760" y="220" width="90" height="90" fill="#8ea4b8"/></svg>`);
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
    slides: [{ position: 0, altText: slide.altText ?? 'Canvas study', ...slide }],
  };
}

const ROWS: { name: string; post: Post }[] = [
  {
    name: 'Cover, full bleed',
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
    name: 'Cover, split',
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
    name: 'Cover, logo',
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
    name: 'Cover, icon',
    post: one({
      layoutVariant: 'cover',
      coverMode: 'icon',
      icon: 'shield',
      headline: say(n('The '), hook('lock'), n(' on '), pivot('training')),
    }),
  },
  {
    name: 'Story, photo below',
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
    name: 'Story, photo on top',
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
    name: 'Story, full bleed',
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
    name: 'Story, landing',
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
    name: 'Story, type at top',
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
    name: 'Story, type low',
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
    name: 'Stat',
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
    name: 'Stat, photo behind',
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
    name: 'Split stat',
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
    name: 'Quote, speaker',
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
    name: 'Quote, photo behind',
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
    name: 'Quote, type',
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
    name: 'Spread, text at bottom',
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
    name: 'Spread, text at top',
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
    name: 'Follow',
    post: one({
      layoutVariant: 'follow',
      icon: 'rocket',
      storySpecificLine: 'The lab sold the model. Follow Helios for the next one.',
    }),
  },
];

export default function CanvasGalleryPage() {
  return (
    <div className="preview-shell">
      <div className="preview-shell__meta">Carousel canvases · green, orange, white</div>
      <div className="canvas-gallery">
        {ROWS.map((row) => (
          <section key={row.name} className="canvas-gallery__row" aria-label={row.name}>
            <h2 className="canvas-gallery__name" style={{ gridColumn: '1 / -1' }}>{row.name}</h2>
            {CANVASES.map((canvas) => (
              <div key={canvas}>
                <p className="canvas-gallery__label">{canvas}</p>
                <div className="canvas-gallery__stage" style={{ ['--slide-scale' as string]: '0.26' }}>
                  <SlideTemplate post={row.post} position={0} canvas={canvas} />
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
