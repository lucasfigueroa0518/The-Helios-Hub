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
import { buildCredit, findCandidates, type CommonsCandidate } from './commons';
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

/**
 * Build the ordered request list from the parsed post. Cover first, then
 * each slide with a non-null subject. Capped at MAX_SUBJECTS_PER_POST.
 */
function collectRequests(post: ParsedPost): SubjectRequest[] {
  const out: SubjectRequest[] = [];
  const coverSubject = parseImageSubject(post.cover.image);
  if (coverSubject) out.push({ slide: 'cover', subject: coverSubject, imageLine: post.cover.image });
  for (const slide of post.slides) {
    const subject = parseImageSubject(slide.image);
    if (subject) out.push({ slide: slide.position, subject, imageLine: slide.image ?? '' });
  }
  return out.slice(0, MAX_SUBJECTS_PER_POST);
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

  const requests = collectRequests(post);

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
 * to the caption after "Source:". One credit per unique picked image.
 */
export function buildAttributionBlock(selected: Map<SlideKey, SelectedImage>): string | undefined {
  const credits = [...selected.values()].map((s) => s.credit);
  if (credits.length === 0) return undefined;
  const dedup = [...new Set(credits)];
  return `Photos: ${dedup.join('; ')}`;
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
