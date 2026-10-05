import type { BucketId } from '@/lib/reels/scoring/decide';

/**
 * The writer's tool, and the checks code runs on what comes back. Checks are
 * shown beside the copy for review. They do not reject or retry anything; the
 * word range also gates the copy pick (D-216, lib/reels/copy/pick.ts).
 */

/**
 * On-screen word counts from PRODUCT_SPEC.md. "Under 15" is at most 14. The
 * Saga is 20 to 32 on one 8-second still that loops, about 11 seconds of
 * reading at 3 words a second (D-214).
 */
export const ON_SCREEN_WORD_RANGE: Record<BucketId, { min: number; max: number }> = {
  ball_knowledge: { min: 8, max: 14 },
  the_number: { min: 1, max: 14 },
  the_saga: { min: 20, max: 32 },
  personal_profile: { min: 10, max: 18 },
  the_warning: { min: 15, max: 25 },
  the_callout: { min: 12, max: 22 },
};

/** Instagram's caption limit and the "more" fold. */
export const CAPTION_MAX_CHARS = 2_200;
export const CAPTION_FOLD_CHARS = 125;
export const HASHTAG_RANGE = { min: 3, max: 5 };
export const VIEWER_STAKE_MAX_WORDS = 20;

export const REPORT_COPY_TOOL = {
  name: 'report_copy',
  description:
    'Report two final on-screen copies and one caption for this post idea. Both copies are doors into that one caption. Call it once.',
  /**
   * Opus 5.5 rejects tool_choice type "tool". strict keeps the JSON valid
   * while the call uses tool_choice auto.
   */
  strict: true,
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      hook_drafts: {
        type: 'array',
        description: 'At least three alternate on-screen lines. A record of the lines, not the published pair.',
        items: { type: 'string' },
      },
      copy_draft: { type: 'string', description: 'The two on-screen lines before the final edit.' },
      caption_draft: { type: 'string', description: 'The caption before the final edit.' },
      remaining_patterns: {
        type: 'array',
        description: 'Humanizer patterns still present in the drafts, each as its number and a short quote. Empty when none.',
        items: { type: 'string' },
      },
      viewer_stake: {
        type: 'string',
        description:
          'One plain sentence, 20 words at most, saying why this viewer should care. Both on-screen copies carry it in their own words, and the caption\'s first paragraph pays it out.',
      },
      on_screen_copies: {
        type: 'array',
        description:
          'Exactly two final on-screen copies for the one screen. Same story about the same subject, same facts, same stake, paid out by the one caption. Each whole copy is a hook, and the two are different hooks, with a different first line and a different way in. A paraphrase is a failed report. Each copy has a line break already inserted at each natural pause. One line break between lines, and no blank line. A line break stays on this same screen. Count the words in each copy on its own. Each count must fall inside the bucket word range given in the prompt. A count outside that range is a failed report.',
        items: { type: 'string' },
      },
      caption: {
        type: 'string',
        description:
          'The final caption, ending where the bucket structure ends. Leave out the call to action and the hashtags. They are posted from their own fields, so writing them here posts them twice. This one caption pays out both on-screen copies. Short paragraphs, with a real blank line between them. A caption that is one block is a failed report. The caption, the call to action, and the hashtags together must stay within 2,200 characters.',
      },
      call_to_action: { type: 'string', description: 'The one call to action, as a single line.' },
      hashtags: {
        type: 'array',
        description: 'Three to five hashtags, each starting with #.',
        items: { type: 'string' },
      },
      sources: {
        type: 'array',
        description: 'Every source the caption names, with the URL it came from in the source material.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            url: { type: 'string' },
          },
          required: ['name', 'url'],
        },
      },
    },
    required: [
      'hook_drafts',
      'copy_draft',
      'caption_draft',
      'remaining_patterns',
      'viewer_stake',
      'on_screen_copies',
      'caption',
      'call_to_action',
      'hashtags',
      'sources',
    ],
  },
};

/** One copy call: two on-screen lines, one caption package. */
export type CopyCall = {
  onScreenCopies: [string, string];
  viewerStake: string;
  caption: string;
  callToAction: string;
  hashtags: string[];
  sources: Array<{ name: string; url: string }>;
  working: {
    hookDrafts: string[];
    copyDraft: string;
    captionDraft: string;
    remainingPatterns: string[];
  };
};

/** The line that will be posted, plus the caption from the call that wrote it. */
export type CopyReport = {
  onScreenCopy: string;
  viewerStake: string;
  caption: string;
  callToAction: string;
  hashtags: string[];
  sources: Array<{ name: string; url: string }>;
  working: CopyCall['working'];
};

