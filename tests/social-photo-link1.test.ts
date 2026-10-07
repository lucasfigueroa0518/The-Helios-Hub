/**
 * Photo Link 1: the Writer's IMAGE request (photo spec §3–§4;
 * plans/2026-10-07-photo-links.md). Offline: no model, no network.
 *
 * Fixed inputs: fixtures/social/photo-link1/stories.json, the saved briefs,
 * pages (photo records) and Writer drafts of the 2026-10-06/07 daily runs,
 * and the Super Intelligence Force fixture. Each case gives the expected
 * accept or reject and the message telling the Writer what to change.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { sifDraftHandoff } from '@/fixtures/social/drafts';
import { articlePhotosFor, type ListedPhoto } from '@/lib/social/photos/article-list';
import { isNamedIn, namedSubjects, subjectIdsNamedIn, type NamedSubject } from '@/lib/social/photos/named';
import { officialSubjectOf } from '@/lib/social/photos/official-domains';
import { IMAGE_RULE } from '@/lib/social/prompts/rules-block';
import type { Brief } from '@/lib/social/reporter/brief';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import type { DraftSlide, DraftSubmission, ImageRequest } from '@/lib/social/writer/draft';
import { briefForWriter, imageHandoffFailures, photoViewOf, pruneSubjectTags, runWriter, type PhotoView, type WriterSubject } from '@/lib/social/writer/writer';

type Story = { label: string; brief: Brief; pages: PageReadOk[]; writerDraft: DraftSubmission };
const FX = JSON.parse(readFileSync('fixtures/social/photo-link1/stories.json', 'utf8')) as { stories: Story[] };
const story = (label: string) => structuredClone(FX.stories.find((s) => s.label === label)!);

type Flags = Pick<WriterSubject, 'type' | 'headshot_available' | 'logo_available' | 'photo_available'>;
const person = (headshot = true): Flags => ({ type: 'person', headshot_available: headshot, logo_available: false, photo_available: false });
const org = (logo = true, photo = false): Flags => ({ type: 'organization', headshot_available: false, logo_available: logo, photo_available: photo });

/** The handoff view: availability flags by subject name (anything unlisted: nothing), the ARTICLE PHOTOS list. */
function viewFor(brief: Brief, flags: Record<string, Flags>, photos: ListedPhoto[] = []): PhotoView {
  const subjects = brief.subjects.map((s): WriterSubject => ({ ...s, well_known: false, ...(flags[s.name] ?? { type: null, headshot_available: false, logo_available: false, photo_available: false }) }));
  return photoViewOf({ ...brief, subjects, article_photos: photos }, { flags: true });
}

const none: ImageRequest = { kind: 'none', value: '' };
const subj = (value: string): ImageRequest => ({ kind: 'subject', value });
const art = (value: string): ImageRequest => ({ kind: 'article', value });
const stock = (value: string): ImageRequest => ({ kind: 'stock', value });

type SlideSpec = { type?: DraftSlide['type']; headline: string; body?: string; quote_id?: string; number_ids?: string[]; image: ImageRequest; tags?: string[] };

/** A draft for a saved brief: the cover, then the given slides. Notes cover every none. */
function draftOf(cover: { text: string; image: ImageRequest; tags?: string[] }, slides: SlideSpec[]): DraftSubmission {
  return {
    cover_options: [0, 1, 2].map(() => ({ text: cover.text, facts: [], image: cover.image, ...(cover.tags ? { subject_ids: cover.tags } : {}) })),
    chosen_cover: 1,
    slides: slides.map((s) => ({
      type: s.type ?? 'text',
      headline: { text: s.headline, facts: [] },
      body: s.body ? { text: s.body, facts: [] } : null,
      quote_id: s.quote_id ?? null,
      quote_excerpt: null,
      number_ids: s.number_ids ?? [],
      image: s.image,
      ...(s.tags ? { subject_ids: s.tags } : {}),
      spread_with_next: false,
    })),
    follow: 'Follow Helios.',
    caption: { text: 'Caption.', facts: [] },
    edit_notes: slides.map((_, i) => `Slide ${i + 2}: IMAGE none if none, nothing physical fits.`),
  };
}

