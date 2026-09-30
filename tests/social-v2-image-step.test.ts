import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  classifyLicense,
  stripHtml,
  toCandidate,
  buildCredit,
  type RawImageInfo,
} from '@/lib/social/editorial/v2/image-step/commons';
import {
  normalizeSubject,
  scoreCandidate,
} from '@/lib/social/editorial/v2/image-step/wikidata';
import {
  parseImageSubject,
  runImageStep,
  buildAttributionBlock,
  buildFactCheckerImagesBlock,
  buildPhotoRequests,
  type SelectedImage,
  type SlideKey,
} from '@/lib/social/editorial/v2/image-step';
import type { Brief, ParsedPost } from '@/lib/social/editorial/v2/parse';

/* ─ commons.ts ────────────────────────────────────────────────────── */

describe('classifyLicense — allow-list + preference tiers', () => {
  test('CC0 → PD/CC0 tier', () => {
    assert.equal(classifyLicense('CC0 1.0'), 'PD/CC0');
    assert.equal(classifyLicense('cc0'), 'PD/CC0');
  });
  test('Public domain → PD/CC0 tier', () => {
    assert.equal(classifyLicense('Public domain'), 'PD/CC0');
    assert.equal(classifyLicense('PD'), 'PD/CC0');
  });
  test('CC BY 4.0 → CC BY tier', () => {
    assert.equal(classifyLicense('CC BY 4.0'), 'CC BY');
    assert.equal(classifyLicense('CC-BY-2.0'), 'CC BY');
  });
  test('CC BY-SA → CC BY-SA tier (last resort)', () => {
    assert.equal(classifyLicense('CC BY-SA 4.0'), 'CC BY-SA');
    assert.equal(classifyLicense('CC-BY-SA-3.0'), 'CC BY-SA');
  });
  test('CC BY-NC → rejected', () => {
    assert.equal(classifyLicense('CC BY-NC 4.0'), null);
  });
  test('CC BY-ND → rejected', () => {
    assert.equal(classifyLicense('CC BY-ND 4.0'), null);
  });
  test('CC BY-NC-SA → rejected', () => {
    assert.equal(classifyLicense('CC BY-NC-SA 4.0'), null);
  });
  test('Fair use → rejected', () => {
    assert.equal(classifyLicense('Fair use'), null);
  });
  test('empty / unknown → rejected', () => {
    assert.equal(classifyLicense(''), null);
    assert.equal(classifyLicense('Some random string'), null);
  });
});

describe('stripHtml — Commons Artist field cleanup', () => {
  test('anchor tags stripped', () => {
    assert.equal(stripHtml('<a href="/wiki/User:Foo">John Doe</a>'), 'John Doe');
  });
  test('nested spans stripped', () => {
    assert.equal(stripHtml('<span class="fn value"><a href="x">Jane Photographer</a></span>'), 'Jane Photographer');
  });
  test('html entities decoded', () => {
    assert.equal(stripHtml('J&amp;D Photo &nbsp;Studio'), 'J&D Photo Studio');
  });
  test('whitespace collapsed', () => {
    assert.equal(stripHtml('  Long   author\n\nname  '), 'Long author name');
  });
});