export class CopyReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopyReportError';
  }
}

function text(input: Record<string, unknown>, key: string, required: boolean): string {
  const value = input[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (required) throw new CopyReportError(`report_copy is missing ${key}.`);
  return '';
}

/**
 * A model sometimes writes the two characters \ and n where a newline belongs.
 * Real newlines stay. A Windows break, real or written out, becomes one newline.
 */
export function restoreLineBreaks(value: string): string {
  return value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
}

/** At least two paragraphs with a blank line between them. A single line break is not enough. */
function captionWithBreaks(value: string): string {
  const caption = restoreLineBreaks(value);
  const paragraphs = caption
    .split(/\n[ \t]*\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (paragraphs.length < 2) {
    throw new CopyReportError(
      'report_copy caption is one block. Use short paragraphs with a blank line between them.',
    );
  }
  return caption;
}

/** Tool input is model output. A bare string where a list was asked for still counts. */
function list(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function sourceList(value: unknown): Array<{ name: string; url: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const name = (entry as Record<string, unknown>).name;
    const url = (entry as Record<string, unknown>).url;
    if (typeof name !== 'string' || typeof url !== 'string') return [];
    return [{ name: name.trim(), url: url.trim() }];
  });
}

function onScreenCopies(value: unknown): [string, string] {
  const copies = list(value).map(restoreLineBreaks);
  if (copies.length !== 2) {
    throw new CopyReportError(`report_copy needs exactly two on-screen copies, got ${copies.length}.`);
  }
  return [copies[0], copies[1]];
}

export function parseCopyReport(input: unknown): CopyCall {
  if (!input || typeof input !== 'object') throw new CopyReportError('report_copy input is not an object.');
  const record = input as Record<string, unknown>;
  const call: CopyCall = {
    onScreenCopies: onScreenCopies(record.on_screen_copies),
    viewerStake: text(record, 'viewer_stake', true),
    caption: captionWithBreaks(text(record, 'caption', true)),
    callToAction: restoreLineBreaks(text(record, 'call_to_action', true)),
    hashtags: list(record.hashtags).map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)),
    sources: sourceList(record.sources),
    working: {
      hookDrafts: list(record.hook_drafts),
      copyDraft: text(record, 'copy_draft', false),
      captionDraft: text(record, 'caption_draft', false),
      remainingPatterns: list(record.remaining_patterns),
    },
  };
  return call;
}

/** The posted row: one of the call's on-screen lines, with that call's caption. */
export function publishCopy(call: CopyCall, onScreenCopy: string): CopyReport {
  if (!call.onScreenCopies.includes(onScreenCopy)) {
    throw new CopyReportError('The winning on-screen copy is not one of the lines from its call.');
  }
  return {
    onScreenCopy,
    viewerStake: call.viewerStake,
    caption: call.caption,
    callToAction: call.callToAction,
    hashtags: call.hashtags,
    sources: call.sources,
    working: call.working,
  };
}

/**
 * The caption as it would be posted: body, call to action, hashtags.
 * A call to action or hashtag line already ending the body is not added again.
 * Anything over Instagram's limit is shortened here, with no model call:
 * paragraphs drop from the end, then the last remaining paragraph is cut
 * at a sentence.
 */
export function fullCaption(report: Pick<CopyReport, 'caption' | 'callToAction' | 'hashtags'>): string {
  const callToAction = report.callToAction.trim();
  const hashtags = report.hashtags.join(' ').trim();
  let body = stripTrailing(report.caption.trim(), hashtags);
  body = stripTrailing(body, callToAction);
  return fitCaptionParts(body, callToAction, hashtags, CAPTION_MAX_CHARS);
}

/** Cut an already assembled caption down to the limit. Keeps a trailing hashtag line. */
export function shortenAssembledCaption(caption: string, limit = CAPTION_MAX_CHARS): string {
  const trimmed = caption.trim();
  if (trimmed.length <= limit) return trimmed;
  const paragraphs = trimmed.split(/\n[ \t]*\n/).map((part) => part.trim()).filter(Boolean);
  const hashtags = paragraphs.length > 0 && /^#\S/.test(paragraphs[paragraphs.length - 1] ?? '')
    ? paragraphs.pop() ?? ''
    : '';
  return fitCaptionParts(paragraphs.join('\n\n'), '', hashtags, limit);
}

