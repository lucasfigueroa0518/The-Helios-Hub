/**
 * Morning Download cover lab (2026-11-23): five visual directions for the "peek + quick read" opener
 * (Lucas picked directions 1 + 4). Standalone 1080×1920 mockups in local Chromium on the real Nov 13 held
 * set; brand fonts, logo and tokens from lib/stories/render. No AI, no spend; production renderer untouched.
 * Usage: npx tsx scripts/md-cover-peek-page.ts <out.html>
 */
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

const A = 'lib/stories/render/assets';
const SET = '.memes-local/news-ranker-lab/md-held/frames';
const OUT = '.memes-local/news-ranker-lab/md-covers';
const b64 = (f: string) => fs.readFileSync(f).toString('base64');

// Story order and hook headlines as written for the held Nov 13 set.
const STORIES = [
  { id: '4c917843', headline: 'Google’s AI glasses translate 70+ languages for $395', clue: '70+ languages' },
  { id: '6ce8fa78', headline: 'All US flights grounded weeks after FAA’s new AI tool', clue: 'every US flight' },
  { id: '705edfbd', headline: 'ChatGPT can now buy things for you with your own card', clue: 'your own card' },
  { id: '17732b57', headline: 'Posted Windows hack can turn off any antivirus, author says', clue: 'any antivirus' },
];
const DATE = 'Friday, November 13';
const N = STORIES.length;
const QUICK = `${N} stories · 1 minute`;

const FONTS = `
@font-face{font-family:'Pragmatica Extended';src:url(data:font/otf;base64,${b64(`${A}/PragmaticaExtended-Bold.otf`)});font-weight:700}
@font-face{font-family:'Roboto';src:url(data:font/woff2;base64,${b64(`${A}/Roboto-400.woff2`)});font-weight:400}
@font-face{font-family:'Roboto';src:url(data:font/woff2;base64,${b64(`${A}/Roboto-700.woff2`)});font-weight:700}`;

const BASE = `
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;height:1920px;overflow:hidden;font-family:Roboto,Arial,sans-serif;color:#fff;-webkit-font-smoothing:antialiased}
.f{position:relative;width:1080px;height:1920px;overflow:hidden;
 background:radial-gradient(62% 42% at 100% 0%,rgba(255,106,42,.10) 0%,rgba(255,106,42,0) 72%),radial-gradient(55% 38% at 0% 0%,rgba(255,255,255,.035) 0%,rgba(255,255,255,0) 70%),radial-gradient(70% 32% at 15% 100%,rgba(232,65,59,.06) 0%,rgba(232,65,59,0) 72%),linear-gradient(180deg,#161616 0%,#0B0B0B 100%)}
.disp{font-family:'Pragmatica Extended',Arial,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:-.01em}
.acc{background:linear-gradient(180deg,#FF8A4F 0%,#FF5E1A 52%,#E63946 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.logo{display:block}
.eyebrow{font-weight:700;font-size:26px;letter-spacing:.24em;text-transform:uppercase;color:#FF5E1A}
.quick{font-weight:700;font-size:30px;letter-spacing:.2em;text-transform:uppercase;color:#d4d4d4}
.pips{display:flex;gap:12px}.pips i{display:block;height:8px;border-radius:8px;background:rgba(255,255,255,.22)}.pips i.on{background:#FF5E1A}
.ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.veil{filter:blur(13px) saturate(.9) brightness(.82);transform:scale(1.1)}
.card em,.tile em{text-shadow:0 1px 8px rgba(0,0,0,.7)}
.cue{font-weight:700;font-size:26px;letter-spacing:.2em;text-transform:uppercase;color:#fff;display:flex;align-items:center;gap:14px}
.cue b{color:#FF5E1A;font-size:34px}`;

// Round 3 (Lucas: anchor on round-1 A Filmstrip and B Deck; blurs, question marks and copy make the curiosity).
type Ctx = { logo: string; photos: string[] };
const pips = (w: number, n = N) => `<div class="pips">${Array.from({ length: n }, (_, i) => `<i class="${i === 0 ? 'on' : ''}" style="width:${w}px"></i>`).join('')}</div>`;
const Q = `<b class="q">?</b>`;
const COMMON = `.q{position:absolute;z-index:2;left:50%;top:50%;transform:translate(-50%,-50%);color:#fff;font-family:'Pragmatica Extended',Arial,sans-serif;font-weight:700;color:#fff;text-shadow:0 6px 30px rgba(0,0,0,.55);line-height:1}
.fog{filter:blur(18px) saturate(1.05) brightness(.78);transform:scale(1.14)}
.line{font-family:'Pragmatica Extended',Arial,sans-serif;font-weight:700;text-transform:uppercase;text-align:center;letter-spacing:-.01em}`;

