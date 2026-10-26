/**
 * The golden set (planning/Memes/GOLDEN_SET.md G1–G2): parsing Imgflip
 * listing pages and measuring how a caption is written. Pure; no network, no
 * model calls. The page below is a two-meme stand-in with Imgflip's markup.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boxCase, boxFeatures, isNoise, memeFeatures, parseAlt, parseListing, splitWinnersFlops, summarize, templateFromTags,
  type GoldenListing, type GoldenPost,
} from '@/lib/memes/golden';
import { activeCards } from '@/lib/memes/cards-v2';
import { TEMPLATE_CATALOG, writableSlots } from '@/lib/memes/catalog';
import { resolveMeme } from '@/lib/memes/fill';
import { goldenCard, goldenCardProblems } from '@/lib/memes/golden-card';
import { cardText, checkMeme, slotCap, SLOT_CAP_RANGE } from '@/lib/memes/writer';
import { shortlists } from '@/lib/memes/match';
import { checkTurns } from '@/lib/memes/turns';

import { FIXTURE_STORY, FREE, GOOD_MEMES, GOOD_TURNS, t as txt } from './fixtures/memes';

const unit = (id: string, title: string, alt: string, counts: string) =>
  `<div class='base-unit clearfix'><h2 class='base-unit-title'><a href='/i/${id}'>${title}</a></h2><div class='base-img-wrap-wrap'><div class='base-img-wrap'><a class='base-img-link' href='/i/${id}'><img class='base-img' src='//i.imgflip.com/${id}.jpg' alt='${alt}'/></a></div></div><div class='base-info'><div class='base-view-count'>${counts}</div></div></div>`;

const PAGE = [
  '<html><div id="base-left">',
  unit('aa1', 'Every time', 'Every time | Reading the manual; Asking the forum &quot;why&quot; | image tagged in memes,drake hotline bling | made w/ Imgflip meme maker', '12,345 views, 678 upvotes, 9 comments'),
  unit('bb2', 'Drake Hotline Bling', 'Drake Hotline Bling | image tagged in memes,drake hotline bling | made w/ Imgflip meme maker', '40 views'),
  `<div class='base-unit clearfix'><h2 class='base-unit-title'><a href='/gif/cc3'>gif</a></h2><video><p>gif | image tagged in gifs</p></video></div>`,
  '</div></html>',
].join('');

test('parseListing reads id, title, boxes, tags and counts; skips gifs', () => {
  const posts = parseListing(PAGE);
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0], {
    id: 'aa1', title: 'Every time', boxes: ['Reading the manual', 'Asking the forum "why"'],
    tags: ['memes', 'drake hotline bling'], views: 12345, upvotes: 678, comments: 9,
  });
  assert.deepEqual(posts[1]!.boxes, [], 'an alt that only repeats the title has no box text');
  assert.equal(posts[1]!.upvotes, 0);
});

test('parseAlt: one part before the tags is the boxes unless it equals the title', () => {
  assert.deepEqual(parseAlt('smart; smort | image tagged in memes', 'I say smort').boxes, ['smart', 'smort']);
  assert.deepEqual(parseAlt('Drake | image tagged in memes', 'Drake').boxes, []);
  assert.deepEqual(parseAlt('t | a; b; c | image tagged in x,y | made w/ Imgflip meme maker', 't').tags, ['x', 'y']);
});

test('templateFromTags matches the template name Imgflip tags every meme with', () => {
  const names = [{ id: 'drake', name: 'Drake Hotline Bling' }, { id: 'two-buttons', name: 'Two Buttons' }];
  assert.equal(templateFromTags(['memes', 'two buttons', 'ai'], names), 'two-buttons');
  assert.equal(templateFromTags(['chatgpt'], names), null);
});

const post = (id: string, boxes: string[], upvotes: number, seen: GoldenListing[], tags: string[] = ['memes']): GoldenPost & { seen: GoldenListing[] } =>
  ({ id, title: '', boxes, tags, views: 0, upvotes, comments: 0, seen });

test('isNoise drops empty, Imgflip-meta and non-English posts', () => {
  assert.equal(isNoise(post('1', [], 5, [])), true);
  assert.equal(isNoise(post('2', ['give me upvotes'], 5, [])), true);
  assert.equal(isNoise(post('3', ['hi'], 5, [], ['memes', 'FreeKarma4U'])), true);
  assert.equal(isNoise(post('4', ['Привет мир', 'как дела'], 5, [])), true);
  assert.equal(isNoise(post('5', ['Reading the manual', 'Asking the forum'], 5, [])), false);
});

test('splitWinnersFlops: top third of Top-listed posts vs Latest posts with ≤2 upvotes', () => {
  const top = { sort: 'top-century-21', page: 1 };
  const latest = { sort: 'latest', page: 1 };
  const posts = [
    post('a', ['x', 'y'], 900, [top]), post('b', ['x', 'y'], 500, [top]), post('c', ['x', 'y'], 100, [top]),
    post('d', ['x', 'y'], 1, [latest]), post('e', ['x', 'y'], 40, [latest]), post('f', ['x', 'y'], 0, [latest, top]),
  ];
  const { winners, flops } = splitWinnersFlops(posts);
  assert.deepEqual(winners.map((p) => p.id), ['a', 'b']);
  assert.deepEqual(flops.map((p) => p.id), ['d']);
});

test('boxCase and boxFeatures read how one box is written', () => {
  assert.equal(boxCase('ME WHEN THE CODE RUNS'), 'upper');
  assert.equal(boxCase('me when the code runs'), 'lower');
  assert.equal(boxCase('Reading The Whole Manual'), 'title');
  assert.equal(boxCase('Reading the whole manual'), 'sentence');
  const f = boxFeatures('Robots run on the cloud. Network issues.');
  assert.equal(f.multiSentence, true);
  assert.equal(f.end, '.');
  assert.equal(boxFeatures('Me: fixes one bug').opener, 'me:');
  assert.equal(boxFeatures('Me: fixes one bug').dialogue, true);
  assert.equal(boxFeatures('Why is it $20 now?').question, true);
  assert.equal(boxFeatures('Why is it $20 now?').digit, true);
});

test('memeFeatures finds parallel boxes', () => {
  const m = memeFeatures(['Using hand sanitizer to clean your hands', 'Using hand sanitizer to find every tiny cut']);
  assert.equal(m.sameFirstWord, true);
  assert.ok(m.overlap >= 0.25);
  assert.equal(m.noEndMarks, true);
  const s = summarize([['Reading the manual', 'Asking the forum'], ['ONE BOX ONLY']]);
  assert.equal(s.n, 2);
  assert.equal(s.meme.oneBox, 0.5);
  assert.equal(s.box.upper, 1 / 3);
});

// ── The golden cards in the writer (G4) ────────────────────────────────────

test('golden cards: every active template has one, with patterns, our own examples, misreads and a test', () => {
  for (const c of activeCards()) {
    const g = goldenCard(c.id);
    assert.ok(g, `${c.id} has no golden card`);
    assert.deepEqual(goldenCardProblems(c.id, g, writableSlots(c).map((s) => s.id)), [], c.id);
    assert.ok(g.misreads.length >= 1, c.id);
  }
});

test('golden cards: the writer reads the mechanism, the patterns, real line lengths and the misreads', () => {
  const card = TEMPLATE_CATALOG.find((c) => c.id === 'drake')!;
  const text = cardText(card);
  assert.match(text, /WHY IT IS FUNNY: /);
  assert.match(text, /PATTERNS \(every meme on this card follows one; name it in pattern\):/);
  assert.match(text, /REAL LINES: .*HARD CAP: \d+/);
  assert.match(text, /MISREADS/);
  assert.doesNotMatch(text, /How it is used:/, 'the old usage line gives way to the golden card');
  for (const c of TEMPLATE_CATALOG) for (const s of writableSlots(c)) {
    const cap = slotCap(c, s.id);
    if (goldenCard(c.id)?.slotTargets[s.id] && !s.pattern) assert.ok(cap >= SLOT_CAP_RANGE[0] && cap <= SLOT_CAP_RANGE[1], `${c.id}.${s.id} ${cap}`);
  }
});

test('golden cards: a meme must name one of its card\'s patterns', () => {
  const lists = shortlists(checkTurns(GOOD_TURNS, FIXTURE_STORY).kept, { free: new Set(FREE), kind: 'single' }).lists;
  const m = GOOD_MEMES[2]!;
  assert.deepEqual(checkMeme(m, FIXTURE_STORY, lists).errors, []);
  assert.equal(checkMeme(m, FIXTURE_STORY, lists).mapping!.pattern, m.pattern);
  assert.match(checkMeme({ ...m, pattern: '' }, FIXTURE_STORY, lists).errors.join(), /pattern is empty/);
  assert.match(checkMeme({ ...m, pattern: 'made-up' }, FIXTURE_STORY, lists).errors.join(), /pattern "made-up" is not one of/);
  assert.match(checkMeme({ ...m, pattern_fit: '' }, FIXTURE_STORY, lists).errors.join(), /pattern_fit is empty/);
});

test('real-meme writing: one idea per box, and a trailing full stop is dropped rather than the meme', () => {
  const lists = shortlists(checkTurns(GOOD_TURNS, FIXTURE_STORY).kept, { free: new Set(FREE), kind: 'single' }).lists;
  const m = GOOD_MEMES[2]!;
  const two = { ...m, fills: [txt('strong', 'Free plan before. Deep searches.', ['F1']), ...m.fills.slice(1)] };
  assert.match(checkMeme(two, FIXTURE_STORY, lists).errors.join(), /two sentences in one box/);
  const stop = { ...m, fills: [txt('strong', 'The free plan, before.', ['F1']), ...m.fills.slice(1)] };
  const r = checkMeme(stop, FIXTURE_STORY, lists);
  assert.deepEqual(r.errors, []);
  assert.equal(r.mapping!.fill.fills.find((f) => f.slot === 'strong')!.kind === 'text' && (r.mapping!.fill.fills.find((f) => f.slot === 'strong') as { text: string }).text, 'The free plan, before');
});

test('fallbacks: an optional slot left empty prints the format\'s own line', () => {
  const line = (slot: string, text: string) => ({ slot, kind: 'text' as const, text, factIds: ['F1'] });
  const cinema = resolveMeme({ templateId: 'absolute-cinema', fills: [line('cinema', 'When the demo crashes on stage')] });
  assert.equal((cinema.items.find((i) => i.slot === 'cinema-word')!.content as { text: string }).text, 'CINEMA');
  const verdict = resolveMeme({ templateId: 'absolute-cinema', fills: [line('cinema-word', 'MARKETING'), line('cinema', 'When the demo crashes on stage')] });
  assert.equal((verdict.items.find((i) => i.slot === 'cinema-word')!.content as { text: string }).text, 'MARKETING');
  const trophy = resolveMeme({ templateId: 'trophy', fills: [line('missing', 'profit'), { slot: 'speaker', kind: 'entity', playerId: 'openai' }] });
  assert.equal((trophy.items.find((i) => i.slot === 'punch')!.content as { text: string }).text, 'If I had one!');
});
