/**
 * The image step. Runs after the Editor + before the Caption in
 * lib/social/editorial/v2/orchestrate.ts.
 *
 * Inputs: parsed Post (COVER IMAGE + per-slide IMAGE lines) + Brief.
 * Output: a Map<'cover' | number, SelectedImage> of picked photos, plus
 * a per-request report the summary + Fact-checker + review UI use to
 * prove provenance.
 *
 * Per docs/IMAGES-V1-HANDOFF.md §Accuracy rules:
 *   - Resolve subject → Wikidata Q-id (ambiguous → no photo).
 *   - Only P18 / P180 files (no free-text Commons search).
 *   - Vision check confirms KIND, never identity.
 *   - Quote speaker only when QUOTE BY names that exact person.
 *   - Every ship carries subject / Q-id / Commons link / license in
 *     the run report.
 *
 * Caps: 5 subjects per post. Dedup by wikidata_id within one post.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { Brief, ParsedPost } from '../parse';
import { getCachedImage, putCachedImage } from './cache';
import { buildCredit, classifyLicense, findCandidates, type CommonsCandidate } from './commons';
import { downloadAndStore, downloadBytes } from './storage';
import { visionKindCheck, type VisionUsage } from './vision';
import { resolveSubject, type ResolveResult, type WikidataCandidate } from './wikidata';

const MAX_SUBJECTS_PER_POST = 5;

export type SlideKey = 'cover' | number;

export type SelectedImage = {
  wikidataId: string;
  subject: string;
  label: string;
  commonsFile: string;
  storageUrl: string;
  license: string;
  licenseUrl: string | null;
  author: string;
  credit: string;
  isPortrait: boolean;
  source: 'cache' | 'wikimedia';
};

export type ImageReportEntry = {
  slide: SlideKey;
  requestedSubject: string;
  status: 'picked' | 'type-only';
  reason: string;
  picked?: {
    wikidataId: string;
    label: string;
    commonsFile: string;
    commonsUrl: string;      // https://commons.wikimedia.org/wiki/File:...
    license: string;
    author: string;
    storageUrl: string;
    isPortrait: boolean;
    cacheHit: boolean;
  };
};

export type ImageStepResult = {
  selected: Map<SlideKey, SelectedImage>;
  report: ImageReportEntry[];
  visionCalls: number;
  visionUsage: VisionUsage[];
};

export type ImageStepDeps = {
  /** Injected for tests. Defaults call the real Wikidata / Commons APIs. */
  resolveSubject?: typeof resolveSubject;
  findCandidates?: typeof findCandidates;
  visionKindCheck?: typeof visionKindCheck;
  downloadBytes?: typeof downloadBytes;
  downloadAndStore?: typeof downloadAndStore;
  getCachedImage?: typeof getCachedImage;
  putCachedImage?: typeof putCachedImage;
  anthropicClient?: Anthropic;
};

/**
 * Return true when the subject string looks like a person (used to
 * enable the vision one-person + face-clear gates). Cheap heuristic:
 * a subject is a person iff the matching TERMS entry describes them
 * with a role keyword (CEO, governor, president, minister, senator,
 * director, founder, chair, secretary). Not perfect — Wikidata's
 * P31=Q5 (instance of human) would be authoritative — but it doesn't
 * need to be, because the vision check itself doesn't decide identity.
 */
function subjectIsPerson(subject: string, brief: Brief): boolean {
  const s = subject.toLowerCase();
  const term = brief.terms.find((t) => t.name.toLowerCase() === s);
  const desc = (term?.description ?? '').toLowerCase();
  return /\b(ceo|cto|cfo|coo|president|governor|senator|secretary|minister|director|founder|chair|chief|editor|reporter|prime minister|attorney|judge)\b/.test(desc);
}

/**
 * Parse a "photo of X" line to just X. Returns null for "type only" or
 * empty. Never trusts scene-style prompts ("photo of the escape") —
 * those pass through untouched and the Wikidata resolver will fail on
 * them (no matching entity → no photo, per spec).
 */
export function parseImageSubject(imageLine: string | undefined): string | null {
  if (!imageLine) return null;
  const s = imageLine.trim();
  if (!s) return null;
  if (/^type only\.?$/i.test(s)) return null;
  const match = s.match(/^photo of\s+(.+?)\.?$/i);
  return match ? match[1]!.trim() : null;
}

