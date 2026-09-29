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
    const { post, brief } = fixture({
      slides: [
        { position: 2, headline: 'H1', body: 'B1', image: 'photo of Sam Altman' },
        { position: 3, headline: 'H2', body: 'B2', image: 'photo of Samuel H. Altman' },
      ],
      terms: [{ name: 'Sam Altman', description: 'OpenAI CEO' }],
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