const errs = (d: DraftSubmission, brief: Brief, view: PhotoView | null) => imageHandoffFailures(d, brief, view).map((e) => `${e.section}: ${e.message}`);
const at = (list: string[], where: string) => list.filter((e) => e.startsWith(`${where}.`)).join(' | ');

// ── Naming (the shared rule for tags and captions) ─────────────────────

const subj3 = (id: string, name: string, kind: NamedSubject['kind']): NamedSubject => ({ id, name, kind });

test('naming, people: the full name or the last name, never the first name', () => {
  const altman = subj3('S1', 'Sam Altman', 'person');
  assert.ok(isNamedIn(altman, 'Sam Altman spoke.'));
  assert.ok(isNamedIn(altman, 'sam altman spoke.'), 'the full name in any case');
  assert.ok(isNamedIn(altman, 'Altman said the world should accept some bad things.'));
  assert.ok(!isNamedIn(altman, 'Sam said so.'), 'never the first name');
  assert.ok(!isNamedIn(subj3('S2', 'Bernie Sanders', 'person'), 'Bernie objected.'), 'never the first name, however long');
  assert.ok(!isNamedIn(altman, 'The altman rule.'), 'a last name with its capital');
});

test('naming, organizations: the full name, or the first word when no other subject shares it', () => {
  const all = [subj3('S1', 'Mistral AI', 'organization'), subj3('S2', 'Thinking Machines Lab', 'organization')];
  assert.ok(isNamedIn(all[0]!, 'Mistral released Le Chonk.', all));
  assert.ok(isNamedIn(all[1]!, 'Thinking said nothing.', all));
  assert.ok(!isNamedIn(all[1]!, 'Machines Lab said nothing.', all), 'never the last word of an organization');
  // Le Chonk (21:17): Mistral AI and Mistral Large 4 share "Mistral": only the full names count.
  const lc = story('lechonk-2117').brief.subjects.map((x) => subj3(x.id, x.name, x.id === 'S1' || x.id === 'S2' ? 'organization' : null));
  assert.ok(!isNamedIn(lc[0]!, 'Mistral released its largest model.', lc));
  assert.ok(isNamedIn(lc[0]!, 'Mistral AI released its largest model.', lc));
});

test('naming: Google and Google DeepMind: only the full names count, and "Google" inside "Google DeepMind" is not Google', () => {
  const all = [subj3('S1', 'Google', 'organization'), subj3('S2', 'Google DeepMind', 'organization')];
  assert.ok(isNamedIn(all[0]!, 'Google cut free access.', all));
  assert.ok(!isNamedIn(all[0]!, 'Google DeepMind trained the model.', all));
  assert.ok(isNamedIn(all[1]!, 'Google DeepMind trained the model.', all));
  assert.ok(!isNamedIn(all[1]!, 'Google trained the model.', all), 'the shared first word never counts');
});

test("naming: an unknown type counts by its full name only; the Reporter's mark fills in when the identity check can't tell", () => {
  assert.ok(!isNamedIn(subj3('S1', 'Pierre Stock', null), 'Stock said the benchmark is fair.'));
  assert.ok(isNamedIn(subj3('S1', 'Pierre Stock', null), 'Pierre Stock said so.'));
  const subjects = [{ id: 'S1', name: 'Pierre Stock', type: 'person' as const }, { id: 'S2', name: 'Mistral AI', type: 'organization' as const }];
  assert.deepEqual(namedSubjects(subjects, null).map((x) => x.kind), ['person', 'organization'], 'the Reporter\'s marks');
  assert.deepEqual(namedSubjects(subjects, new Map([['Pierre Stock', 'organization' as const]])).map((x) => x.kind), ['organization', 'organization'], 'the identity check wins');
  assert.deepEqual(subjectIdsNamedIn('Stock and Mistral announced it', namedSubjects(subjects, null)), ['S1', 'S2']);
});

// ── ARTICLE PHOTOS: the code-built list (photo spec §3 rules 1–4) ──────