type SubjectRequest = { slide: SlideKey; subject: string; imageLine: string };

/** Story slides get at most this many code-added photos. Cover is separate. */
const MAX_CODE_STORY_PHOTOS = 3;

/**
 * Story slide kinds that CAN carry a photo per docs/DESIGN-V1-HANDOFF.md.
 * Landing (HEADLINE only) and Follow have no photo slot; skip them.
 * Detection is field-shape-based so it matches the adapter's own routing.
 */
function slideIsPhotoCapable(slide: ParsedPost['slides'][number]): boolean {
  const isLanding = !!slide.headline && !slide.body && !slide.bigNumber && !slide.quote;
  if (isLanding) return false;
  return !!(slide.body || slide.bigNumber || slide.quote || slide.image);
}

/**
 * A TERMS entry is an organization when its description contains one of
 * the organization keywords. Mirrors `isPersonTerm` from code-checks.ts.
 * "Google Labs: Google's internal team for early-stage, experimental
 * products." → org (has "team"). "OpenAI: an AI company." → org.
 */
function termIsOrganization(term: { description?: string }): boolean {
  const d = (term.description ?? '').toLowerCase();
  return /\b(company|firm|corporation|corp|inc\.|ltd|group|agency|bureau|department|government|labs|team|organization|foundation|institute|university|startup|nonprofit|coalition|association|council|committee|division|unit|studio|newsroom|publisher|magazine|regulator|regulatory)\b/.test(d);
}
function termIsPerson(term: { description?: string }): boolean {
  const d = (term.description ?? '').toLowerCase();
  return /\b(ceo|cto|cfo|coo|president|governor|senator|secretary|minister|director|founder|chair|chief|editor|reporter|prime minister|attorney|judge|mayor|congressman|congresswoman)\b/.test(d);
}

/**
 * Return the FIRST photo-eligible TERM (person or organization) named in
 * `text`, ordered by position of first appearance (not by name length).
 * Ties are broken by longer name (so "Google Labs" beats bare "Google"
 * when both start at the same index). Used for story-slide subject
 * scanning where any named entity is a valid photo target.
 */
function findPersonOrOrgInText(text: string, brief: Brief): string | null {
  if (!text) return null;
  const hay = text.toLowerCase();
  const eligibleTerms = brief.terms.filter((t) => termIsPerson(t) || termIsOrganization(t));
  const hits: Array<{ name: string; idx: number }> = [];
  for (const t of eligibleTerms) {
    const idx = hay.indexOf(t.name.toLowerCase());
    if (idx >= 0) hits.push({ name: t.name, idx });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => (a.idx - b.idx) || (b.name.length - a.name.length));
  return hits[0]!.name;
}

/**
 * Pick the COVER subject: the main subject of THE NEWS. Rules:
 *   - Only the FIRST sentence of THE NEWS is scanned (the news line's
 *     grammatical subject lives there — anything later is context).
 *   - First preference: a person/org in TERMS. First-appearance wins.
 *   - Fallback: the FIRST proper-noun phrase in the first sentence,
 *     even if Reporter forgot to list it in TERMS. Wikidata will decide
 *     whether that name resolves to a real entity — the cover shouldn't
 *     be silent just because the Reporter didn't cross-list every
 *     person named in THE NEWS.
 *   - No fallback to a related entity. If Wikidata can't resolve the
 *     picked name, the cover stays type-only.
 */
function pickCoverSubject(brief: Brief): string | null {
  const news = brief.news ?? '';
  if (!news) return null;
  const firstSentenceEnd = firstOf(news, ['. ', '.\n', '\n']);
  const firstSentence = firstSentenceEnd >= 0 ? news.slice(0, firstSentenceEnd) : news;
  // Preference 1: TERMS entry named in first sentence.
  const termHit = findPersonOrOrgInText(firstSentence, brief);
  if (termHit) return termHit;
  // Preference 2: first proper-noun phrase in the first sentence. A
  // proper-noun phrase is one or more consecutive Capitalized words of
  // length ≥ 3, allowing a middle initial ("Mustafa Suleyman", "Sam
  // Altman", "Mary R. Barra"). Skip sentence-start THE / MICROSOFT-AI
  // hyphenated tokens by requiring the phrase not be the first word.
  // Take the FIRST such phrase encountered by position.
  const properNounRe = /\b([A-Z][a-z][a-z']+(?:\s+(?:[A-Z]\.\s+)?[A-Z][a-z][a-z']+){0,3})\b/g;
  let m: RegExpExecArray | null;
  const hits: Array<{ name: string; idx: number }> = [];
  while ((m = properNounRe.exec(firstSentence)) !== null) {
    const name = m[1]!.trim();
    // Skip lone month names, weekdays, generic-role words.
    if (/^(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(name)) continue;
    // Skip standalone role words that shouldn't drive Wikidata resolution.
    if (/^(CEO|CTO|CFO|COO|President|Governor|Senator|Secretary|Minister|Director|Founder|Chair|Chief|Editor|Reporter|Mayor|Congressman|Congresswoman)$/i.test(name)) continue;
    hits.push({ name, idx: m.index });
  }
  hits.sort((a, b) => a.idx - b.idx);
  return hits[0]?.name ?? null;
}