describe('toCandidate — filters', () => {
  const raw = (overrides: Partial<RawImageInfo>): RawImageInfo => ({
    url: 'https://upload.wikimedia.org/foo.jpg',
    width: 2000, height: 3000, mime: 'image/jpeg',
    extmetadata: {
      LicenseShortName: { value: 'CC BY 4.0' },
      Artist: { value: '<a href="/x">John Doe</a>' },
      LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0' },
    },
    ...overrides,
  });

  test('happy path: CC BY, big enough, JPG, has author → passes', () => {
    const c = toCandidate('File:X.jpg', raw({}), 'P18');
    assert.ok(c);
    assert.equal(c!.tier, 'CC BY');
    assert.equal(c!.author, 'John Doe');
    assert.equal(c!.license, 'CC BY 4.0');
  });
  test('SVG / GIF → rejected (MIME filter)', () => {
    assert.equal(toCandidate('File:X.svg', raw({ mime: 'image/svg+xml' }), 'P18'), null);
    assert.equal(toCandidate('File:X.gif', raw({ mime: 'image/gif' }), 'P18'), null);
  });
  test('short side < 1080 → rejected', () => {
    assert.equal(toCandidate('File:X.jpg', raw({ width: 800, height: 1200 }), 'P18'), null);
  });
  test('short side < 600 (round-speaker minimum) with minShortSide=600 → passes', () => {
    const c = toCandidate('File:X.jpg', raw({ width: 700, height: 900 }), 'P180', { minShortSide: 600 });
    assert.ok(c);
  });
  test('unknown/blocked license → rejected', () => {
    const badLicense = raw({ extmetadata: { ...raw({}).extmetadata, LicenseShortName: { value: 'CC BY-NC 4.0' } } });
    assert.equal(toCandidate('File:X.jpg', badLicense, 'P18'), null);
  });
  test('empty author → rejected (spec: no author, no ship)', () => {
    const noAuthor = raw({ extmetadata: { ...raw({}).extmetadata, Artist: { value: '' } } });
    assert.equal(toCandidate('File:X.jpg', noAuthor, 'P18'), null);
  });
});

describe('buildCredit — per-image credit fragment', () => {
  test('CC BY-SA → "<Author>, <License>"', () => {
    assert.equal(
      buildCredit({ author: 'Andre m', license: 'CC BY-SA 3.0', tier: 'CC BY-SA' }),
      'Andre m, CC BY-SA 3.0',
    );
  });
  test('CC BY → "<Author>, <License>"', () => {
    assert.equal(
      buildCredit({ author: 'Jane Doe', license: 'CC BY 4.0', tier: 'CC BY' }),
      'Jane Doe, CC BY 4.0',
    );
  });
  test('Public domain → "<Author> (public domain)" lowercase', () => {
    assert.equal(
      buildCredit({
        author: 'Office of the Lieutenant Governor of California',
        license: 'Public domain',
        tier: 'PD/CC0',
      }),
      'Office of the Lieutenant Governor of California (public domain)',
    );
  });
  test('CC0 → "<Author> (CC0 1.0)" — parens for PD tier, but CC0 keeps its caps', () => {
    assert.equal(
      buildCredit({ author: 'Foo', license: 'CC0 1.0', tier: 'PD/CC0' }),
      'Foo (CC0 1.0)',
    );
  });
});

/* ─ wikidata.ts ───────────────────────────────────────────────────── */

describe('normalizeSubject — strips "photo of " and punctuation', () => {
  test('strips "photo of "', () => {
    assert.equal(normalizeSubject('photo of Gavin Newsom'), 'Gavin Newsom');
    assert.equal(normalizeSubject('  Photo of  California State Capitol  '), 'California State Capitol');
  });
  test('leaves bare subjects', () => {
    assert.equal(normalizeSubject('Gavin Newsom'), 'Gavin Newsom');
  });
  test('strips trailing period', () => {
    assert.equal(normalizeSubject('photo of Gavin Newsom.'), 'Gavin Newsom');
  });
});

describe('scoreCandidate — ranks by description overlap with brief', () => {
  const ctx = {
    subject: 'Gavin Newsom',
    briefTerms: [{ name: 'Gavin Newsom', description: 'Governor of California and state executive' }],
    briefStory: 'California governor Gavin Newsom signed an executive order on AI.',
  };
  test('right entity (Governor of California) scores higher than a same-name unrelated entity', () => {
    const rightEntity = { id: 'Q19837', label: 'Gavin Newsom', description: 'Governor of California since 2019', aliases: [] };
    const wrongEntity = { id: 'Q999999', label: 'Gavin Newsom', description: 'American filmmaker, unrelated', aliases: [] };
    const rightScore = scoreCandidate(rightEntity, ctx);
    const wrongScore = scoreCandidate(wrongEntity, ctx);
    assert.ok(rightScore > wrongScore, `right ${rightScore} vs wrong ${wrongScore}`);
  });
});

/* ─ image-step orchestrator: subject parsing, dedup, quote-speaker rule ─ */

