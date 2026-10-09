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
import { VISUAL_RULE } from '@/lib/social/prompts/rules-block';
import type { Brief } from '@/lib/social/reporter/brief';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import type { DraftSlide, DraftSubmission, VisualRequest } from '@/lib/social/writer/draft';
import { briefForWriter, photoViewOf, pruneSubjectTags, runWriter, visualHandoffFailures, type PhotoView, type WriterSubject } from '@/lib/social/writer/writer';

type Story = { label: string; brief: Brief; pages: PageReadOk[]; writerDraft: DraftSubmission };
const FX = JSON.parse(readFileSync('fixtures/social/photo-link1/stories.json', 'utf8')) as { stories: Story[] };
const story = (label: string) => structuredClone(FX.stories.find((s) => s.label === label)!);

type Flags = Pick<WriterSubject, 'type' | 'headshot_available' | 'logo_available'>;
const person = (headshot = true): Flags => ({ type: 'person', headshot_available: headshot, logo_available: false });
const org = (logo = true): Flags => ({ type: 'organization', headshot_available: false, logo_available: logo });

/** The handoff view: availability flags by subject name (anything unlisted: nothing). */
function viewFor(brief: Brief, flags: Record<string, Flags>): PhotoView {
  const { article_photos: _a, ...rest } = brief;
  void _a;
  const subjects = brief.subjects.map((s): WriterSubject => ({ ...s, well_known: false, ...(flags[s.name] ?? { type: null, headshot_available: false, logo_available: false }) }));
  return photoViewOf({ ...rest, subjects }, { flags: true });
}

const vPerson = (query: string): VisualRequest => ({ kind: 'person', query });
const vCompany = (query: string): VisualRequest => ({ kind: 'company', query });
const vLogo = (query: string): VisualRequest => ({ kind: 'logo', query });
const scene = (query: string): VisualRequest => ({ kind: 'thematic', query });

type SlideSpec = { type?: DraftSlide['type']; headline: string; body?: string; quote_id?: string; number_ids?: string[]; visual: VisualRequest; fallback?: VisualRequest; tags?: string[] };

const fallbackFor = (v: VisualRequest) => (v.query === 'office desk' ? scene('city street') : scene('office desk'));

/** A draft for a saved brief: the cover, then the given slides (each with a scene fallback unless given). */
function draftOf(cover: { text: string; visual: VisualRequest; tags?: string[] }, slides: SlideSpec[]): DraftSubmission {
  return {
    cover_options: [0, 1, 2].map(() => ({ text: cover.text, facts: [], visual: cover.visual, fallback_visual: fallbackFor(cover.visual), icon: 'newspaper', ...(cover.tags ? { subject_ids: cover.tags } : {}) })),
    chosen_cover: 1,
    slides: slides.map((s) => ({
      type: s.type ?? 'text',
      headline: { text: s.headline, facts: [] },
      body: s.body ? { text: s.body, facts: [] } : null,
      quote_id: s.quote_id ?? null,
      quote_excerpt: null,
      number_ids: s.number_ids ?? [],
      visual: s.visual,
      fallback_visual: s.fallback ?? fallbackFor(s.visual),
      icon: 'newspaper',
      ...(s.tags ? { subject_ids: s.tags } : {}),
    })),
    follow: 'Follow Helios.',
    caption: { text: 'Caption.', facts: [] },
    edit_notes: [],
  };
}

const errs = (d: DraftSubmission, brief: Brief, view: PhotoView | null) => visualHandoffFailures(d, brief, view).map((e) => `${e.section}: ${e.message}`);
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

