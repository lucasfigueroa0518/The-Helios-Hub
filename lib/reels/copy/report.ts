import {
  captionBodyArtifacts,
  repairModelText,
  stripCaptionTail,
  textArtifacts,
} from '@/lib/reels/copy/clean-text';
import type { BucketId } from '@/lib/reels/scoring/decide';
import { HELIOS_NAME } from '@/lib/social/captions/helios-context';

/**
 * The writer's tool, and the checks code runs on what comes back. Checks are
 * shown beside the copy for review. They do not reject or retry anything; the
 * word range also gates the copy pick (D-216, lib/reels/copy/pick.ts). Text
 * artifacts are the exception: a report that still carries one after repair
 * fails, and the draft call is retried once (D-246).
 */

/**
 * On-screen word counts from PRODUCT_SPEC.md. The Number, Ball Knowledge, and
 * The Callout run to 26 words since D-267 (22 under D-250), room to carry the
 * stake and stay plain. The Saga is 14 to 32 (20 to 32 before D-269) on one
 * 10-second clip that loops, about 11 seconds of reading at 3 words a second
 * at the top (D-214, D-266).
 */
export const ON_SCREEN_WORD_RANGE: Record<BucketId, { min: number; max: number }> = {
  ball_knowledge: { min: 8, max: 26 },
  the_number: { min: 1, max: 26 },
  the_saga: { min: 14, max: 32 },
  personal_profile: { min: 10, max: 18 },
  the_warning: { min: 15, max: 25 },
  the_callout: { min: 12, max: 26 },
};

/** Instagram's caption limit and the "more" fold. */
export const CAPTION_MAX_CHARS = 2_200;
export const CAPTION_FOLD_CHARS = 125;
export const HASHTAG_RANGE = { min: 3, max: 5 };
export const VIEWER_STAKE_MAX_WORDS = 20;
/** Iteration round 1: each call asks for four copies. A report with two to six still parses. */
export const ON_SCREEN_COPIES_PER_CALL = 4;
export const ON_SCREEN_COPIES_RANGE = { min: 2, max: 6 };

export const REPORT_COPY_TOOL = {
  name: 'report_copy',
  description:
    'Report four final on-screen copies and one caption for this post idea. All four are doors into that one caption. Call it once.',
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
      copy_draft: { type: 'string', description: 'The four on-screen lines before the final edit.' },
      caption_draft: { type: 'string', description: 'The caption before the final edit.' },
      remaining_patterns: {
        type: 'array',
        description: 'Humanizer patterns still present in the drafts, each as its number and a short quote. Empty when none.',
        items: { type: 'string' },
      },
      stake_options: {
        type: 'array',
        description:
          'Written before the viewer stake: three candidate stakes from different angles, one plain sentence each. Something of the viewer\'s and what happens to it; what was done, or is about to be done, to a person in the story; what this changes next for people like the viewer. Each one is supported by the sources.',
        items: { type: 'string' },
      },
      viewer_stake: {
        type: 'string',
        description:
          'The most significant of the stake options: the most on the line, for the most viewers, landing soonest, and never bigger than the sources support. One plain sentence, 20 words at most, saying why this viewer should care. Tested against the hook questions before either copy is drafted. It belongs to this story: a sentence that would fit most posts about AI is not a stake yet. Both on-screen copies carry it in their own words, and the caption\'s first paragraph pays it out.',
      },
      tension: {
        type: 'string',
        description:
          'Written before the copies: what happened, what makes it surprising or charged, and what the viewer gets by staying, in one or two sentences. Both copies are built on it. If the sources hold no tension, say so here and do not invent one.',
      },
      on_screen_copies: {
        type: 'array',
        description:
          'Exactly four final on-screen copies for the one screen. Same story about the same subject, same facts, same stake, paid out by the one caption. Each whole copy is a hook, and the four are different hooks, with a different first line and a different way in. A paraphrase is a failed report. Each copy has a line break already inserted at each natural pause. One line break between lines, and no blank line. A line break stays on this same screen. Count the words in each copy on its own. Each count must fall inside the bucket word range given in the prompt. A count outside that range is a failed report.',
        items: { type: 'string' },
      },
      caption: {
        type: 'string',
        description:
          'The final caption body, ending where the bucket structure ends. Leave out the call to action, the Helios line, and the hashtags. They are posted from their own fields after the caption, in that order, so writing them here posts them twice. This one caption pays out every on-screen copy. Short paragraphs, with a real blank line between them. A caption that is one block is a failed report. The caption, the call to action, the Helios line, and the hashtags together must stay within 2,200 characters.',
      },
      builder_read: {
        type: 'string',
        description:
          'The Helios line, also called the builder\'s read. It ends the post, after the call to action and before the hashtags, and is not part of the caption field. One or two sentences: a builder\'s take on what this story changes for someone running marketing, sales, or ops at a business like the ones in the Helios context. It names Helios once.',
      },
      call_to_action: {
        type: 'string',
        description: 'The one call to action, as a single line. A person it names is described by something this story is about.',
      },
      outcome_note: {
        type: 'string',
        description:
          'For The Saga: whether the sources report an outcome that already happened, and which beat the copy lands on. One sentence. An empty string for other buckets.',
      },
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
      'stake_options',
      'viewer_stake',
      'tension',
      'on_screen_copies',
      'caption',
      'builder_read',
      'call_to_action',
      'outcome_note',
      'hashtags',
      'sources',
    ],
  },
};