describe('parseImageSubject', () => {
  test('parses "photo of <subject>"', () => {
    assert.equal(parseImageSubject('photo of Gavin Newsom'), 'Gavin Newsom');
    assert.equal(parseImageSubject('Photo of California State Capitol.'), 'California State Capitol');
  });
  test('"type only" returns null', () => {
    assert.equal(parseImageSubject('type only'), null);
    assert.equal(parseImageSubject('type only.'), null);
  });
  test('empty / undefined returns null', () => {
    assert.equal(parseImageSubject(''), null);
    assert.equal(parseImageSubject(undefined), null);
  });
  test('non-"photo of" prose returns null (scenes / events never pass)', () => {
    assert.equal(parseImageSubject('the agent escaping'), null);
  });
});

/**
 * Build a minimal ParsedPost + Brief for runImageStep tests. All slides
 * are text (headline+body) so classifySlideType returns 'text' and the
 * rhythm check doesn't fire.
 */
function fixture(over: {
  coverImage?: string;
  slides: Array<Partial<{
    position: number;
    headline: string;
    body: string;
    image: string;
    quote: string;
    quoteBy: string;
  }>>;
  terms?: Array<{ name: string; description: string }>;
}): { post: ParsedPost; brief: Brief } {
  const post: ParsedPost = {
    cover: { kind: 'edited', text: 'Cover text.', highlight: 'text', image: over.coverImage ?? 'type only' },
    slides: over.slides.map((s, i) => ({
      position: s.position ?? (i + 2),
      headline: s.headline, body: s.body, image: s.image ?? 'type only',
      quote: s.quote, quoteBy: s.quoteBy,
    })),
    follow: 'Follow Helios.',
    editNotes: null,
  };
  const brief: Brief = {
    singleStory: { yes: true, sourceNote: '' },
    news: '', story: '',
    terms: over.terms ?? [],
    images: [], sources: [],
  };
  return { post, brief };
}

describe('runImageStep — quote-speaker match rule', () => {
  test('quote slide with QUOTE BY "OpenAI, ..." rejects a Sam Altman photo', async () => {
    const { post, brief } = fixture({
      slides: [{
        position: 2,
        quote: 'We paused training.',
        quoteBy: 'OpenAI, Misalignment report',
        image: 'photo of Sam Altman',
      }],
      terms: [{ name: 'Sam Altman', description: 'OpenAI CEO' }],
    });
    let resolveCalled = false;
    const result = await runImageStep(post, brief, {
      resolveSubject: async () => { resolveCalled = true; return { ok: true, candidate: { id: 'Q42', label: 'Sam Altman', description: 'CEO', aliases: [] }, score: 5, runnerUpScore: 0 }; },
      findCandidates: async () => [],
      visionKindCheck: async () => ({ verdict: { isPhoto: true, clean: true, onePersonVisible: true, faceClear: true }, passed: true, reason: '', usage: { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalInputTokens: 0 } }),
      downloadBytes: async () => Buffer.from(''),
      downloadAndStore: async () => ({ storagePath: '', storageUrl: '', bytes: 0 }),
      getCachedImage: async () => null,
      putCachedImage: async () => {},
    });
    assert.equal(result.selected.size, 0, 'no photo selected');
    assert.equal(resolveCalled, false, 'resolve never called — rule short-circuits');
    assert.equal(result.report[0]!.status, 'type-only');
    assert.match(result.report[0]!.reason, /QUOTE BY.*does not name/);
  });

  test('quote slide with QUOTE BY naming the same person accepts the photo', async () => {
    const { post, brief } = fixture({
      slides: [{
        position: 2,
        quote: 'AI is here.',
        quoteBy: 'Sam Altman, OpenAI',
        image: 'photo of Sam Altman',
      }],
      terms: [{ name: 'Sam Altman', description: 'OpenAI CEO' }],
    });
    const result = await runImageStep(post, brief, {
      resolveSubject: async () => ({ ok: true, candidate: { id: 'Q42', label: 'Sam Altman', description: 'CEO', aliases: [] }, score: 5, runnerUpScore: 0 }),
      findCandidates: async () => [{
        file: 'File:Sam.jpg', url: 'https://x', width: 2000, height: 3000, mime: 'image/jpeg',
        author: 'Photographer', license: 'CC BY 4.0', licenseUrl: null,
        tier: 'CC BY', source: 'P18',
      }],
      visionKindCheck: async () => ({ verdict: { isPhoto: true, clean: true, onePersonVisible: true, faceClear: true }, passed: true, reason: '', usage: { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalInputTokens: 0 } }),
      downloadBytes: async () => Buffer.from(''),
      downloadAndStore: async () => ({ storagePath: 'wikidata/Q42/aaaa.jpg', storageUrl: 'https://helios/Q42', bytes: 100 }),
      getCachedImage: async () => null,
      putCachedImage: async () => {},
    });
    assert.equal(result.selected.size, 1);
    assert.equal(result.selected.get(2)!.wikidataId, 'Q42');
  });
});