// Round-1 A, kept: brand block on top, four tall cards, quick line + pips under.
const filmHead = (logo: string, title = 'Morning<br><span class="acc">Download</span>', series = '') => `<div class="head"><img class="logo" src="${logo}" width="180">${series ? `<p class="disp series">${series}</p>` : ''}<p class="eyebrow" style="margin-top:${series ? 12 : 26}px">${DATE}</p><h1 class="disp t">${title}</h1></div>`;
// Lucas 2026-11-23: the series name becomes the value it brings.
const NAME = 'What you<br>need to know<br><span class="acc">in AI today</span>';
const FILM_CSS = `${COMMON}.head{position:absolute;top:270px;left:0;right:0;text-align:center;display:flex;flex-direction:column;align-items:center}
.t{font-size:118px;line-height:.98;margin-top:20px}
.row{position:absolute;top:960px;left:56px;right:56px;display:flex;gap:18px;height:520px}
.card{position:relative;flex:1;border-radius:22px;overflow:hidden;background:#222}
.card.lead{flex:1.5;box-shadow:0 0 0 4px #FF5E1A}
.card em{position:absolute;z-index:2;top:16px;left:18px;color:#fff;font-style:normal;font-weight:700;font-size:24px;letter-spacing:.12em;text-shadow:0 1px 8px rgba(0,0,0,.8)}
.card .q{font-size:120px}
.card .hint{position:absolute;z-index:2;left:10px;right:10px;bottom:20px;text-align:center;font-weight:700;font-size:30px;line-height:1.15;text-shadow:0 1px 8px rgba(0,0,0,.8)}
.ask{position:absolute;top:840px;left:56px;right:56px;font-size:46px;line-height:1.05}
.foot{position:absolute;top:1520px;left:56px;right:56px;display:flex;justify-content:space-between;align-items:center}
.row.sm{top:880px;left:150px;right:150px;height:400px;gap:14px}.row.sm .q{font-size:84px}.row.sm .card{border-radius:18px}
.foot.sm{top:1330px;left:150px;right:150px}`;

// Round-1 B, kept: logo beside the title, fanned stack of cards, quick line + pips centred under.
const deckHead = (logo: string) => `<div class="head"><img class="logo" src="${logo}" width="200"><div><p class="eyebrow">${DATE}</p><h1 class="disp t" style="margin-top:14px">Morning<br><span class="acc">Download</span></h1></div></div>`;
const DECK_CSS = `${COMMON}.head{position:absolute;top:270px;left:72px;right:72px;display:flex;align-items:center;gap:36px}
.t{font-size:104px;line-height:.96}
.deck{position:absolute;top:800px;left:50%;width:600px;height:700px;margin-left:-300px}
.c{position:absolute;inset:0;border-radius:30px;overflow:hidden;background:#222;box-shadow:0 30px 60px rgba(0,0,0,.55)}
.c .q{font-size:300px}.c.back .q{font-size:110px;top:22%;left:${'${QX}'}}
.qk{position:absolute;top:1560px;left:0;right:0;display:flex;flex-direction:column;align-items:center;gap:20px}
.ask{position:absolute;top:660px;left:40px;right:40px;font-size:42px;line-height:1.05}`;
const fan = [[0, 0, 1], [120, 7, .95], [-120, -7, .95], [220, 13, .9]] as const;
const deck = (photos: string[], topClear: boolean) => photos.map((p, i) => ({ p, i })).reverse().map(({ p, i }) => {
  const [x, r, s] = fan[i]!;
  const clear = i === 0 && topClear;
  return `<div class="c ${i ? 'back' : ''}" style="transform:translateX(${x}px) rotate(${r}deg) scale(${s})"><img class="ph ${clear ? '' : 'fog'}" src="${p}">${clear ? '' : `<b class="q" style="${i ? `left:${i === 2 ? '18%' : '82%'}` : ''}">?</b>`}</div>`;
}).join('');