function firstOf(haystack: string, needles: string[]): number {
  let best = -1;
  for (const n of needles) {
    const i = haystack.indexOf(n);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

/**
 * Code-built photo requests per docs/IMAGES-V1-HANDOFF.md and Tommy's rule
 * ("code builds the photo requests: the cover always requests the main
 * subject from THE NEWS ..., plus up to 3 story slides that name a person
 * or organization from TERMS, on photo-capable slide kinds, never two in
 * a row. Use the Writer's IMAGE subject first if it named one.").
 *
 * All existing accuracy rules still apply — the image step resolves each
 * subject through Wikidata + P18/P180 + vision KIND check as before.
 *
 * Exported for direct unit testing.
 */
export function buildPhotoRequests(post: ParsedPost, brief: Brief): SubjectRequest[] {
  const out: SubjectRequest[] = [];

  // ── Cover ────────────────────────────────────────────────────────────
  // The Writer's own IMAGE subject wins when it named one. Otherwise use
  // pickCoverSubject — the main subject of THE NEWS's first sentence only,
  // never a longest-TERMS-match fallback. If neither yields a subject or
  // the Wikidata resolver later fails, the cover stays type-only.
  const writerCover = parseImageSubject(post.cover.image);
  const coverSubject = writerCover ?? pickCoverSubject(brief);
  if (coverSubject) {
    out.push({ slide: 'cover', subject: coverSubject, imageLine: post.cover.image ?? '' });
  }

  // ── Story slides ─────────────────────────────────────────────────────
  // Iterate in order. For each photo-capable slide, take the Writer's
  // named subject when present, else scan the slide's own text for a
  // TERMS person/org. Never place a photo on two consecutive slides.
  let lastPlacedPosition = -2;
  let storyCount = 0;
  const usedSubjects = new Set<string>();
  if (coverSubject) usedSubjects.add(coverSubject.toLowerCase());

  for (const slide of post.slides) {
    if (storyCount >= MAX_CODE_STORY_PHOTOS) break;
    if (!slideIsPhotoCapable(slide)) continue;
    if (slide.position - lastPlacedPosition <= 1) continue; // never two in a row

    const writerSubject = parseImageSubject(slide.image);
    const slideText = [slide.headline, slide.body, slide.quote, slide.note].filter(Boolean).join(' ');
    const codeSubject = findPersonOrOrgInText(slideText, brief);
    const subject = writerSubject ?? codeSubject;
    if (!subject) continue;
    if (usedSubjects.has(subject.toLowerCase())) continue;

    out.push({ slide: slide.position, subject, imageLine: slide.image ?? '' });
    usedSubjects.add(subject.toLowerCase());
    lastPlacedPosition = slide.position;
    storyCount += 1;
  }

  return out.slice(0, MAX_SUBJECTS_PER_POST);
}

/** @deprecated Prefer buildPhotoRequests. Left here so older tests still compile. */
function collectRequests(post: ParsedPost, brief: Brief): SubjectRequest[] {
  return buildPhotoRequests(post, brief);
}

/**
 * Quote slides only get a speaker photo when the QUOTE BY line names
 * the exact same person as the IMAGE subject. Per spec: "A quote from
 * an organization ('OpenAI') never gets a person's photo."
 */
function quoteSpeakerMatch(slide: ParsedPost['slides'][number], subject: string): boolean {
  if (!slide.quote || !slide.quoteBy) return true; // not a quote slide → not this rule's concern
  const by = slide.quoteBy.toLowerCase();
  const s = subject.toLowerCase();
  return by.includes(s);
}

export async function runImageStep(
  post: ParsedPost,
  brief: Brief,
  deps: ImageStepDeps = {},
): Promise<ImageStepResult> {
  const selected = new Map<SlideKey, SelectedImage>();
  const report: ImageReportEntry[] = [];
  const visionUsage: VisionUsage[] = [];
  let visionCalls = 0;
  const chosenWikidataIds = new Set<string>();

  const resolve = deps.resolveSubject ?? resolveSubject;
  const find = deps.findCandidates ?? findCandidates;
  const check = deps.visionKindCheck ?? visionKindCheck;
  const dl = deps.downloadBytes ?? downloadBytes;
  const store = deps.downloadAndStore ?? downloadAndStore;
  const cacheGet = deps.getCachedImage ?? getCachedImage;
  const cachePut = deps.putCachedImage ?? putCachedImage;

  const requests = buildPhotoRequests(post, brief);

  for (const req of requests) {
    // Quote-speaker rule: reject before doing any work if it's a quote
    // slide whose QUOTE BY doesn't name this person.
    const parsedSlide = post.slides.find((s) => s.position === req.slide);
    if (parsedSlide?.quote && !quoteSpeakerMatch(parsedSlide, req.subject)) {
      report.push({
        slide: req.slide,
        requestedSubject: req.subject,
        status: 'type-only',
        reason: `quote slide: QUOTE BY ("${parsedSlide.quoteBy}") does not name "${req.subject}"`,
      });
      continue;
    }

    // 1. Resolve → Wikidata Q-id.
    const resolution: ResolveResult = await resolve({
      subject: req.subject,
      briefTerms: brief.terms,
      briefStory: brief.story,
    });
    if (!resolution.ok) {
      report.push({
        slide: req.slide,
        requestedSubject: req.subject,
        status: 'type-only',
        reason: `Wikidata: ${resolution.reason}`,
      });
      continue;
    }
    const qid = resolution.candidate.id;

    // Dedup by Q-id within this post.
    if (chosenWikidataIds.has(qid)) {
      report.push({
        slide: req.slide,
        requestedSubject: req.subject,
        status: 'type-only',
        reason: `duplicate: ${qid} already used on another slide in this post`,
      });
      continue;
    }

    // 2. Cache hit → skip the full search.
    const cached = await cacheGet(qid);
    if (cached) {
      selected.set(req.slide, cacheRowToSelected(cached, req.subject, 'cache'));
      chosenWikidataIds.add(qid);
      report.push({
        slide: req.slide,
        requestedSubject: req.subject,
        status: 'picked',
        reason: 'cache hit',
        picked: {
          wikidataId: qid,
          label: resolution.candidate.label,
          commonsFile: cached.commonsFile,
          commonsUrl: commonsFileUrl(cached.commonsFile),
          license: cached.license,
          author: cached.author,
          storageUrl: cached.storageUrl,
          isPortrait: cached.isPortrait,
          cacheHit: true,
        },
      });
      continue;
    }

    // 3. Cache miss → find Commons candidates via P18 / P180.
    const isPerson = subjectIsPerson(req.subject, brief);
    const minShort = 1080; // full-bleed default; round-speaker case picks the same file after crop
    const candidates = await find(qid, { minShortSide: minShort, limit: 5 });
    if (candidates.length === 0) {
      report.push({
        slide: req.slide,
        requestedSubject: req.subject,
        status: 'type-only',
        reason: `no Commons candidates via P18/P180 for ${qid} at ≥${minShort}px short side`,
      });
      continue;
    }

    // 4. Vision check each candidate in preference order until one passes.
    let winner: CommonsCandidate | null = null;
    let winnerReason = '';
    for (const cand of candidates) {
      const bytes = await dl(cand.url);
      const result = await check({
        imageBytes: bytes,
        mime: cand.mime === 'image/png' ? 'image/png' : 'image/jpeg',
        subjectIsPerson: isPerson,
        client: deps.anthropicClient,
      });
      visionCalls += 1;
      visionUsage.push(result.usage);
      if (result.passed) {
        winner = cand;
        winnerReason = `vision passed on ${cand.file}`;
        break;
      }
      winnerReason = `last rejection: ${result.reason}`;
    }
    if (!winner) {
      report.push({
        slide: req.slide,
        requestedSubject: req.subject,
        status: 'type-only',
        reason: `no candidate passed vision (${winnerReason})`,
      });
      continue;
    }

    // 5. Upload to Supabase Storage.
    const upload = await store({
      wikidataId: qid,
      sourceUrl: winner.url,
      mime: winner.mime === 'image/png' ? 'image/png' : 'image/jpeg',
    });

    const credit = buildCredit(winner);
    const isPortrait = isPerson; // people images = portraits for adapter purposes
    await cachePut({
      wikidataId: qid,
      subject: resolution.candidate.label,
      commonsFile: winner.file,
      storagePath: upload.storagePath,
      storageUrl: upload.storageUrl,
      license: winner.license,
      licenseUrl: winner.licenseUrl,
      author: winner.author,
      credit,
      width: winner.width,
      height: winner.height,
      isPortrait,
    });

    selected.set(req.slide, {
      wikidataId: qid,
      subject: req.subject,
      label: resolution.candidate.label,
      commonsFile: winner.file,
      storageUrl: upload.storageUrl,
      license: winner.license,
      licenseUrl: winner.licenseUrl,
      author: winner.author,
      credit,
      isPortrait,
      source: 'wikimedia',
    });
    chosenWikidataIds.add(qid);
    report.push({
      slide: req.slide,
      requestedSubject: req.subject,
      status: 'picked',
      reason: winnerReason,
      picked: {
        wikidataId: qid,
        label: resolution.candidate.label,
        commonsFile: winner.file,
        commonsUrl: commonsFileUrl(winner.file),
        license: winner.license,
        author: winner.author,
        storageUrl: upload.storageUrl,
        isPortrait,
        cacheHit: false,
      },
    });
  }

  return { selected, report, visionCalls, visionUsage };
}

/**
 * Compose the Post.attributionBlock string the publish pipeline appends
 * to the caption after "Source:". Format:
 *
 *   Photos: <credit1>; <credit2>. Via Wikimedia Commons.
 *
 * where each <credit> is the compact per-image form built by
 * commons.buildCredit ("<Author> (public domain)" or "<Author>, <License>").
 * One "Via Wikimedia Commons." at the end covers every listed photo.
 *
 * Credits are computed here from author + license on each SelectedImage,
 * NOT from the stored `credit` field. This keeps cached rows (which may
 * carry an older `credit` format) rendering to the current format
 * without a cache migration.
 */
export function buildAttributionBlock(selected: Map<SlideKey, SelectedImage>): string | undefined {
  const credits: string[] = [];
  for (const img of selected.values()) {
    const tier = classifyLicense(img.license) ?? 'CC BY-SA';
    credits.push(buildCredit({ author: img.author, license: img.license, tier }));
  }
  if (credits.length === 0) return undefined;
  const dedup = [...new Set(credits)];
  return `Photos: ${dedup.join('; ')}. Via Wikimedia Commons.`;
}

/**
 * Compose the "IMAGES CHOSEN:" block the Fact-checker sees so it can
 * flag a photo that doesn't fit its slide.
 */
export function buildFactCheckerImagesBlock(
  selected: Map<SlideKey, SelectedImage>,
): string {
  if (selected.size === 0) return 'IMAGES CHOSEN:\n(none — every slide is type-only)';
  const lines = ['IMAGES CHOSEN:'];
  for (const [key, img] of selected) {
    const where = key === 'cover' ? 'COVER' : `SLIDE ${key}`;
    lines.push(`- ${where}: photo of ${img.label} (Wikidata ${img.wikidataId}) — ${img.commonsFile} — ${img.license}`);
  }
  return lines.join('\n');
}

function cacheRowToSelected(
  row: Awaited<ReturnType<typeof getCachedImage>> & object,
  subject: string,
  source: 'cache' | 'wikimedia',
): SelectedImage {
  return {
    wikidataId: row.wikidataId,
    subject,
    label: row.subject,
    commonsFile: row.commonsFile,
    storageUrl: row.storageUrl,
    license: row.license,
    licenseUrl: row.licenseUrl,
    author: row.author,
    credit: row.credit,
    isPortrait: row.isPortrait,
    source,
  };
}

function commonsFileUrl(file: string): string {
  // "File:Foo bar.jpg" → https://commons.wikimedia.org/wiki/File:Foo_bar.jpg
  const name = file.replace(/^File:/, '').replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}`;
}

export type { WikidataCandidate };