describe('runImageStep — Wikidata ambiguity → type-only', () => {
  test('ambiguous entity resolution means no photo (per spec)', async () => {
    const { post, brief } = fixture({
      slides: [{ position: 2, headline: 'H', body: 'B', image: 'photo of Sam Altman' }],
      terms: [{ name: 'Sam Altman', description: 'OpenAI CEO' }],
    });
    const result = await runImageStep(post, brief, {
      resolveSubject: async () => ({ ok: false, reason: 'ambiguous: two Q-ids scored the same' }),
      findCandidates: async () => { throw new Error('should not reach findCandidates'); },
      visionKindCheck: async () => { throw new Error('should not reach vision'); },
      downloadBytes: async () => Buffer.from(''),
      downloadAndStore: async () => ({ storagePath: '', storageUrl: '', bytes: 0 }),
      getCachedImage: async () => null,
      putCachedImage: async () => {},
    });
    assert.equal(result.selected.size, 0);
    assert.equal(result.report[0]!.status, 'type-only');
    assert.match(result.report[0]!.reason, /ambiguous/);
  });
});

describe('runImageStep — one image per post (dedup by Q-id)', () => {
  test('the same Wikidata Q-id used twice → second slide falls back to type-only', async () => {
    // Slide 3 is a landing slide (HEADLINE only) so slide 2 and slide 4 are
    // both photo-capable and non-consecutive per buildPhotoRequests's
    // "never two in a row" rule. Both requests reach the resolver; the second
    // gets dedup'd by Wikidata Q-id.
    // Both Writer IMAGE subjects are TERMS people (post-2026-09-29 late
    // second-pass rule: story-slide photo subjects must be TERMS persons).
    // The two names resolve to the same Wikidata Q42 via the stub
    // resolver — that's the dedup we're testing.
    const { post, brief } = fixture({
      slides: [
        { position: 2, headline: 'H1', body: 'B1 Sam Altman', image: 'photo of Sam Altman' },
        { position: 3, headline: 'Landing line only' },
        { position: 4, headline: 'H2', body: 'B2 Samuel H. Altman', image: 'photo of Samuel H. Altman' },
      ],
      terms: [
        { name: 'Sam Altman', description: 'OpenAI CEO' },
        { name: 'Samuel H. Altman', description: 'OpenAI CEO (alt spelling)' },
      ],
    });
    let cacheGetCalls = 0;
    const result = await runImageStep(post, brief, {
      resolveSubject: async () => ({ ok: true, candidate: { id: 'Q42', label: 'Sam Altman', description: 'CEO', aliases: [] }, score: 5, runnerUpScore: 0 }),
      findCandidates: async () => [{
        file: 'File:Sam.jpg', url: 'https://x', width: 2000, height: 3000, mime: 'image/jpeg',
        author: 'Photographer', license: 'CC BY 4.0', licenseUrl: null,
        tier: 'CC BY', source: 'P18',
      }],
      visionKindCheck: async () => ({ verdict: { isPhoto: true, clean: true, onePersonVisible: true, faceClear: true }, passed: true, reason: '', usage: { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalInputTokens: 0 } }),
      downloadBytes: async () => Buffer.from(''),
      downloadAndStore: async () => ({ storagePath: 'wikidata/Q42/aaaa.jpg', storageUrl: 'https://helios/Q42', bytes: 100 }),
      getCachedImage: async () => { cacheGetCalls++; return null; },
      putCachedImage: async () => {},
    });
    assert.equal(result.selected.size, 1);
    assert.equal(result.selected.get(2)!.wikidataId, 'Q42');
    assert.equal(result.selected.has(3), false);
    assert.equal(result.report[1]!.status, 'type-only');
    assert.match(result.report[1]!.reason, /duplicate: Q42/);
    assert.equal(cacheGetCalls, 1, 'cache is consulted once — second call short-circuits before lookup');
  });
});