function stripTrailing(body: string, ending: string): string {
  if (!ending || !body.endsWith(ending)) return body;
  return body.slice(0, body.length - ending.length).trimEnd();
}

function joinParts(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join('\n\n');
}

function cutToFit(text: string, budget: number): string {
  if (budget <= 0) return '';
  if (text.length <= budget) return text;
  const slice = text.slice(0, budget).trimEnd();
  const floor = Math.min(80, Math.floor(budget / 2));
  const paragraph = slice.lastIndexOf('\n\n');
  if (paragraph >= floor) return slice.slice(0, paragraph).trimEnd();
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('.\n'),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! '),
  );
  if (sentenceEnd >= floor) return slice.slice(0, sentenceEnd + 1).trimEnd();
  const word = slice.lastIndexOf(' ');
  if (word >= Math.min(40, floor)) return slice.slice(0, word).trimEnd();
  return slice;
}

function fitCaptionParts(body: string, callToAction: string, hashtags: string, limit: number): string {
  const tails = [callToAction, hashtags].filter((part) => part.length > 0);
  const assemble = (nextBody: string, nextTails: string[]) => joinParts([nextBody, ...nextTails]);
  if (assemble(body, tails).length <= limit) return assemble(body, tails);

  const paragraphs = body.split(/\n[ \t]*\n/).map((part) => part.trim()).filter(Boolean);
  while (paragraphs.length > 1 && assemble(paragraphs.join('\n\n'), tails).length > limit) paragraphs.pop();
  body = paragraphs.join('\n\n');
  if (assemble(body, tails).length <= limit) return assemble(body, tails);

  const tailText = tails.join('\n\n');
  const roomForBody = tailText ? limit - tailText.length - 2 : limit;
  if (roomForBody > 0) {
    const fitted = assemble(cutToFit(body, roomForBody), tails);
    if (fitted.length <= limit) return fitted;
  }

  if (callToAction) {
    const cta = cutToFit(callToAction, limit);
    if (hashtags && joinParts([cta, hashtags]).length <= limit) return joinParts([cta, hashtags]);
    return cta;
  }
  return cutToFit(assemble(body, tails), limit);
}

export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export type CopyChecks = {
  copyWords: number;
  copyWordRange: { min: number; max: number };
  copyInRange: boolean;
  stakeWords: number;
  stakeFits: boolean;
  captionChars: number;
  captionUnderLimit: boolean;
  foldChars: number;
  foldFits: boolean;
  hashtagCount: number;
  hashtagsInRange: boolean;
  dashes: number;
  urlsInCaption: number;
  firstPersonWords: string[];
  unknownSourceUrls: string[];
};

const DASH = /[\u2013\u2014]|\s--\s/g;
const URL_PATTERN = /https?:\/\/\S+/g;
const FIRST_PERSON = /\b(?:we|We|our|Our|ours|Ours|us|Us|I|we're|We're|we've|We've|we'll|We'll)\b/g;

/** Review aids. First-person hits may be quotes from a source; they are flagged, not judged. */
export function checkCopy(
  report: CopyReport,
  bucket: BucketId,
  knownUrls: readonly string[],
): CopyChecks {
  const range = ON_SCREEN_WORD_RANGE[bucket];
  const caption = fullCaption(report);
  const copyWords = countWords(report.onScreenCopy);
  const stakeWords = countWords(report.viewerStake);
  const foldChars = (report.caption.split('\n').find((line) => line.trim()) ?? '').trim().length;
  const published = `${report.onScreenCopy}\n${caption}`;
  const known = new Set(knownUrls.map((url) => url.trim()));

  return {
    copyWords,
    copyWordRange: range,
    copyInRange: copyWords >= range.min && copyWords <= range.max,
    stakeWords,
    stakeFits: stakeWords > 0 && stakeWords <= VIEWER_STAKE_MAX_WORDS,
    captionChars: caption.length,
    captionUnderLimit: caption.length <= CAPTION_MAX_CHARS,
    foldChars,
    foldFits: foldChars <= CAPTION_FOLD_CHARS,
    hashtagCount: report.hashtags.length,
    hashtagsInRange:
      report.hashtags.length >= HASHTAG_RANGE.min && report.hashtags.length <= HASHTAG_RANGE.max,
    dashes: published.match(DASH)?.length ?? 0,
    urlsInCaption: caption.match(URL_PATTERN)?.length ?? 0,
    firstPersonWords: [...new Set(published.match(FIRST_PERSON) ?? [])],
    unknownSourceUrls: report.sources.map((source) => source.url).filter((url) => !known.has(url)),
  };
}