/** One copy call: several on-screen lines, one caption package. */
export type CopyCall = {
  onScreenCopies: string[];
  viewerStake: string;
  caption: string;
  /** v28. The Helios line, the one place Helios is named. v29 posts it last, after the call to action; it is not in `caption`. */
  builderRead: string;
  callToAction: string;
  hashtags: string[];
  sources: Array<{ name: string; url: string }>;
  working: {
    hookDrafts: string[];
    copyDraft: string;
    captionDraft: string;
    remainingPatterns: string[];
    /** D-251. The tension the copies are built on, written before drafting. Absent on rows before v18. */
    tension?: string;
    /** D-259. The candidate stakes the viewer stake was chosen from. Absent on rows before v24. */
    stakeOptions?: string[];
    /** D-238. The Saga's note on whether an outcome already happened. Empty elsewhere; absent on rows before v17. */
    outcomeNote?: string;
    /** v28. Kept here too so the JSON working column and the stored variants carry it. Absent before v28. */
    builderRead?: string;
  };
};

/** The line that will be posted, plus the caption from the call that wrote it. */
export type CopyReport = {
  onScreenCopy: string;
  viewerStake: string;
  caption: string;
  builderRead: string;
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
  if (typeof value === 'string' && value.trim()) return repairModelText(value).trim();
  if (required) throw new CopyReportError(`report_copy is missing ${key}.`);
  return '';
}

/**
 * A model sometimes writes the two characters \ and n where a newline belongs,
 * or \" where a quote belongs. Real newlines stay. A Windows break, real or
 * written out, becomes one newline. D-246 widened this to every written-out
 * escape (lib/reels/copy/clean-text.ts).
 */
export function restoreLineBreaks(value: string): string {
  return repairModelText(value);
}

/** D-246. The prefix that marks a report failed for leftover text artifacts, so the call can be retried. */
export const TEXT_ARTIFACT_ERROR = 'report_copy text still carries';

export function isTextArtifactError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.startsWith(TEXT_ARTIFACT_ERROR);
}

/** v28. The prefix that marks a report failed for its builder's read, so the call can be retried. */
export const BUILDER_READ_ERROR = 'report_copy builder_read';

export function isBuilderReadError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.startsWith(BUILDER_READ_ERROR);
}