test('official domains: any page on a company\'s own domain (fifth round); a news site about a company is never its own', () => {
  const subjects = [{ id: 'S1', name: 'Anthropic' }, { id: 'S2', name: 'Google' }];
  assert.equal(officialSubjectOf('https://www.anthropic.com/news/cyber-verification-program', subjects)?.subject.id, 'S1');
  assert.equal(officialSubjectOf('https://9to5google.com/2026/10/03/gemini-model-limits-oct-26/', subjects), null);
  assert.equal(officialSubjectOf('https://blog.google/products/gemini/limits/', subjects)?.subject.id, 'S2');
  assert.equal(officialSubjectOf('https://mistral.ai/news/mistral-large-4/', subjects), null, 'only for a company that is a SUBJECT');
  // Any page on the company's own domain (Tommy, 2026-10-07, fifth round): the Haiku 5.5 launch page counts.
  assert.equal(officialSubjectOf('https://www.anthropic.com/claude-haiku-5-5', subjects)?.subject.id, 'S1');
  assert.equal(officialSubjectOf('https://claude.com/resources/articles/claude-now-works-in-google-docs', subjects)?.subject.id, 'S1');
  // Shared hosts stay limited to the company's section: support.google.com is not on Google's list.
  assert.equal(officialSubjectOf('https://support.google.com/gemini/answer/16275805', subjects), null);
});