test('official domains: each company\'s own news and blog paths; a news site about a company is never its own', () => {
  const subjects = [{ id: 'S1', name: 'Anthropic' }, { id: 'S2', name: 'Google' }];
  assert.equal(officialSubjectOf('https://www.anthropic.com/news/cyber-verification-program', subjects)?.subject.id, 'S1');
  assert.equal(officialSubjectOf('https://9to5google.com/2026/10/03/gemini-model-limits-oct-26/', subjects), null);
  assert.equal(officialSubjectOf('https://blog.google/products/gemini/limits/', subjects)?.subject.id, 'S2');
  assert.equal(officialSubjectOf('https://mistral.ai/news/mistral-large-4/', subjects), null, 'only for a company that is a SUBJECT');
  // News and blog paths only (Tommy, 2026-10-07): no support, product or docs pages.
  assert.equal(officialSubjectOf('https://support.google.com/gemini/answer/16275805', subjects), null);
  assert.equal(officialSubjectOf('https://www.anthropic.com/claude', subjects), null);
  assert.equal(officialSubjectOf('https://claude.com/resources/articles/claude-now-works-in-google-docs', subjects), null);
  assert.equal(officialSubjectOf('https://claude.com/blog/google-docs', subjects)?.subject.id, 'S1');
});

test('ARTICLE PHOTOS on the saved pages: every article photo the saved Writers asked for is out (R02, R15, R17, R18, R33, R36)', () => {
  const asked: Array<[string, string, string]> = [];
  for (const s of FX.stories) {
    const listed = new Set(articlePhotosFor(s.brief, s.pages).map((p) => p.url));
    const d = s.writerDraft;
    for (const img of [d.cover_options[d.chosen_cover - 1]!.image, ...d.slides.map((x) => x.image)]) {
      if (img.kind === 'article') asked.push([s.label, img.value.slice(-40), listed.has(img.value) ? 'listed' : 'out']);
    }
  }
  assert.equal(asked.length, 7, asked.map((a) => a.join(' ')).join(' | '));
  assert.ok(asked.every(([, , v]) => v === 'out'), asked.map((a) => a.join(' ')).join(' | '));
});

test('ARTICLE PHOTOS: why the saved requests are out (og:image share images; captions without an allowed credit)', () => {
  const photoOf = (label: string, part: string) => story(label).pages.flatMap((p) => p.photos).find((p) => p.src.includes(part))!;
  for (const [label, part] of [['altman-1600', 'gettyimages-2294958253'], ['gdocs-0345', 'Tech-featured-image25'], ['security-0345', 'anthropidcyberverificationprogram'], ['gemini-1600', 'l-intro-1791285503']]) {
    assert.equal(photoOf(label!, part!).from, 'og:image', `${part}: a share image, not a body photo`);
  }
  // The-decoder chart (R15) and the Yahoo Gemini picker (R17): captions, but no allowed credit.
  assert.equal(photoOf('mistral-1600', 'Artificial-Analysis-Intelligence-Index').credit, null);
  assert.equal(photoOf('gemini-1600', 'google-gemini-flash-pro-free-users').credit, null);
});

test("ARTICLE PHOTOS: official images come from a SUBJECTS company's own page (mistral.ai, anthropic.com), marked with its ID", () => {
  const lc = articlePhotosFor(story('lechonk-2117').brief, story('lechonk-2117').pages);
  assert.equal(lc.length, 7);
  assert.ok(lc.every((p) => p.official_of === 'S1' && p.page.startsWith('https://mistral.ai/')), 'all from mistral.ai, Mistral AI = S1');
  const sec = articlePhotosFor(story('security-0345').brief, story('security-0345').pages);
  assert.deepEqual(sec.map((p) => [p.official_of, p.caption, new URL(p.page).hostname]), [['S1', 'Overview of the Cyber Verification Program tiers.', 'www.anthropic.com']]);
});