function squash(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * v29. The Helios line names Helios. It posts last, after the call to action,
 * and the call to action never names Helios, so there is no exemption.
 */
function checkBuilderRead(read: string): void {
  if (!HELIOS_NAME.test(read)) {
    throw new CopyReportError(`${BUILDER_READ_ERROR} does not name Helios. Name Helios once, lightly, in the Helios line.`);
  }
}

/**
 * v29. The Helios line is posted from its own field, after the call to action.
 * A caption that also carries it (a v28 row, or a model that wrote it twice)
 * loses that paragraph here so it posts once. The body keeps at least one paragraph.
 */
export function withoutBuilderRead(caption: string, read: string): string {
  const target = squash(read);
  if (!target) return caption;
  const paragraphs = caption.split(/\n[ \t]*\n/);
  const kept = paragraphs.filter((part) => squash(part) !== target);
  if (kept.length === paragraphs.length || kept.length === 0) return caption;
  return kept.map((part) => part.trim()).filter(Boolean).join('\n\n');
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
  if (typeof value === 'string') return value.trim() ? [repairModelText(value).trim()] : [];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? repairModelText(entry).trim() : ''))
    .filter((entry) => entry.length > 0);
}

function sourceList(value: unknown): Array<{ name: string; url: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const name = (entry as Record<string, unknown>).name;
    const url = (entry as Record<string, unknown>).url;
    if (typeof name !== 'string' || typeof url !== 'string') return [];
    return [{ name: repairModelText(name).trim(), url: repairModelText(url).trim() }];
  });
}

function onScreenCopies(value: unknown): string[] {
  const copies = list(value);
  if (copies.length < ON_SCREEN_COPIES_RANGE.min || copies.length > ON_SCREEN_COPIES_RANGE.max) {
    throw new CopyReportError(
      `report_copy needs ${ON_SCREEN_COPIES_PER_CALL} on-screen copies, got ${copies.length}.`,
    );
  }
  return copies;
}

export function parseCopyReport(input: unknown): CopyCall {
  if (!input || typeof input !== 'object') throw new CopyReportError('report_copy input is not an object.');
  const record = input as Record<string, unknown>;
  const callToAction = text(record, 'call_to_action', true);
  const builderRead = text(record, 'builder_read', true);
  const written = captionWithBreaks(stripCaptionTail(text(record, 'caption', true), callToAction, 2));
  const call: CopyCall = {
    onScreenCopies: onScreenCopies(record.on_screen_copies),
    viewerStake: text(record, 'viewer_stake', true),
    // v29: the one-block rule reads the caption as written; the Helios line then leaves the body.
    caption: stripCaptionTail(withoutBuilderRead(written, builderRead), callToAction, 1),
    builderRead,
    callToAction,
    hashtags: list(record.hashtags).map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)),
    sources: sourceList(record.sources),
    working: {
      hookDrafts: list(record.hook_drafts),
      copyDraft: text(record, 'copy_draft', false),
      captionDraft: text(record, 'caption_draft', false),
      remainingPatterns: list(record.remaining_patterns),
      stakeOptions: list(record.stake_options),
      outcomeNote: text(record, 'outcome_note', false),
      tension: text(record, 'tension', true),
    },
  };
  call.working.builderRead = call.builderRead;
  const leftovers = reportArtifacts(call);
  if (leftovers.length > 0) {
    throw new CopyReportError(`${TEXT_ARTIFACT_ERROR} ${leftovers.join('; ')}.`);
  }
  checkBuilderRead(call.builderRead);
  return call;
}

/** D-246. Every artifact still in the fields that get posted or rendered, named by field. */
export function reportArtifacts(
  call: Pick<CopyCall, 'onScreenCopies' | 'viewerStake' | 'caption' | 'callToAction' | 'hashtags'>,
): string[] {
  const named = (field: string, found: string[]) => found.map((artifact) => `${artifact} in ${field}`);
  return [
    ...call.onScreenCopies.flatMap((copy, index) => named(`on-screen copy ${index + 1}`, textArtifacts(copy))),
    ...named('viewer stake', textArtifacts(call.viewerStake)),
    ...named('caption', captionBodyArtifacts(call.caption, call.callToAction)),
    ...named('call to action', textArtifacts(call.callToAction)),
    ...named('hashtags', textArtifacts(call.hashtags.join(' '))),
  ];
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
    builderRead: call.builderRead,
    callToAction: call.callToAction,
    hashtags: call.hashtags,
    sources: call.sources,
    working: call.working,
  };
}