describe('runImageStep — cache hit skips search + vision', () => {
  test('cache hit uses stored URL + credit; no vision call', async () => {
    const { post, brief } = fixture({
      slides: [{ position: 2, headline: 'H', body: 'B', image: 'photo of Gavin Newsom' }],
      terms: [{ name: 'Gavin Newsom', description: 'Governor of California' }],
    });
    let visionCalls = 0;
    const result = await runImageStep(post, brief, {
      resolveSubject: async () => ({ ok: true, candidate: { id: 'Q19837', label: 'Gavin Newsom', description: 'Governor', aliases: [] }, score: 5, runnerUpScore: 0 }),
      findCandidates: async () => { throw new Error('cache hit should skip this'); },
      visionKindCheck: async () => { visionCalls++; throw new Error('cache hit should skip vision'); },
      downloadBytes: async () => Buffer.from(''),
      downloadAndStore: async () => ({ storagePath: '', storageUrl: '', bytes: 0 }),
      getCachedImage: async () => ({
        wikidataId: 'Q19837', subject: 'Gavin Newsom',
        commonsFile: 'File:Gavin_Newsom.jpg',
        storagePath: 'wikidata/Q19837/cached.jpg',
        storageUrl: 'https://cached/x.jpg',
        license: 'CC BY-SA 2.0', licenseUrl: null,
        author: 'Gage Skidmore',
        credit: 'Photo: Gage Skidmore / Wikimedia Commons, CC BY-SA 2.0.',
        width: 2000, height: 3000, isPortrait: true,
        chosenAt: new Date(),
      }),
      putCachedImage: async () => {},
    });
    assert.equal(visionCalls, 0);
    const sel = result.selected.get(2)!;
    assert.equal(sel.wikidataId, 'Q19837');
    assert.equal(sel.source, 'cache');
    assert.match(sel.credit, /Photo: Gage Skidmore/);
  });
});

describe('buildAttributionBlock + buildFactCheckerImagesBlock', () => {
  const selected = new Map<SlideKey, SelectedImage>([
    ['cover', {
      wikidataId: 'Q461391', subject: 'Gavin Newsom', label: 'Gavin Newsom',
      commonsFile: 'File:Gavin_Newsom_official_photo.jpg', storageUrl: 'https://x',
      license: 'Public domain', licenseUrl: null,
      author: 'Office of the Lieutenant Governor of California',
      credit: 'Office of the Lieutenant Governor of California (public domain)',
      isPortrait: true, source: 'wikimedia',
    }],
    [3, {
      wikidataId: 'Q1026860', subject: 'California State Capitol', label: 'California State Capitol',
      commonsFile: 'File:California_State_Capitol.jpg', storageUrl: 'https://y',
      license: 'CC BY-SA 3.0', licenseUrl: null, author: 'Andre m',
      credit: 'Andre m, CC BY-SA 3.0',
      isPortrait: false, source: 'wikimedia',
    }],
  ]);
  test('attribution block matches the exact spec format', () => {
    // Per user spec: "Photos: Office of the Lieutenant Governor of California
    // (public domain); Andre m, CC BY-SA 3.0. Via Wikimedia Commons."
    assert.equal(
      buildAttributionBlock(selected),
      'Photos: Office of the Lieutenant Governor of California (public domain); Andre m, CC BY-SA 3.0. Via Wikimedia Commons.',
    );
  });
  test('attribution block dedups repeat credits', () => {
    const same = new Map<SlideKey, SelectedImage>([
      ['cover', { ...selected.get('cover')! }],
      [3, { ...selected.get('cover')!, wikidataId: 'Q461391b' }],
    ]);
    const line = buildAttributionBlock(same);
    // Only one credit before the "; " (which isn't present because dedup=1).
    assert.equal(
      line,
      'Photos: Office of the Lieutenant Governor of California (public domain). Via Wikimedia Commons.',
    );
  });
  test('fact-checker block lists subject + Wikidata id + Commons file + license per slide', () => {
    const block = buildFactCheckerImagesBlock(selected);
    assert.match(block, /^IMAGES CHOSEN:/);
    assert.match(block, /- COVER: photo of Gavin Newsom \(Wikidata Q461391\) — File:Gavin_Newsom_official_photo\.jpg — Public domain/);
    assert.match(block, /- SLIDE 3: photo of California State Capitol \(Wikidata Q1026860\) — File:California_State_Capitol\.jpg — CC BY-SA 3\.0/);
  });
  test('empty map → "(none — every slide is type-only)"', () => {
    assert.match(buildFactCheckerImagesBlock(new Map()), /none — every slide is type-only/);
  });
});