const DESIGNS: Array<{ key: string; name: string; note: string; html: (c: Ctx) => string }> = [
  {
    key: 'a-guess',
    name: 'A3 · Filmstrip: guess the rest',
    note: 'Round-1 Filmstrip. Story 1 shows clearly; 02–04 are blurred under big question marks. Copy above the row: “That’s one. Can you guess the other 3?”',
    html: ({ logo, photos }) => `<style>${FILM_CSS}</style>${filmHead(logo)}
<p class="line ask">That’s one. <span class="acc">Can you guess the other ${N - 1}?</span></p>
<div class="row">${photos.map((p, i) => `<div class="card ${i ? '' : 'lead'}"><img class="ph ${i ? 'fog' : ''}" src="${p}"><em>0${i + 1}</em>${i ? Q : ''}</div>`).join('')}</div>
<div class="foot"><p class="quick">${QUICK}</p>${pips(54)}</div>`,
  },
  {
    key: 'a-all',
    name: 'A4 · Filmstrip: all hidden',
    note: 'Round-1 Filmstrip with every card blurred under a question mark, the first one ringed orange. No copy line (Lucas, 2026-11-23).',
    html: ({ logo, photos }) => `<style>${FILM_CSS}</style>${filmHead(logo)}
<div class="row sm">${photos.map((p, i) => `<div class="card ${i ? '' : 'lead'}"><img class="ph fog" src="${p}"><em>0${i + 1}</em>${Q}</div>`).join('')}</div>
<div class="foot sm"><p class="quick">${QUICK}</p>${pips(54)}</div>`,
  },
  {
    key: 'a-hint',
    name: 'A5 · Filmstrip: one clue each',
    note: 'Round-1 Filmstrip, all blurred, each card with a question mark and one clue pulled from its headline (“70+ languages”, “your own card”). Copy: “4 stories. 4 clues. 1 minute.”',
    html: ({ logo, photos }) => `<style>${FILM_CSS}</style>${filmHead(logo)}
<p class="line ask">${N} stories. ${N} clues. <span class="acc">Guess them?</span></p>
<div class="row">${photos.map((p, i) => `<div class="card ${i ? '' : 'lead'}"><img class="ph fog" src="${p}"><em>0${i + 1}</em>${Q}<p class="hint">${STORIES[i]!.clue}</p></div>`).join('')}</div>
<div class="foot"><p class="quick">${QUICK}</p>${pips(54)}</div>`,
  },
  {
    key: 'b-guess',
    name: 'B3 · Deck: what’s on top?',
    note: 'Round-1 Deck with the whole fan blurred; a huge question mark on the top card and smaller ones on the cards behind. Copy: “Guess today’s #1 AI story.”',
    html: ({ logo, photos }) => `<style>${DECK_CSS.replace("left:${QX}", 'left:50%')}</style>${deckHead(logo)}
<p class="line ask">Guess today’s <span class="acc">#1 AI story.</span></p>
<div class="deck">${deck(photos, false)}</div>
<div class="qk"><p class="quick">${QUICK}</p>${pips(70)}</div>`,
  },
  {
    key: 'b-more',
    name: 'B4 · Deck: and that’s just #1',
    note: 'Round-1 Deck: story 1 on top, clear; the fanned cards behind it are blurred with question marks. Copy: “That’s just #1. 3 more under here.”',
    html: ({ logo, photos }) => `<style>${DECK_CSS.replace("left:${QX}", 'left:50%')}</style>${deckHead(logo)}
<p class="line ask">That’s just #1. <span class="acc">${N - 1} more under here.</span></p>
<div class="deck">${deck(photos, true)}</div>
<div class="qk"><p class="quick">${QUICK}</p>${pips(70)}</div>`,
  },
  // Tap-forward prompts on A4 (Lucas, 2026-11-23: something must visually prompt the viewer to tap forward).
  ...([
    { key: 'a4-ripple', name: 'T1 · Tap ripple', note: 'A touch point on the right edge, where Instagram takes a forward tap: an orange dot with rings radiating out, and “TAP” under it.',
      extra: `.tp{position:absolute;right:34px;top:1010px;width:140px;height:140px}
.tp i{position:absolute;left:50%;top:50%;border-radius:50%;transform:translate(-50%,-50%);border:4px solid #FF5E1A}
.tp i:nth-child(1){width:44px;height:44px;background:linear-gradient(180deg,#FF8A4F,#FF5E1A 52%,#E63946);border:0;box-shadow:0 0 30px rgba(255,94,26,.7)}
.tp i:nth-child(2){width:86px;height:86px;opacity:.7}.tp i:nth-child(3){width:128px;height:128px;opacity:.35}
.tp p{position:absolute;top:150px;left:0;right:0;text-align:center;font-weight:700;font-size:24px;letter-spacing:.24em;color:#FF5E1A}
.row.sm{left:110px;right:190px}`,
      cta: `<div class="tp"><i></i><i></i><i></i><p>TAP</p></div>` },
    { key: 'a4-chevrons', name: 'T2 · Chevrons', note: 'Three orange chevrons on the right edge, fading out leftward, pointing on to the next frame, with a vertical “NEXT”.',
      extra: `.ch{position:absolute;right:24px;top:960px;display:flex;flex-direction:column;align-items:center;gap:10px}
.ch div{display:flex}.ch b{font-family:'Pragmatica Extended',Arial,sans-serif;font-size:120px;line-height:1;color:#FF5E1A;margin-left:-4px;font-family:Roboto,Arial,sans-serif;font-weight:700}
.ch b:nth-child(1){opacity:.3}.ch b:nth-child(2){opacity:.6}
.ch p{font-weight:700;font-size:22px;letter-spacing:.3em;color:#FF5E1A}
.row.sm{left:90px;right:210px}`,
      cta: `<div class="ch"><div><b>›</b><b>›</b><b>›</b></div><p>NEXT</p></div>` },
    { key: 'a4-button', name: 'T3 · Reveal button', note: 'A wide orange button under the cards, “Tap to reveal →”, styled like a real call to action.',
      extra: `.btn{position:absolute;top:1430px;left:150px;right:150px;height:120px;border-radius:60px;background:linear-gradient(180deg,#FF8A4F 0%,#FF5E1A 52%,#E63946 100%);display:flex;align-items:center;justify-content:center;gap:20px;box-shadow:0 18px 50px rgba(255,94,26,.35)}
.btn p{font-family:'Pragmatica Extended',Arial,sans-serif;font-weight:700;font-size:40px;text-transform:uppercase;color:#fff}.btn b{font-size:52px;color:#fff}`,
      cta: `<div class="btn"><p>Tap to reveal</p><b>→</b></div>` },
  ].map((t) => ({ key: t.key, name: t.name, note: t.note, html: ({ logo, photos }: Ctx) => `<style>${FILM_CSS}${t.extra}</style>${filmHead(logo)}
<div class="row sm">${photos.map((p, i) => `<div class="card ${i ? '' : 'lead'}"><img class="ph fog" src="${p}"><em>0${i + 1}</em>${Q}</div>`).join('')}</div>
<div class="foot sm">${t.key === 'a4-ripple' || t.key === 'a4-chevrons' ? `<p class="quick">${QUICK}</p>${pips(40)}` : `<p class="quick">${QUICK}</p>${pips(54)}`}</div>${t.cta}` }))),
  // Arrow variations in the empty space under A4 (Lucas, 2026-11-23: T1–T3 too corporate; arrows, below).
  ...((): Array<{ key: string; name: string; note: string; arrow: string }> => {
    const g = `<defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FF8A4F"/><stop offset=".52" stop-color="#FF5E1A"/><stop offset="1" stop-color="#E63946"/></linearGradient></defs>`;
    return [
      { key: 'arr-long', name: 'R1 · Long arrow', note: 'One long, thin orange arrow running across the empty space, pointing to the next frame.',
        arrow: `<svg width="560" height="60" viewBox="0 0 560 60">${g}<path d="M4 30H548M518 6l30 24-30 24" fill="none" stroke="url(#lg)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
      { key: 'arr-bold', name: 'R2 · Bold arrow', note: 'A short, heavy arrow in the logo gradient, centred, like the arrow on the current opener’s cue, much bigger.',
        arrow: `<svg width="180" height="130" viewBox="0 0 180 130">${g}<path d="M10 65H150M98 14l52 51-52 51" fill="none" stroke="url(#lg)" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/></svg>` },
      { key: 'arr-trail', name: 'R3 · Trailing arrows', note: 'Three arrows in a row, the first faint and the last full orange, so they read as moving right.',
        arrow: `<svg width="420" height="90" viewBox="0 0 420 90">${g}${[0, 1, 2].map((i) => `<path transform="translate(${i * 140} 0)" d="M8 45H112M78 12l34 33-34 33" fill="none" stroke="url(#lg)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" opacity="${[0.25, 0.55, 1][i]}"/>`).join('')}</svg>` },
    ];
  })().map((t) => ({ key: t.key, name: t.name, note: t.note, html: ({ logo, photos }: Ctx) => `<style>${FILM_CSS}.arw{position:absolute;top:1500px;left:0;right:0;height:140px;display:flex;align-items:center;justify-content:center}
.head{top:250px}.head .logo{width:150px}.series{margin-top:16px;font-size:26px;line-height:1;letter-spacing:.06em}.head .eyebrow{font-size:22px}.t{font-size:100px;line-height:1.02;margin-top:44px}.row.sm{top:990px}.foot.sm{top:1440px}</style>${filmHead(logo, NAME, 'Morning <span class="acc">Download</span>')}
<div class="row sm">${photos.map((p, i) => `<div class="card ${i ? '' : 'lead'}"><img class="ph fog" src="${p}"><em>0${i + 1}</em>${Q}</div>`).join('')}</div>
<div class="foot sm" style="justify-content:center"><p class="quick">${QUICK}</p></div><div class="arw">${t.arrow}</div>` })),
  // Final layout (Lucas, 2026-11-23: balance the vertical stack, use negative space well). One centred column
  // inside the Instagram safe area. Three groups (brand, promise, stories), each tight inside (proximity), separated
  // by larger gaps on an 8px grid. The card row, count line and arrow share one column width (alignment), and the
  // whole stack sits a touch above centre (optical centre).
  {
    key: 'final',
    name: 'Final · balanced',
    note: 'Brand group (logo, series, date) tight together; a clear gap; the promise; a larger gap; the stories group (cards, count, arrow) on one shared column width. The stack is centred in the safe area, slightly high.',
    html: ({ logo, photos }: Ctx) => {
      const g = `<defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FF8A4F"/><stop offset=".52" stop-color="#FF5E1A"/><stop offset="1" stop-color="#E63946"/></linearGradient></defs>`;
      return `<style>${FILM_CSS}
.col{position:absolute;top:250px;bottom:360px;left:0;right:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.brandg{display:flex;flex-direction:column;align-items:center}
.brandg .series{margin-top:24px;font-size:24px;line-height:1;letter-spacing:.08em}
.brandg .eyebrow{margin-top:12px;font-size:20px;letter-spacing:.26em}
.promise{margin-top:80px;font-size:100px;line-height:1.0}
.stories{margin-top:120px;width:784px;display:flex;flex-direction:column;align-items:center}
.stories .row{position:static;display:flex;gap:16px;height:360px;width:100%}
.stories .card{border-radius:18px}.stories .q{font-size:80px}
.stories .quick{margin-top:36px;font-size:26px}
.stories svg{margin-top:48px;display:block}</style>
<div class="col">
<div class="brandg"><img class="logo" src="${logo}" width="144"><p class="disp series">Morning <span class="acc">Download</span></p><p class="eyebrow">${DATE}</p></div>
<h1 class="disp promise">${NAME}</h1>
<div class="stories"><div class="row">${photos.map((p, i) => `<div class="card ${i ? '' : 'lead'}"><img class="ph fog" src="${p}"><em>0${i + 1}</em>${Q}</div>`).join('')}</div>
<p class="quick">${QUICK}</p>
<svg width="784" height="48" viewBox="0 0 784 48">${g}<path d="M4 24H774M748 4l26 20-26 20" fill="none" stroke="url(#lg)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
</div>`;
    },
  },
];


// The four Morning Download backdrops, from lib/stories/render/stories.css (.st-bd-*): ground, ink and accent.
const PROFILES: Array<{ key: string; name: string; css: string }> = [
  { key: 'black', name: 'Black', css: '' },
  { key: 'white', name: 'White', css: `.f{color:#171717;background:linear-gradient(rgba(23,23,23,.10) 1.5px,transparent 1.5px) 0 -.75px/72px 72px,linear-gradient(90deg,rgba(23,23,23,.10) 1.5px,transparent 1.5px) -.75px 0/72px 72px,radial-gradient(900px 760px at 96% 0%,rgba(255,94,26,.07),transparent 62%),#FFFFFF}
.eyebrow{color:#138510}.quick{color:#525252}.logo{border-radius:50%;box-shadow:0 24px 60px -24px rgba(230,57,70,.45)}` },
  { key: 'orange', name: 'Orange (Sunrise)', css: `.f{color:#171717;background:radial-gradient(90% 38% at 50% 0%,rgba(255,178,120,.62) 0%,rgba(255,178,120,0) 100%),radial-gradient(80% 34% at 50% 100%,rgba(222,50,60,.42) 0%,rgba(222,50,60,0) 100%),#FF5E1A}
.acc{background:#fff;-webkit-background-clip:text;background-clip:text}.eyebrow{color:#171717}.quick{color:rgba(23,23,23,.84)}
.logo{border-radius:50%;box-shadow:0 0 0 6px #fff,0 30px 60px -26px rgba(80,18,0,.7)}.card.lead{box-shadow:0 0 0 4px #fff}.stories svg path{stroke:#fff}` },
  { key: 'green', name: 'Green', css: `.f{color:#fff;background:radial-gradient(1000px 820px at 92% 0%,rgba(255,255,255,.14),transparent 60%),linear-gradient(168deg,#1B9C17 0%,#138510 46%,#0E690C 100%)}
.acc{background:#fff;-webkit-background-clip:text;background-clip:text}.eyebrow{color:rgba(255,255,255,.92)}.quick{color:rgba(255,255,255,.86)}
.logo{border-radius:50%;box-shadow:0 0 0 6px #fff,0 30px 60px -26px rgba(0,30,0,.75)}.card.lead{box-shadow:0 0 0 4px #fff}.stories svg path{stroke:#fff}` },
];

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('usage: md-cover-peek-page.ts <out.html>');
  fs.mkdirSync(OUT, { recursive: true });
  const logo = `data:image/png;base64,${b64(`${A}/helios-logo.png`)}`;
  // The held photo files are 9:16 composites (blurred bands around the picture); keep the sharp middle band.
  const photos = await Promise.all(STORIES.map(async (s) => {
    const f = path.join(SET, `2026-11-13-${s.id}-photo.jpg`);
    const m = await sharp(f).metadata();
    const buf = await sharp(f).extract({ left: 0, top: Math.round(m.height! * 0.35), width: m.width!, height: Math.round(m.height! * 0.5) }).jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  }));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const cards: string[] = [];
  const SHOW = ['final'];
  for (const d of DESIGNS.filter((x) => SHOW.includes(x.key))) {
    for (const pf of PROFILES) {
      await page.setContent(`<!doctype html><style>${FONTS}${BASE}</style><div class="f">${d.html({ logo, photos })}</div><style>${pf.css}</style>`);
      await page.evaluate(() => document.fonts.ready);
      const png = await page.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(OUT, `${d.key}-${pf.key}.png`), png);
      const jpg = (await sharp(png).resize({ width: 540 }).jpeg({ quality: 84, mozjpeg: true }).toBuffer()).toString('base64');
      cards.push(`<article class="card"><img src="data:image/jpeg;base64,${jpg}" alt="${pf.name}"><div class="meta"><p class="dir">${pf.name}</p></div></article>`);
    }
  }
  await browser.close();
  const html = `<title>Morning Download Covers</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&family=Source+Serif+4:opsz,wght@8..60,400&display=swap">
<style>
:root{--bg:#f4f3ef;--paper:#fff;--ink:#17191c;--muted:#5d6168;--rule:#dcd9d1;--accent:#c4501d}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111214;--paper:#1a1c1f;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;--accent:#ff7a3d;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#111214;--paper:#1a1c1f;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;--accent:#ff7a3d;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Source Serif 4",Georgia,serif;padding:28px 16px 56px}
.wrap{max-width:1240px;margin:0 auto;display:grid;gap:24px}
h1{font-family:Archivo,system-ui,sans-serif;font-weight:800;font-size:clamp(28px,5vw,42px);margin:0;letter-spacing:-.02em}
.lede{color:var(--muted);max-width:75ch;line-height:1.5;margin:6px 0 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.card{background:var(--paper);border:1px solid var(--rule);border-radius:8px;overflow:hidden;display:grid;align-content:start;min-width:0}
.card img{display:block;width:100%;height:auto}
.meta{padding:12px 14px 14px;display:grid;gap:6px}
.dir{margin:0;font-family:Archivo,system-ui,sans-serif;font-weight:800;font-size:16px;color:var(--accent)}
.idea{margin:0;font-size:14px;line-height:1.45}
</style>
<div class="wrap"><div><h1>Morning Download Covers</h1>
<p class="lede">The final Morning Download cover on its four colour profiles: black, white (drafting grid), orange (Sunrise) and green. Each uses the ink and accent colours the story frames already use on that backdrop. On the real Nov 13 set; mockups, not the production renderer yet.</p></div>
<div class="grid">${cards.join('')}</div></div>`;
  fs.writeFileSync(out, html);
  console.log(`page ${(html.length / 1024 / 1024).toFixed(1)} MB, ${cards.length} covers`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