test('ARTICLE PHOTOS: a body photo is listed only with a caption naming a SUBJECT and an allowed credit; og:image never on its own', () => {
  const brief = briefSuperIntelligenceForce();
  const page = (photos: PageReadOk['photos']): PageReadOk => ({ ok: true, url: 'https://news.example/a', resolvedUrl: 'https://news.example/a', title: null, byline: null, publishedTime: null, text: '', truncated: false, photos });
  const p = (src: string, caption: string | null, credit: string | null, from: 'figure' | 'og:image' = 'figure') => ({ src, caption, credit, alt: null, from });
  const listed = articlePhotosFor(brief, [page([
    p('https://x/ok.jpg', 'Donald Trump signs the order.', 'Official White House Photo by Daniel Torok'),
    p('https://x/nosubject.jpg', 'The signing room.', 'Official White House Photo by Daniel Torok'),
    p('https://x/nocaption.jpg', null, 'Official White House Photo by Daniel Torok'),
    p('https://x/agency.jpg', 'Donald Trump speaks.', 'Kevin Dietsch / Getty Images'),
    p('https://x/unknown.jpg', 'Donald Trump speaks.', 'Jane Doe'),
    p('https://x/og.jpg', 'Donald Trump', 'Official White House Photo', 'og:image'),
  ])]);
  assert.deepEqual(listed.map((x) => [x.url, x.subject_ids, x.official_of]), [['https://x/ok.jpg', ['S1'], null]]);
});

// ── The brief the Writer sees ──────────────────────────────────────────

test('the Writer sees type, headshot_available (people), logo_available and photo_available (organizations); the identity check\'s type wins', async () => {
  const brief = briefSuperIntelligenceForce();
  const forWriter = await briefForWriter(brief, async () => false, async (s) => (s.name === 'Super Intelligence Force' ? { kind: 'organization', headshot: true, logo: false, photo: true } : s.name === 'Jay Clayton' ? { kind: null, headshot: false, logo: true, photo: true } : { kind: 'person', headshot: true, logo: true, photo: true }));
  assert.deepEqual(forWriter.subjects.map((s) => [s.name, s.type, s.headshot_available, s.logo_available, s.photo_available]), [
    ['Donald Trump', 'person', true, false, false],
    ['Jay Clayton', 'person', false, false, false], // the identity check couldn't tell: the Reporter's mark
    ['Super Intelligence Force', 'organization', false, false, true],
  ]);
  assert.deepEqual(forWriter.article_photos, [], 'no pages, no photos (the Reporter\'s retyped list is not used)');
});

test('the IMAGE rule tells the Writer the new handoff', () => {
  for (const s of ['subject_ids', 'headshot_available true', 'logo_available true', 'on the cover with logo_available true (its logo card), on a story slide with photo_available or logo_available true, its main photo and its logo each at most once per post besides the cover', 'an official_of image only on the cover or a slide tagged with that company', 'On a quote slide, IMAGE is the speaker (subject: <the quote\'s speaker>), whether or not they have a photo; none only when the speaker is an organization or isn\'t in SUBJECTS', 'a stat slide\'s background is automatic, so its IMAGE is none', 'Never change a slide\'s words to fit a photo or a tag']) {
    assert.ok(IMAGE_RULE.includes(s), s);
  }
});

// ── Subject tags ───────────────────────────────────────────────────────

test('tags: required on the cover and every slide, SUBJECTS IDs only, each named on its slide (a quote slide names its speaker)', () => {
  const brief = briefSuperIntelligenceForce();
  assert.deepEqual(errs(sifDraftHandoff(), brief, null), [], 'the fixture draft passes');
  const d = sifDraftHandoff();
  delete d.slides[0]!.subject_ids;
  d.slides[1]!.subject_ids = ['S2', 'S9'];
  d.slides[4]!.subject_ids = ['S2'];
  const e = errs(d, brief, null);
  assert.match(at(e, 'slide 2'), /tag this slide with subject_ids: the SUBJECTS IDs it is about and names \(an empty list if none\)/);
  assert.match(at(e, 'slide 3'), /S9 isn't a SUBJECTS ID; remove it/);
  assert.match(at(e, 'slide 6'), /S2 \(Jay Clayton\) isn't named on this slide; remove the tag \(never change the slide's words to fit a tag\)/);
  assert.equal(at(e, 'slide 4'), '', 'the quote slide names Trump through its speaker line');
});

// ── Subject requests: headshots, logos, limits ─────────────────────────