/* ─ buildPhotoRequests (code-built requests) ─────────────────────────── */

describe('buildPhotoRequests — cover from THE NEWS + up to 3 story slides', () => {
  test('cover falls back to a person named in THE NEWS when Writer said type only', () => {
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [],
      terms: [{ name: 'Gavin Newsom', description: 'Governor of California' }],
    });
    brief.news = 'Governor Gavin Newsom signed an executive order on Friday.';
    const reqs = buildPhotoRequests(post, brief);
    assert.equal(reqs[0]!.slide, 'cover');
    assert.equal(reqs[0]!.subject, 'Gavin Newsom');
  });

  test('cover stays type-only when only an ORG is in THE NEWS first sentence (2026-09-29 late)', () => {
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [],
      terms: [{ name: 'Google Labs', description: 'Google\'s internal team for early-stage, experimental products.' }],
    });
    brief.news = 'Google Labs updated its experimental AI agent CC.';
    const reqs = buildPhotoRequests(post, brief);
    const cover = reqs.find((r) => r.slide === 'cover');
    assert.equal(cover, undefined);
  });

  test('cover prefers a named PERSON over an ORG even when the org appears first (2026-09-29 late: no logos on covers)', () => {
    // Writer's IMAGE line names Sundar Pichai; THE NEWS first sentence
    // names Google Labs before Sundar Pichai. Prior code picked whoever
    // came first (Google Labs) → cover would render a logo / lobby.
    // Post-2026-09-29-late rule: person beats org regardless of position.
    // Sundar Pichai is the face; Google Labs would have to yield.
    const { post, brief } = fixture({
      coverImage: 'photo of Sundar Pichai',
      slides: [],
      terms: [
        { name: 'Sundar Pichai', description: 'CEO of Google' },
        { name: 'Google Labs', description: 'Google team' },
      ],
    });
    brief.news = 'Google Labs launched a thing led by Sundar Pichai.';
    const reqs = buildPhotoRequests(post, brief);
    assert.equal(reqs[0]!.subject, 'Sundar Pichai');
  });

  test('cover stays type-only when only an ORG (no person) is named in the first sentence (2026-09-29 late)', () => {
    // Tommy's stricter rule: no logos, no HQ photos on the cover. If no
    // person is the face of THE NEWS, cover is type-only. An org like
    // "Google Labs" would resolve to a logo or lobby photo on Wikidata,
    // both of which are visually bland and often off-topic.
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [],
      terms: [
        { name: 'Sundar Pichai', description: 'CEO of Google' },
        { name: 'Google Labs', description: 'Google team' },
      ],
    });
    brief.news = 'Google Labs launched a new experimental agent this week.';
    const reqs = buildPhotoRequests(post, brief);
    const cover = reqs.find((r) => r.slide === 'cover');
    assert.equal(cover, undefined);
  });

  test('story photos: PEOPLE ONLY, never two in a row + max 3 + skip landing (2026-09-29 late second pass)', () => {
    // Story slides get person photos only — no orgs, no bills, no products.
    // Prior version passed any TERMS name and requested Wikidata pictures
    // for "China FIREWALL Act" (a bill). Restricted to TERMS persons.
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [
        { position: 2, headline: 'Newsom signed it', body: 'Governor Gavin Newsom signed the order.' },
        { position: 3, headline: 'The bill matters', body: 'The California legislature debated for months.' },
        { position: 4, headline: 'What the CPPA says' }, // landing — skipped
        { position: 5, headline: 'Sam Altman weighs in', body: 'Sam Altman said the tech industry needs clear rules.' },
        { position: 6, headline: 'Dario Amodei response', body: 'Dario Amodei said Anthropic would comply.' },
      ],
      terms: [
        { name: 'Gavin Newsom', description: 'Governor of California' },
        { name: 'California legislature', description: 'The state government body' },
        { name: 'Sam Altman', description: 'CEO of OpenAI' },
        { name: 'Dario Amodei', description: 'CEO of Anthropic' },
        { name: 'OpenAI', description: 'AI company' },
        { name: 'Anthropic', description: 'AI company' },
      ],
    });
    brief.news = 'Gavin Newsom signed an AI executive order.';
    const reqs = buildPhotoRequests(post, brief);
    // Cover: Gavin Newsom. Story: slide 2 skipped (subject already on cover),
    // slide 3's "California legislature" is an org → skipped, slide 4 is a
    // landing → skipped, slide 5 = Sam Altman (person) → picked, slide 6
    // is consecutive → skipped. Result: cover + 1 story.
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0]!.slide, 'cover');
    assert.equal(reqs[0]!.subject, 'Gavin Newsom');
    assert.equal(reqs[1]!.slide, 5);
    assert.equal(reqs[1]!.subject, 'Sam Altman');
  });

  test('story photos: bill named in a slide is NOT requested (Gottheimer regression)', () => {
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [
        { position: 2, headline: 'The China FIREWALL Act', body: 'A new bill would ban Chinese-developed AI models.' },
      ],
      terms: [
        { name: 'Josh Gottheimer', description: 'U.S. Congressman' },
        { name: 'China FIREWALL Act', description: 'Proposed legislation' },
      ],
    });
    brief.news = 'Josh Gottheimer introduced the China FIREWALL Act.';
    const reqs = buildPhotoRequests(post, brief);
    // Cover picks Gottheimer (person). Slide 2 mentions the bill only — no
    // TERMS person on the slide, so no story-slide photo request. The old
    // code would have requested a Wikidata entity for "China FIREWALL Act".
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0]!.slide, 'cover');
    assert.equal(reqs[0]!.subject, 'Josh Gottheimer');
  });

  test('all-orgs first sentence → cover type-only (no logos, no HQ) (2026-09-29 late)', () => {
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [],
      terms: [
        { name: 'Google', description: 'company' },
        { name: 'Google Labs', description: 'team' },
      ],
    });
    brief.news = 'Google Labs announced an update.';
    const reqs = buildPhotoRequests(post, brief);
    assert.equal(reqs.find((r) => r.slide === 'cover'), undefined);
  });

  test('all-orgs first sentence, even with two orgs, → cover type-only', () => {
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [],
      terms: [
        { name: 'Anthropic', description: 'AI company' },
        { name: 'California legislature', description: 'The state government body' },
      ],
    });
    brief.news = 'Anthropic sued the California legislature over SB-2026.';
    const reqs = buildPhotoRequests(post, brief);
    assert.equal(reqs.find((r) => r.slide === 'cover'), undefined);
  });

  test('cover scans ALL of THE NEWS for a person (updated 2026-09-29 late second pass)', () => {
    // Prior version limited scan to the first sentence, which broke on
    // abbreviations like "U.S. Rep. Josh Gottheimer" — the "U.S." period
    // truncated the "first sentence" and the person fell outside. Fix:
    // scan all of THE NEWS. THE NEWS is a one-line summary, so no risk
    // of picking a person from a stray later paragraph.
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [],
      terms: [
        { name: 'Anthropic', description: 'AI company' },
        { name: 'Gavin Newsom', description: 'Governor of California' },
      ],
    });
    brief.news = 'Anthropic released a new model. Gavin Newsom mentioned it in passing.';
    const reqs = buildPhotoRequests(post, brief);
    // Newsom (person) wins over Anthropic (org). Person-preferred rule holds.
    assert.equal(reqs[0]!.slide, 'cover');
    assert.equal(reqs[0]!.subject, 'Gavin Newsom');
  });

  test('cover: abbreviations in THE NEWS ("U.S. Rep. …") do not hide the person (Gottheimer regression)', () => {
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [],
      terms: [
        { name: 'Josh Gottheimer', description: 'U.S. Congressman from New Jersey' },
      ],
    });
    brief.news = 'On Friday, September 18, 2026, U.S. Rep. Josh Gottheimer (D-NJ-5) introduced two bipartisan AI security bills.';
    const reqs = buildPhotoRequests(post, brief);
    assert.equal(reqs[0]!.slide, 'cover');
    assert.equal(reqs[0]!.subject, 'Josh Gottheimer');
  });

  test('no valid cover subject in first sentence → NO cover photo request, no fallback', () => {
    // TERMS entities exist but none appear in the first sentence of
    // THE NEWS. Cover stays type-only; no fallback to a related entity.
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [],
      terms: [
        { name: 'Anthropic', description: 'AI company' },
        { name: 'Gavin Newsom', description: 'Governor of California' },
      ],
    });
    brief.news = 'A new AI executive order shipped on Friday.';
    const reqs = buildPhotoRequests(post, brief);
    assert.equal(reqs.filter((r) => r.slide === 'cover').length, 0);
  });

  test('cover falls back to first PROPER-NOUN NAME in THE NEWS even when TERMS omits the person', () => {
    // 2026-09-29 bug: Suleyman was named in THE NEWS but not listed as a
    // TERM entry, so pickCoverSubject returned null and the cover got no
    // photo request. Fix: fall back to the first proper-noun phrase in
    // the first sentence when no TERM matches.
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [],
      terms: [
        { name: 'Anthropic', description: 'AI company' },
        { name: 'Microsoft AI', description: 'the AI division' },
      ],
    });
    brief.news = 'Microsoft AI CEO Mustafa Suleyman published an essay arguing that Anthropic makes AI harder to control.';
    const reqs = buildPhotoRequests(post, brief);
    // 2026-09-29 late: orgs never make it onto the cover. Microsoft AI +
    // Anthropic are TERMS orgs, and Suleyman isn't listed as a TERM. No
    // photographable PERSON in the first sentence → cover stays type-only.
    const cover = reqs.find((r) => r.slide === 'cover');
    assert.equal(cover, undefined);
  });

  test('NO TERM matches in first sentence → cover has NO photo request (2026-09-29: no proper-noun fallback)', () => {
    // Old behavior fell back to the first Capitalized proper-noun phrase
    // even if it wasn't in TERMS. Post-2026-09-29-late that fallback is a
    // "related entity" risk — a wrong photo is worse than none. When the
    // Reporter didn't cross-list the main subject in TERMS, the cover
    // stays type-only.
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [],
      terms: [{ name: 'the Humanist AI Code', description: 'a document' }],
    });
    brief.news = 'Mustafa Suleyman published an essay about AI consciousness.';
    const reqs = buildPhotoRequests(post, brief);
    // Suleyman isn't in TERMS on this fixture → no cover photo.
    const cover = reqs.find((r) => r.slide === 'cover');
    assert.equal(cover, undefined);
  });

  test('no TERMS person or org named anywhere → cover has no photo request', () => {
    const { post, brief } = fixture({
      coverImage: 'type only',
      slides: [{ position: 2, headline: 'H', body: 'B' }],
      terms: [{ name: 'agentic AI', description: 'AI that takes actions.' }],
    });
    brief.news = 'A new kind of agentic AI shipped.';
    const reqs = buildPhotoRequests(post, brief);
    assert.equal(reqs.length, 0);
  });
});
