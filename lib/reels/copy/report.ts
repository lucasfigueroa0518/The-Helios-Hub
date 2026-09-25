import type { BucketId } from '@/lib/reels/scoring/decide';

/**
 * The writer's tool, and the checks code runs on what comes back. Checks are
 * shown beside the copy for review. They do not reject or retry anything.
 */

/** On-screen word counts from PRODUCT_SPEC.md. "Under 15" is at most 14. */
export const ON_SCREEN_WORD_RANGE: Record<BucketId, { min: number; max: number }> = {
  ball_knowledge: { min: 8, max: 14 },
  the_number: { min: 1, max: 14 },
  the_saga: { min: 40, max: 70 },
  personal_profile: { min: 10, max: 18 },
  the_warning: { min: 15, max: 25 },
  the_callout: { min: 12, max: 22 },
};

/** Instagram's caption limit and the "more" fold. */
export const CAPTION_MAX_CHARS = 2_200;
export const CAPTION_FOLD_CHARS = 125;
export const HASHTAG_RANGE = { min: 3, max: 5 };

export const REPORT_COPY_TOOL = {
  name: 'report_copy',
  description: 'Report the final on-screen copy and caption for this post idea. Call it once.',
  input_schema: {
    type: 'object' as const,
    properties: {
      hook_drafts: {
        type: 'array',
        description: 'At least three different opening lines you considered for the on-screen copy. Working notes, not published.',
        items: { type: 'string' },
      },
      copy_draft: { type: 'string', description: 'Your first draft of the on-screen copy. Working notes.' },
      caption_draft: { type: 'string', description: 'Your first draft of the caption. Working notes.' },
      remaining_patterns: {
        type: 'array',
        description: 'Humanizer patterns still present in the drafts, each as its number and a short quote. Empty when none.',
        items: { type: 'string' },
      },
      on_screen_copy: {
        type: 'string',
        description:
          'The final on-screen copy for the one screen, with a line break already inserted at each natural pause. One line break between lines, and no blank line. A line break stays on this same screen. Count the words. The count must fall inside the bucket word range given in the prompt. A count outside that range is a failed report.',
      },
      caption: {
        type: 'string',
        description: 'The final caption, ending where the bucket structure ends. Leave out the call to action and the hashtags.',
      },
      call_to_action: { type: 'string', description: 'The one call to action, as a single line.' },
      hashtags: {
        type: 'array',
        description: '3 to 5 hashtags, each starting with #.',
        items: { type: 'string' },
      },
      sources: {
        type: 'array',
        description: 'Every source the caption names, with the URL it came from in the source material.',
        items: {
          type: 'object',
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
      'on_screen_copy',
      'caption',
      'call_to_action',
      'hashtags',
      'sources',
    ],
  },
};

export type CopyReport = {
  onScreenCopy: string;
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

export function parseCopyReport(input: unknown): CopyReport {
  if (!input || typeof input !== 'object') throw new CopyReportError('report_copy input is not an object.');
  const record = input as Record<string, unknown>;
  return {
    onScreenCopy: text(record, 'on_screen_copy', true),
    caption: text(record, 'caption', true),
    callToAction: text(record, 'call_to_action', true),
    hashtags: list(record.hashtags).map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)),
    sources: sourceList(record.sources),
    working: {
      hookDrafts: list(record.hook_drafts),
      copyDraft: text(record, 'copy_draft', false),
      captionDraft: text(record, 'caption_draft', false),
      remainingPatterns: list(record.remaining_patterns),
    },
  };
}

/** The caption as it would be posted: body, call to action, hashtags. */
export function fullCaption(report: Pick<CopyReport, 'caption' | 'callToAction' | 'hashtags'>): string {
  return [report.caption, report.callToAction, report.hashtags.join(' ')]
    .filter((part) => part.length > 0)
    .join('\n\n');
}

export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export type CopyChecks = {
  copyWords: number;
  copyWordRange: { min: number; max: number };
  copyInRange: boolean;
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
  const foldChars = (report.caption.split('\n').find((line) => line.trim()) ?? '').trim().length;
  const published = `${report.onScreenCopy}\n${caption}`;
  const known = new Set(knownUrls.map((url) => url.trim()));

  return {
    copyWords,
    copyWordRange: range,
    copyInRange: copyWords >= range.min && copyWords <= range.max,
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