test('Le Chonk (R10, 21:17): "subject: Mistral AI" is a logo request: the cover and one story slide; never a second slide; never without a logo', () => {
  const s = story('lechonk-2117');
  const view = viewFor(s.brief, { 'Mistral AI': org(true) });
  // Mistral AI and Mistral Large 4 share "Mistral": the slides name Mistral AI in full.
  const d = draftOf({ text: 'Mistral AI says its new model is the best open one outside China', image: subj('Mistral AI'), tags: ['S1'] }, [
    { headline: 'Mistral AI ships Le Chonk', body: 'It released its largest model yet.', image: subj('Mistral AI'), tags: ['S1'] },
    { headline: 'Why Mistral AI matters', body: 'It is Europe\'s best-funded AI lab.', image: subj('Mistral AI'), tags: ['S1'] },
  ]);
  const e = errs(d, s.brief, view);
  assert.equal(at(e, 'cover'), '');
  assert.equal(at(e, 'slide 2'), '');
  assert.match(at(e, 'slide 3'), /Mistral AI is already shown on slide 2; an organization goes on at most 1 story slide \(its main photo once, its logo once\)/);
  const noLogo = errs(d, s.brief, viewFor(s.brief, { 'Mistral AI': org(false) }));
  assert.match(at(noLogo, 'cover'), /Mistral AI has no verified logo for the cover card \(logo_available: false\); change the request to an article photo, a literal stock scene or none/);
});