test('ARTICLE PHOTOS on the saved pages: every article photo the saved Writers asked for is out (R02, R15, R17, R18, R33, R36)', () => {
  const asked: Array<[string, string, string]> = [];
  for (const s of FX.stories) {
    const listed = new Set(articlePhotosFor(s.brief, s.pages).map((p) => p.url));
    // The saved drafts predate the sixth round: their old IMAGE requests.
    const d = s.writerDraft as unknown as { chosen_cover: number; cover_options: Array<{ image: { kind: string; value: string } }>; slides: Array<{ image: { kind: string; value: string } }> };
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

test('the Writer sees type, headshot_available (people) and logo_available (organizations: logos only); the identity check\'s type wins', async () => {
  const brief = briefSuperIntelligenceForce();
  const forWriter = await briefForWriter(brief, async () => false, async (s) => (s.name === 'Super Intelligence Force' ? { kind: 'organization', headshot: true, logo: false } : s.name === 'Jay Clayton' ? { kind: null, headshot: false, logo: true } : { kind: 'person', headshot: true, logo: true }));
  assert.deepEqual(forWriter.subjects.map((s) => [s.name, s.type, s.headshot_available, s.logo_available]), [
    ['Donald Trump', 'person', true, false],
    ['Jay Clayton', 'person', false, false], // the identity check couldn't tell: the Reporter's mark
    ['Super Intelligence Force', 'organization', false, false],
  ]);
  assert.ok(forWriter.subjects.every((s) => !('photo_available' in s)), 'no company main photos (Tommy, 2026-10-07)');
  assert.ok(!('article_photos' in forWriter), 'article photos are a source the search tries, never asked for by URL (sixth round)');
});

test('the VISUAL rule tells the Writer the two-tier request and how the search reads it', () => {
  for (const s of ['subject_ids', 'VISUAL and a different FALLBACK VISUAL', 'person: <SUBJECTS name>', 'headshot_available true', 'company: <SUBJECTS name>', 'logo: <SUBJECTS name> (with logo_available true)', 'product: <1–5 words naming it>', 'event: <1–5 words naming what happened>', 'thematic: <a plain 2–4 word physical scene tied to the topic, never a name>', 'setting: <a plain 2–4 word place type, never a named place>', "On a quote slide, VISUAL is the speaker (person: <the quote's speaker>) when the speaker is a person in SUBJECTS", "Never change a slide's words to fit a visual or a tag"]) {
    assert.ok(VISUAL_RULE.includes(s), s);
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

// ── Visual requests by kind (sixth round) ──────────────────────────────

test('Le Chonk (R10, 21:17): "logo: Mistral AI" on any slide that names it; never without a verified logo', () => {
  const s = story('lechonk-2117');
  const view = viewFor(s.brief, { 'Mistral AI': org(true) });
  // Mistral AI and Mistral Large 4 share "Mistral": the slides name Mistral AI in full.
  const d = draftOf({ text: 'Mistral AI says its new model is the best open one outside China', visual: vLogo('Mistral AI'), tags: ['S1'] }, [
    { headline: 'Mistral AI ships Le Chonk', body: 'It released its largest model yet.', visual: vCompany('Mistral AI'), tags: ['S1'] },
    { headline: 'Why Mistral AI matters', body: 'It is Europe\'s best-funded AI lab.', visual: vLogo('Mistral AI'), tags: ['S1'] },
  ]);
  const e = errs(d, s.brief, view);
  assert.equal(at(e, 'cover') + at(e, 'slide 2') + at(e, 'slide 3'), '');
  const noLogo = errs(d, s.brief, viewFor(s.brief, { 'Mistral AI': org(false) }));
  assert.match(at(noLogo, 'cover'), /Mistral AI has no verified logo \(logo_available: false\); ask for another visual/);
});

test('Altman (16:00): company and logo visuals only on slides that name them; untagged fails', () => {
  const s = story('altman-1600');
  const view = viewFor(s.brief, { 'Sam Altman': person(), OpenAI: org(), Anthropic: org() });
  const d = draftOf({ text: 'OpenAI CEO Sam Altman says the world should accept some bad things', visual: vPerson('Sam Altman'), tags: ['S1', 'S2'] }, [
    { headline: 'OpenAI\'s pitch', body: 'OpenAI says the benefits outweigh the harms.', visual: vCompany('OpenAI'), tags: ['S2'] },
    { headline: 'Anthropic disagrees', body: 'Anthropic has argued for slower deployment.', visual: vLogo('Anthropic'), tags: ['S3'] },
    { headline: 'The backlash', body: 'Critics called the remarks reckless.', visual: vCompany('OpenAI'), tags: [] },
  ]);
  const e = errs(d, s.brief, view);
  assert.equal(at(e, 'slide 2') + at(e, 'slide 3'), '');
  assert.match(at(e, 'slide 4'), /company: OpenAI isn't tagged on this slide; ask only for a subject the slide names, or ask for a thematic, setting, product or event visual/);
});

test('person visuals: on any slide that names them (no once-per-post limit); never without a verified headshot; never an organization', () => {
  const s = story('altman-1600');
  const view = viewFor(s.brief, { 'Sam Altman': person(), 'Jensen Huang': person(false), OpenAI: org() });
  const d = draftOf({ text: 'Sam Altman says the world should accept some bad things', visual: vPerson('Sam Altman'), tags: ['S1'] }, [
    { headline: 'Altman again', body: 'Altman doubled down on Monday.', visual: vPerson('Sam Altman'), tags: ['S1'] },
    { headline: 'Huang weighs in', body: 'Jensen Huang said chips are not the bottleneck.', visual: vPerson('Jensen Huang'), tags: ['S8'] },
    { headline: "OpenAI's view", body: 'OpenAI says the benefits outweigh the harms.', visual: vPerson('OpenAI'), tags: ['S2'] },
  ]);
  const e = errs(d, s.brief, view);
  assert.equal(at(e, 'slide 2'), '', 'the pick keeps the same photo off neighbouring slides');
  assert.match(at(e, 'slide 3'), /Jensen Huang has no verified headshot \(headshot_available: false\)/);
  assert.match(at(e, 'slide 4'), /OpenAI is an organization: ask for company: or logo:, not person:/);
});

// ── Quote slides ───────────────────────────────────────────────────────

test('quote slides: a person speaker in SUBJECTS with a verified headshot is the visual; without one, the slide asks for what the quote is about (seventh round)', () => {
  const a = story('altman-2117');
  const q = (view: PhotoView, visual: VisualRequest) => at(errs(draftOf({ text: 'Altman says some bad things will happen', visual: vPerson('Sam Altman'), tags: ['S1'] }, [{ type: 'quote', headline: 'DeSantis responds', quote_id: 'Q5', visual, tags: ['S6'] }]), a.brief, view), 'slide 2');
  const withPhoto = viewFor(a.brief, { 'Ron DeSantis': person(), 'Sam Altman': person() });
  assert.doesNotMatch(q(withPhoto, vPerson('Ron DeSantis')), /a quote slide's visual/);
  assert.match(q(withPhoto, scene('podium')), /a quote slide's visual is its speaker \(person: Ron DeSantis\)/);
  assert.match(q(withPhoto, vPerson('Sam Altman')), /a quote slide's visual is its speaker \(person: Ron DeSantis\)/);
  // No verified headshot: the speaker can't be asked for (the headshot check would reject it), so no speaker rule.
  const noPhoto = viewFor(a.brief, { 'Ron DeSantis': person(false), 'Sam Altman': person() });
  assert.equal(q(noPhoto, scene('podium')), '');
  assert.doesNotMatch(q(noPhoto, vPerson('Ron DeSantis')), /a quote slide's visual/);
  const m = story('mistral-1600');
  const stockQuote = draftOf({ text: 'Mistral ships Large 4', visual: vCompany('Mistral AI'), tags: ['S1'] }, [{ type: 'quote', headline: 'Stock on the benchmark', quote_id: 'Q5', visual: vPerson('Pierre Stock'), tags: ['S4'] }]);
  assert.doesNotMatch(at(errs(stockQuote, m.brief, viewFor(m.brief, { 'Pierre Stock': person(false), 'Mistral AI': org() })), 'slide 2'), /quote slide/);
});

test('quote slides: an organization speaker (Anthropic) or one not in SUBJECTS (Topolsky) may ask for any visual (the round spot is only ever a verified speaker photo)', () => {
  const g = story('gdocs-0345');
  const gv = viewFor(g.brief, { Anthropic: org() });
  const q = (brief: Brief, view: PhotoView, quoteId: string, visual: VisualRequest, tags: string[]) => at(errs(draftOf({ text: 'Anthropic puts Claude in Google Docs', visual: vLogo('Anthropic'), tags: ['S1'] }, [{ type: 'quote', headline: 'What it said', quote_id: quoteId, visual, tags }]), brief, view), 'slide 2');
  assert.equal(q(g.brief, gv, 'Q1', scene('document editor'), ['S1']), '');
  assert.equal(q(g.brief, gv, 'Q1', vCompany('Anthropic'), ['S1']), '');
  const a = story('altman-1600');
  assert.equal(a.brief.quotes.find((x) => x.id === 'Q6')!.speaker_id, null, 'Joshua Topolsky is not in this older brief\'s SUBJECTS');
  assert.equal(q(a.brief, viewFor(a.brief, {}), 'Q6', scene('newsroom desk'), []), '');
});

// ── Stat slides and scenes ─────────────────────────────────────────────

test('stat slides: no cap since the seventh round; scenes (thematic, setting) never name a SUBJECT; conceptual scenes need not be on the slide', () => {
  const m = story('mistral-1600');
  const d = draftOf({ text: 'Mistral ships Large 4', visual: vCompany('Mistral AI'), tags: ['S1'] }, [
    { type: 'stat', headline: 'A trillion parameters', number_ids: [m.brief.numbers[0]!.id], visual: scene('data center racks'), tags: [] },
    { type: 'stat', headline: 'Its score', number_ids: [m.brief.numbers[0]!.id], visual: scene('code on screen'), tags: [] },
    { type: 'stat', headline: 'Price', number_ids: m.brief.numbers.slice(0, 2).map((n) => n.id), visual: scene('price tag cash'), tags: [] },
    { headline: 'How it works', body: 'A mixture of experts routes each token to a few experts.', visual: scene('abstract neural network'), tags: [] },
    { headline: 'Where it runs', body: 'It runs on rented chips.', visual: { kind: 'setting', query: 'Mistral AI office' }, tags: [] },
  ]);
  const e = errs(d, m.brief, viewFor(m.brief, { 'Mistral AI': org() }));
  assert.equal(at(e, 'slide 2') + at(e, 'slide 3') + at(e, 'slide 4') + at(e, 'slide 5'), '');
  assert.match(at(e, 'slide 6'), /scene "Mistral AI office" names Mistral AI/);
  assert.doesNotMatch(e.join(' | '), /stat slides/);
});

// ── The final attempt: tags pruned, requests dropped, words kept ───────

const usage = { input_tokens: 4000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 };
const msg = (input: unknown) => ({ id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'tool_use', stop_sequence: null, usage, content: [{ type: 'tool_use', id: `t_${Math.random()}`, name: 'submit_draft', input }] }) as unknown as Anthropic.Message;
const scripted = (inputs: unknown[]): MessagesCreate => async () => msg(inputs.shift());

test('final attempt: failing tags are removed and logged, then a failing visual becomes its fallback; the words never change', async () => {
  const brief = briefSuperIntelligenceForce();
  const bad = sifDraftHandoff();
  bad.slides[1]!.subject_ids = ['S2', 'S1']; // Trump isn't named on the Clayton slide
  delete bad.slides[4]!.subject_ids;
  bad.slides[5]!.visual = vPerson('Jay Clayton');
  bad.slides[5]!.subject_ids = ['S2']; // Clayton isn't named on "Why the name"
  const r = await runWriter(brief, { create: scripted([bad, structuredClone(bad)]), isWellKnown: async () => false });
  assert.ok(r.ok);
  assert.deepEqual(r.draft.slides[1]!.subject_ids, ['S2']);
  assert.deepEqual(r.draft.slides[4]!.subject_ids, []);
  assert.deepEqual(r.draft.slides[5]!.subject_ids, []);
  assert.deepEqual(r.draft.slides[5]!.visual, bad.slides[5]!.fallback_visual, 'the request lost its tag, so its fallback takes over');
  assert.deepEqual(r.draft.slides[1]!.visual, vPerson('Jay Clayton'), 'a request whose tag survives is kept');
  assert.deepEqual(r.draft.slides.map((s) => s.headline.text), bad.slides.map((s) => s.headline.text), 'words unchanged');
  for (const line of ['subject-tag-dropped: slide 3 S1 (Donald Trump) (not named on the slide)', 'subject-tag-dropped: slide 6 had no subject_ids → []', 'subject-tag-dropped: slide 7 S2 (Jay Clayton) (not named on the slide)']) {
    assert.ok(r.visualsDropped.includes(line), `${line} | ${r.visualsDropped.join(' | ')}`);
  }
  assert.ok(r.visualsDropped.some((l) => /^visual-dropped: slide 7 person: Jay Clayton → its fallback/.test(l)), r.visualsDropped.join(' | '));
});

test("words stay when a tag fails: adding a name to the slide to fit its tag fails the retry", async () => {
  const brief = briefSuperIntelligenceForce();
  const bad = sifDraftHandoff();
  bad.slides[4]!.subject_ids = ['S2'];
  const rewritten = structuredClone(bad);
  rewritten.slides[4]!.body!.text = 'Clayton says the charter will plan responses to SI-enabled threats while preventing overregulation.';
  const r = await runWriter(brief, { create: scripted([bad, rewritten]), isWellKnown: async () => false });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.detail, /slide 6: the words changed after its visual request failed; restore them/);
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

// ── Icons (photo spec §5; Tommy, 2026-10-07: the Writer picks) ─────────

import { DEFAULT_ICON, ICON_LIST_FOR_WRITER, ICON_NAMES } from '@/lib/social/render/icons';
import { defaultIcons } from '@/lib/social/writer/writer';

test('icons: the VISUAL rule lists every icon; the cover and every slide must name one from the list', () => {
  assert.ok(VISUAL_RULE.includes(ICON_LIST_FOR_WRITER));
  assert.equal(ICON_NAMES.length, 30);
  const brief = briefSuperIntelligenceForce();
  const d = sifDraftHandoff();
  delete d.cover_options[0]!.icon;
  d.slides[0]!.icon = 'unicorn';
  const e = errs(d, brief, null);
  assert.match(at(e, 'cover'), /cover\.icon: name an icon for this slide, from the icon list/);
  assert.match(at(e, 'slide 2'), /slide 2\.icon: icon "unicorn" isn't on the icon list; pick one from the list/);
  const { draft, dropped } = defaultIcons(d);
  assert.equal(draft.cover_options[0]!.icon, DEFAULT_ICON);
  assert.equal(draft.slides[0]!.icon, DEFAULT_ICON);
  assert.deepEqual(dropped, ['icon-defaulted: cover (none) → newspaper', 'icon-defaulted: slide 2 "unicorn" → newspaper']);
  assert.equal(draft.slides[1]!.icon, 'user', 'valid icons stay');
});