/**
 * The caption as it would be posted: body, call to action, the Helios line
 * (v29), hashtags. A call to action, Helios line or hashtag line already in
 * the body is not added again; a v28 row's read, stored as the caption's last
 * paragraph, moves after the call to action. Rows before v28 have no read.
 * Anything over Instagram's limit is shortened here, with no model call: the
 * call to action and the Helios line are kept, body paragraphs drop from just
 * before them, then the last remaining paragraph is cut at a sentence.
 */
export function fullCaption(
  report: Pick<CopyReport, 'caption' | 'callToAction' | 'hashtags'> & { builderRead?: string | null },
): string {
  const callToAction = report.callToAction.trim();
  const read = (report.builderRead ?? '').trim();
  const hashtags = report.hashtags.join(' ').trim();
  let body = stripTrailing(report.caption.trim(), hashtags);
  body = stripTrailing(body, callToAction);
  // D-246: a call to action or hashtag line written with different spacing or
  // a "CTA:" label is still posted once.
  body = stripCaptionTail(body, callToAction, 1);
  body = stripCaptionTail(withoutBuilderRead(body, read), callToAction, 1);
  return fitCaptionParts(body, joinParts([callToAction, read]), hashtags, CAPTION_MAX_CHARS);
}

/** Cut an already assembled caption down to the limit. Keeps a trailing hashtag line. */
export function shortenAssembledCaption(caption: string, limit = CAPTION_MAX_CHARS): string {
  const trimmed = caption.trim();
  if (trimmed.length <= limit) return trimmed;
  const paragraphs = trimmed.split(/\n[ \t]*\n/).map((part) => part.trim()).filter(Boolean);
  const hashtags = paragraphs.length > 0 && /^#\S/.test(paragraphs[paragraphs.length - 1] ?? '')
    ? paragraphs.pop() ?? ''
    : '';
  // The body's last two paragraphs are the call to action and the Helios line (v29;
  // the read and the call to action on v28 posts). Both are kept.
  return fitCaptionParts(paragraphs.join('\n\n'), '', hashtags, limit, 2);
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

/**
 * v28. The last `keep` body paragraphs are the caption's ending (the call to
 * action and the Helios line). Paragraphs drop from just before that ending,
 * backwards; then the opening is cut at a sentence to leave room for it. The
 * ending is cut only when it cannot fit beside anything else.
 */
function fitCaptionParts(body: string, callToAction: string, hashtags: string, limit: number, keep = 0): string {
  const tails = [callToAction, hashtags].filter((part) => part.length > 0);
  const assemble = (nextBody: string, nextTails: string[]) => joinParts([nextBody, ...nextTails]);
  if (assemble(body, tails).length <= limit) return assemble(body, tails);

  const paragraphs = body.split(/\n[ \t]*\n/).map((part) => part.trim()).filter(Boolean);
  const ending = keep > 0 && paragraphs.length > keep ? paragraphs.splice(paragraphs.length - keep) : [];
  const withEnding = () => [...paragraphs, ...ending].join('\n\n');
  while (paragraphs.length > 1 && assemble(withEnding(), tails).length > limit) paragraphs.pop();
  body = withEnding();
  if (assemble(body, tails).length <= limit) return assemble(body, tails);

  if (ending.length > 0) {
    const endingText = ending.join('\n\n');
    const roomForLead = limit - assemble(endingText, tails).length - 2;
    if (roomForLead > 0) {
      const lead = cutToFit(paragraphs.join('\n\n'), roomForLead);
      const fitted = assemble(joinParts([lead, endingText]), tails);
      if (lead && fitted.length <= limit) return fitted;
    }
  }

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
  /** D-246. Escape sequences or tool syntax still in the posted text. Empty when clean. */
  textArtifacts: string[];
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
  // v28: "we" is allowed in the Helios line (the builder's read), so only the rest is flagged.
  const outsideRead = report.builderRead ? published.split(report.builderRead).join('\n') : published;
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
    firstPersonWords: [...new Set(outsideRead.match(FIRST_PERSON) ?? [])],
    unknownSourceUrls: report.sources.map((source) => source.url).filter((url) => !known.has(url)),
    textArtifacts: [...textArtifacts(report.onScreenCopy), ...textArtifacts(caption)],
  };
}