test('Altman (16:00): OpenAI (R07, R08) and Anthropic (R05) are logo requests on slides that name them; untagged fails', () => {
  const s = story('altman-1600');
  const view = viewFor(s.brief, { 'Sam Altman': person(), OpenAI: org(), Anthropic: org() });
  const d = draftOf({ text: 'OpenAI CEO Sam Altman says the world should accept some bad things', image: subj('Sam Altman'), tags: ['S1', 'S2'] }, [
    { headline: 'OpenAI\'s pitch', body: 'OpenAI says the benefits outweigh the harms.', image: subj('OpenAI'), tags: ['S2'] },
    { headline: 'Anthropic disagrees', body: 'Anthropic has argued for slower deployment.', image: subj('Anthropic'), tags: ['S3'] },
    { headline: 'The backlash', body: 'Critics called the remarks reckless.', image: subj('OpenAI'), tags: [] },
  ]);
  const e = errs(d, s.brief, view);
  assert.equal(at(e, 'slide 2'), '');
  assert.equal(at(e, 'slide 3'), '');
  assert.match(at(e, 'slide 4'), /subject: OpenAI isn't tagged on this slide; request only a subject the slide is tagged with/);
});

test('a person: the headshot once per post besides their quote slide; never without a verified headshot', () => {
  const s = story('altman-1600');
  const view = viewFor(s.brief, { 'Sam Altman': person(), 'Jensen Huang': person(false) });
  const d = draftOf({ text: 'Sam Altman says the world should accept some bad things', image: subj('Sam Altman'), tags: ['S1'] }, [
    { type: 'quote', headline: 'In his words', quote_id: 'Q1', image: subj('Sam Altman'), tags: ['S1'] },
    { headline: 'Altman again', body: 'Altman doubled down on Monday.', image: subj('Sam Altman'), tags: ['S1'] },
    { headline: 'Huang weighs in', body: 'Jensen Huang said chips are not the bottleneck.', image: subj('Jensen Huang'), tags: ['S8'] },
  ]);
  const e = errs(d, s.brief, view);
  assert.equal(at(e, 'slide 2'), '', 'his quote slide may show him again (a second photo)');
  assert.match(at(e, 'slide 3'), /Sam Altman is already requested on cover; each person at most once per post \(their quote slide aside\)/);
  assert.match(at(e, 'slide 4'), /Jensen Huang has no verified headshot \(headshot_available: false\)/);
});

test('an organization on story slides: its main photo (often the headquarters) and its logo, once each; the cover stays the logo card', () => {
  const s = story('altman-1600');
  const d = draftOf({ text: 'OpenAI CEO Sam Altman says the world should accept some bad things', image: subj('OpenAI'), tags: ['S1', 'S2'] }, [
    { headline: "OpenAI's pitch", body: 'OpenAI says the benefits outweigh the harms.', image: subj('OpenAI'), tags: ['S2'] },
    { headline: 'Inside OpenAI', body: 'OpenAI has grown to thousands of staff.', image: subj('OpenAI'), tags: ['S2'] },
    { headline: 'OpenAI again', body: 'OpenAI declined to comment.', image: subj('OpenAI'), tags: ['S2'] },
  ]);
  const both = errs(d, s.brief, viewFor(s.brief, { OpenAI: org(true, true) }));
  assert.equal(at(both, 'cover') + at(both, 'slide 2') + at(both, 'slide 3'), '', 'the logo card, the headquarters, the logo');
  assert.match(at(both, 'slide 4'), /OpenAI is already shown on slide 2 and slide 3; an organization goes on at most 2 story slides/);
  const photoOnly = errs(d, s.brief, viewFor(s.brief, { OpenAI: org(false, true) }));
  assert.match(at(photoOnly, 'cover'), /OpenAI has no verified logo for the cover card/);
  assert.equal(at(photoOnly, 'slide 2'), '', 'the headquarters on a story slide');
  assert.match(at(photoOnly, 'slide 3'), /at most 1 story slide/);
});

// ── Article requests ───────────────────────────────────────────────────

test("article requests: only from the list; a caption's subjects must meet the slide's tags; an official image only on the cover or its company's slide", () => {
  const s = story('security-0345');
  const photos = articlePhotosFor(s.brief, s.pages);
  const official = photos[0]!.url;
  const extra: ListedPhoto = { url: 'https://x/glasswing.jpg', caption: 'Project Glasswing partners', credit: 'Courtesy of Anthropic', page: 'https://x', subject_ids: ['S2'], official_of: null };
  const view = viewFor(s.brief, { Anthropic: org() }, [...photos, extra]);
  const saved = s.writerDraft.slides[1]!.image.value; // R36, the SiliconANGLE share image
  const d = draftOf({ text: 'Anthropic merges two security programs', image: art(official), tags: ['S1'] }, [
    { headline: 'Two programs become one', body: 'Anthropic folded Project Glasswing into the new program.', image: art(official), tags: ['S1', 'S2'] },
    { headline: 'Who qualifies', body: 'Vetted security teams get fewer blocks.', image: art(official), tags: [] },
    { headline: 'The tiers', body: 'Three tiers, from research to defense work.', image: art(saved), tags: [] },
    { headline: 'Glasswing partners', body: 'Project Glasswing partners keep their access.', image: art('https://x/glasswing.jpg'), tags: ['S2'] },
    { headline: 'Booz Allen joins', body: 'Booz Allen is among the first members.', image: art('https://x/glasswing.jpg'), tags: ['S5'] },
  ]);
  const e = errs(d, s.brief, view);
  assert.equal(at(e, 'cover'), '');
  assert.equal(at(e, 'slide 2'), '');
  assert.match(at(e, 'slide 3'), /an official image of Anthropic goes only on the cover or a slide tagged with Anthropic/);
  assert.match(at(e, 'slide 4'), /isn't in ARTICLE PHOTOS; use one listed there/);
  assert.equal(at(e, 'slide 5'), '');
  assert.match(at(e, 'slide 6'), /this article photo's caption names Project Glasswing; the slide isn't tagged with any of them/);
});

// ── Quote slides (photo spec §4, corrected 2026-10-07) ─────────────────

test('quote slides: the speaker whether or not they have a photo (DeSantis, Pierre Stock); never another person, a logo or a scene', () => {
  const a = story('altman-2117');
  const view = viewFor(a.brief, { 'Ron DeSantis': person(false), 'Sam Altman': person() });
  const q = (image: ImageRequest) => at(errs(draftOf({ text: 'Altman says some bad things will happen', image: subj('Sam Altman'), tags: ['S1'] }, [{ type: 'quote', headline: 'DeSantis responds', quote_id: 'Q5', image, tags: ['S6'] }]), a.brief, view), 'slide 2');
  assert.equal(q(subj('Ron DeSantis')), '', 'no verified headshot: still the speaker (a type-led slide if nothing else is found)');
  assert.match(q(none), /a quote slide's IMAGE is its speaker \(subject: Ron DeSantis\), never another person, a logo or a scene/);
  assert.match(q(subj('Sam Altman')), /a quote slide's IMAGE is its speaker \(subject: Ron DeSantis\)/);
  assert.match(q(stock('podium')), /a quote slide's IMAGE is its speaker/);
  const m = story('mistral-1600');
  const stockQuote = draftOf({ text: 'Mistral ships Large 4', image: subj('Mistral AI'), tags: ['S1'] }, [{ type: 'quote', headline: 'Stock on the benchmark', quote_id: 'Q5', image: subj('Pierre Stock'), tags: ['S4'] }]);
  assert.equal(at(errs(stockQuote, m.brief, viewFor(m.brief, { 'Pierre Stock': person(false), 'Mistral AI': org() })), 'slide 2'), '');
});

test("quote slides: an organization speaker (Anthropic) or a speaker not in SUBJECTS (Topolsky) takes none, a type-led slide; never the company's logo in the speaker's spot", () => {
  const g = story('gdocs-0345');
  const gv = viewFor(g.brief, { Anthropic: org() });
  const q = (brief: Brief, view: PhotoView, quoteId: string, image: ImageRequest, tags: string[]) => at(errs(draftOf({ text: 'Anthropic puts Claude in Google Docs', image: subj('Anthropic'), tags: ['S1'] }, [{ type: 'quote', headline: 'What it said', quote_id: quoteId, image, tags }]), brief, view), 'slide 2');
  assert.equal(q(g.brief, gv, 'Q1', none, ['S1']), '');
  assert.match(q(g.brief, gv, 'Q1', subj('Anthropic'), ['S1']), /the speaker \(Anthropic\) is an organization: its logo never goes in the speaker's spot, so its IMAGE is none \(a type-led quote slide\)/);
  const a = story('altman-1600');
  assert.equal(a.brief.quotes.find((x) => x.id === 'Q6')!.speaker_id, null, 'Joshua Topolsky is not in this older brief\'s SUBJECTS');
  assert.equal(q(a.brief, viewFor(a.brief, {}), 'Q6', none, []), '');
  assert.match(q(a.brief, viewFor(a.brief, { 'Sam Altman': person() }), 'Q6', subj('Sam Altman'), []), /the quote's speaker isn't in SUBJECTS: its IMAGE is none \(a type-led quote slide\)/);
});

// ── Stat slides, stock ─────────────────────────────────────────────────

test('stat slides take none (R11, R14, R20: the saved stock backdrops fail); stock must name something on the slide (R23)', () => {
  const m = story('mistral-1600');
  const d = draftOf({ text: 'Mistral ships Large 4', image: subj('Mistral AI'), tags: ['S1'] }, [
    { type: 'stat', headline: 'A trillion parameters', number_ids: [m.brief.numbers[0]!.id], image: stock('data center racks'), tags: [] },
    { type: 'stat', headline: 'Its score', number_ids: [m.brief.numbers[0]!.id], image: stock('code on screen'), tags: [] },
    { type: 'split_stat', headline: 'Price', number_ids: m.brief.numbers.slice(0, 2).map((n) => n.id), image: stock('price tag cash'), tags: [] },
    { headline: 'How it works', body: 'A mixture of experts routes each token to a few experts.', image: stock('abstract neural network'), tags: [] },
  ]);
  const e = errs(d, m.brief, viewFor(m.brief, { 'Mistral AI': org() }));
  assert.match(at(e, 'slide 2'), /a stat slide's background is automatic: its IMAGE is none, not stock: data center racks/);
  assert.match(at(e, 'slide 3'), /not stock: code on screen/);
  assert.match(at(e, 'slide 4'), /a split_stat slide's background is automatic: its IMAGE is none, not stock: price tag cash/);
  assert.match(at(e, 'slide 5'), /stock "abstract neural network" doesn't name a physical thing this slide mentions/);
});

// ── The final attempt: tags pruned, requests dropped, words kept ───────

const usage = { input_tokens: 4000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 };
const msg = (input: unknown) => ({ id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'tool_use', stop_sequence: null, usage, content: [{ type: 'tool_use', id: `t_${Math.random()}`, name: 'submit_draft', input }] }) as unknown as Anthropic.Message;
const scripted = (inputs: unknown[]): MessagesCreate => async () => msg(inputs.shift());

test('final attempt: failing tags are removed and logged, then failing requests become none; the words never change', async () => {
  const brief = briefSuperIntelligenceForce();
  const bad = sifDraftHandoff();
  bad.slides[1]!.subject_ids = ['S2', 'S1']; // Trump isn't named on the Clayton slide
  delete bad.slides[4]!.subject_ids;
  bad.slides[5]!.image = { kind: 'subject', value: 'Jay Clayton' };
  bad.slides[5]!.subject_ids = ['S2']; // Clayton isn't named on "Why the name"
  const r = await runWriter(brief, { create: scripted([bad, structuredClone(bad)]), isWellKnown: async () => false });
  assert.ok(r.ok);
  assert.deepEqual(r.draft.slides[1]!.subject_ids, ['S2']);
  assert.deepEqual(r.draft.slides[4]!.subject_ids, []);
  assert.deepEqual(r.draft.slides[5]!.subject_ids, []);
  assert.equal(r.draft.slides[5]!.image.kind, 'none', 'the request lost its tag, so it is dropped');
  assert.equal(r.draft.slides[1]!.image.value, 'Jay Clayton', 'a request whose tag survives is kept');
  assert.deepEqual(r.draft.slides.map((s) => s.headline.text), bad.slides.map((s) => s.headline.text), 'words unchanged');
  for (const line of ['subject-tag-dropped: slide 3 S1 (Donald Trump) (not named on the slide)', 'subject-tag-dropped: slide 6 had no subject_ids → []', 'subject-tag-dropped: slide 7 S2 (Jay Clayton) (not named on the slide)']) {
    assert.ok(r.imageRequestsDropped.includes(line), `${line} | ${r.imageRequestsDropped.join(' | ')}`);
  }
  assert.ok(r.imageRequestsDropped.some((l) => /^image-request-dropped: slide 7 subject: Jay Clayton → none/.test(l)), r.imageRequestsDropped.join(' | '));
});

test("words stay when a tag fails: adding a name to the slide to fit its tag fails the retry", async () => {
  const brief = briefSuperIntelligenceForce();
  const bad = sifDraftHandoff();
  bad.slides[4]!.subject_ids = ['S2'];
  const rewritten = structuredClone(bad);
  rewritten.slides[4]!.body!.text = 'Clayton says the charter will plan responses to SI-enabled threats while preventing overregulation.';
  const r = await runWriter(brief, { create: scripted([bad, rewritten]), isWellKnown: async () => false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /slide 6: the words changed after its IMAGE request failed; restore them/);
});

test('pruneSubjectTags keeps valid tags and only touches tags', () => {
  const brief = briefSuperIntelligenceForce();
  const d = sifDraftHandoff();
  const { draft, dropped } = pruneSubjectTags(d, brief);
  assert.deepEqual(draft, d);
  assert.deepEqual(dropped, []);
});

// ── The type-led quote slide (photo spec §4) ───────────────────────────

import { toRenderPost } from '@/lib/social/render/from-draft';
import { fillDraft } from '@/lib/social/writer/draft';

test("type-led quote slide: no verified speaker photo → quote mark, quote, the speaker's name and role; with the photo, no role line", async () => {
  const React = await import('react');
  (globalThis as { React?: unknown }).React = React;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SlideTemplate } = await import('@/lib/social/render/SlideTemplate');
  const brief = briefSuperIntelligenceForce();
  const filled = fillDraft(sifDraftHandoff(), brief);
  const meta = { source: 'TechCrunch', sourceUrl: 'https://techcrunch.com/x', publishedAt: '2026-10-04T12:00:00Z' };
  const typeLed = toRenderPost(filled, { cover: null, slides: filled.slides.map(() => null) }, meta);
  const at = typeLed.slides.findIndex((s) => s.layoutVariant === 'quote');
  const html = renderToStaticMarkup(React.createElement(SlideTemplate, { post: typeLed, position: at }));
  assert.match(html, /helios-quote__glyph/);
  assert.match(html, /Donald Trump<span class="helios-quote__role">, President of the United States<\/span>/);
  const photo = { url: 'https://upload.wikimedia.org/trump.jpg', credit: 'x', source: 'commons' as const, width: 800, height: 1000, qid: 'Q22686', subject: 'Donald Trump' };
  const withPhoto = toRenderPost(filled, { cover: null, slides: filled.slides.map((s) => (s.type === 'quote' ? photo : null)) }, meta);
  const photoHtml = renderToStaticMarkup(React.createElement(SlideTemplate, { post: withPhoto, position: at }));
  assert.match(photoHtml, /helios-quote--speaker/);
  assert.doesNotMatch(photoHtml, /helios-quote__role/, 'the accepted speaker layout is unchanged');
});
