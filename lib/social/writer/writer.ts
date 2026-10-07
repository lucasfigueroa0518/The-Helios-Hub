/**
 * Writer stage (spec §3, §4; prompts file §2–3): one brief → one draft,
 * submitted through submit_draft, checked in code, quotes and numbers
 * filled by ID. One retry when the check fails (spec §7.1 glitch rule).
 *
 * The call itself (caching, check, one retry) is runStructuredCall.
 */
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import { photoUrlKey, articlePhotosFor, type ListedPhoto } from '@/lib/social/photos/article-list';
import { NOTHING, type SubjectAvailability } from '@/lib/social/photos/availability';
import type { SubjectType } from '@/lib/social/photos/identity';
import { isNamedIn, namedSubjects, type NamedSubject } from '@/lib/social/photos/named';
import { DEFAULT_ICON, isIcon } from '@/lib/social/render/icons';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import type { Brief, BriefError } from '@/lib/social/reporter/brief';
import type { MessagesCreate, TurnUsage } from '@/lib/social/reporter/reporter';

import { draftTextFailures } from '@/lib/social/mechanical/checks';

import { DraftValidationError, SUBMIT_DRAFT_TOOL, checkDraft, fillDraft, type DraftSubmission, type FilledDraft, type ImageRequest } from './draft';
import { WRITER_SYSTEM, writerUserMessage } from './prompt';
import { MAX_CHECK_RETRIES, runStructuredCall } from './structured-call';


/** Is this subject widely known? Spec §4.1a: yes when it has a Wikidata match. */
export type IsWellKnown = (subject: { name: string; role: string | null }, brief: Brief) => Promise<boolean>;

/**
 * The brief the Writer sees (photo spec §3, §4; Link 1, Tommy 2026-10-07):
 * the Reporter's JSON with code-set marks, so every photo the Writer can ask
 * for is one the finder can deliver.
 *   SUBJECTS: well_known (cover rule); type (person / organization: the
 *     identity check's, else the Reporter's mark); headshot_available (a
 *     person's verified main photo); logo_available (an organization's
 *     verified logo; a company's main photo is never offered: logos only,
 *     Tommy, 2026-10-07).
 *   ARTICLE PHOTOS: the code-built list (photos/article-list.ts): body photos
 *     with a caption naming a SUBJECT and an allowed credit, plus official
 *     images from a SUBJECTS company's own page. Each carries the SUBJECTS IDs
 *     its caption names, and official images the company's ID.
 */
export type WriterSubject = Omit<Brief['subjects'][number], 'type'> & {
  well_known: boolean;
  type: SubjectType | null;
  headshot_available: boolean;
  logo_available: boolean;
};

export type WriterBrief = Omit<Brief, 'subjects' | 'article_photos'> & { subjects: WriterSubject[]; article_photos: ListedPhoto[] };

export async function briefForWriter(brief: Brief, isWellKnown: IsWellKnown, availability?: SubjectAvailability, pages: PageReadOk[] = []): Promise<WriterBrief> {
  const subjects = await Promise.all(
    brief.subjects.map(async (s): Promise<WriterSubject> => {
      const a = availability ? await availability(s, brief).catch(() => NOTHING) : NOTHING;
      return {
        ...s,
        well_known: await isWellKnown(s, brief).catch(() => false),
        type: a.kind ?? s.type ?? null,
        headshot_available: a.kind === 'person' && a.headshot,
        logo_available: a.kind === 'organization' && a.logo,
      };
    }),
  );
  const kinds = new Map(subjects.map((s) => [s.name, s.type]));
  return { ...brief, subjects, article_photos: articlePhotosFor(brief, pages, kinds) };
}

/**
 * What the handoff check needs from the Writer's brief. `subjects` is null
 * when no availability lookup ran (tests): the flags aren't checked then.
 */
export type PhotoView = { subjects: Map<string, WriterSubject> | null; photos: ListedPhoto[] | null; kinds?: SubjectKinds };

export function photoViewOf(b: WriterBrief, opts: { flags: boolean }): PhotoView {
  return { subjects: opts.flags ? new Map(b.subjects.map((s) => [s.name, s])) : null, photos: b.article_photos, kinds: new Map(b.subjects.map((s) => [s.name, s.type])) };
}

const word4 = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map((w) => w.replace(/s$/, '')));

const KEEP_WORDS = " (never change the slide's words to fit a photo)";
const KEEP_WORDS_TAG = " (never change the slide's words to fit a tag)";

/** The text at a handoff place ("cover" or "slide N"), for the words-stay check. */
function textAt(d: DraftSubmission, where: string): string | null {
  if (where === 'cover') return d.cover_options[d.chosen_cover - 1]?.text ?? null;
  const s = d.slides[Number(where.replace('slide ', '')) - 2];
  return s ? `${s.headline.text}\n${s.body?.text ?? ''}` : null;
}

/**
 * Words never change to fit a photo (Tommy, 2026-10-06), or a subject tag:
 * every place whose IMAGE request or tags failed on the first attempt keeps
 * its words on the retry.
 */
export function wordsChangedForPhoto(next: DraftSubmission, first: DraftSubmission, failedPlaces: string[]): BriefError[] {
  return failedPlaces.flatMap((where) => {
    const was = textAt(first, where);
    const now = textAt(next, where);
    return was !== null && now !== null && was !== now
      ? [{ section: `${where}`, message: `the words changed after its IMAGE request failed; restore them and change the request instead (never change a slide's words to fit a photo)` }]
      : [];
  });
}

type Place = {
  where: string;
  icon: string | undefined;
  /** 'cover' or the slide type. */
  kind: 'cover' | DraftSubmission['slides'][number]['type'];
  image: ImageRequest;
  tags: string[] | undefined;
  /** What the slide shows: headline, body, quote and its speaker, number labels (cover: its text). */
  text: string;
  quoteId: string | null;
  afterSpread: boolean;
};

function placesOf(d: DraftSubmission, brief: Brief): Place[] {
  const chosen = d.cover_options[d.chosen_cover - 1]!;
  return [
    { where: 'cover', icon: chosen.icon, kind: 'cover', image: chosen.image, tags: chosen.subject_ids, text: chosen.text, quoteId: null, afterSpread: false },
    ...d.slides.map((s, i): Place => {
      const q = s.quote_id ? brief.quotes.find((x) => x.id === s.quote_id) : undefined;
      const n = s.number_ids.map((id) => brief.numbers.find((x) => x.id === id)?.counts ?? '').join(' ');
      return {
        where: `slide ${i + 2}`,
        icon: s.icon,
        kind: s.type,
        image: s.image,
        tags: s.subject_ids,
        text: [s.headline.text, s.body?.text ?? '', q?.text ?? '', q?.speaker ?? '', n].join(' '),
        quoteId: s.quote_id,
        afterSpread: Boolean(d.slides[i - 1]?.spread_with_next),
      };
    }),
  ];
}

const PHOTO_SLIDES = new Set(['cover', 'text', 'landing', 'image']);

/** Each subject's type for the naming rule (from the availability lookup), or null (unknown: full names only). */
export type SubjectKinds = Map<string, SubjectType | null> | null;

const kindsOf = (view: PhotoView | null): SubjectKinds => view?.kinds ?? (view?.subjects ? new Map([...view.subjects.values()].map((s) => [s.name, s.type])) : null);

/** Subject tags (photo spec §3 rule 3, Tommy 2026-10-07): given, known, and named on the slide. */
function tagFailures(p: Place, brief: Brief, named: NamedSubject[]): BriefError[] {
  if (!p.tags) return [{ section: `${p.where}.subject_ids`, message: 'tag this slide with subject_ids: the SUBJECTS IDs it is about and names (an empty list if none)' }];
  return p.tags.flatMap((id) => {
    const s = named.find((x) => x.id === id);
    if (!s) return [{ section: `${p.where}.subject_ids`, message: `${id} isn't a SUBJECTS ID; remove it` }];
    if (!isNamedIn(s, p.text, named)) return [{ section: `${p.where}.subject_ids`, message: `${id} (${s.name}) isn't named on this slide; remove the tag${KEEP_WORDS_TAG}` }];
    return [];
  });
}

/**
 * The Writer's IMAGE requests and subject tags (photo spec §4; Link 1,
 * Tommy 2026-10-07), checked on every attempt. `view` null skips the
 * availability flags and the ARTICLE PHOTOS list (tests without a lookup).
 */
export function imageHandoffFailures(d: DraftSubmission, brief: Brief, view: PhotoView | null): BriefError[] {
  const errors: BriefError[] = [];
  const places = placesOf(d, brief);
  const named = namedSubjects(brief.subjects, kindsOf(view));
  const subjectByName = new Map(brief.subjects.map((s) => [s.name, s]));
  const typeOf = (name: string) => named.find((x) => x.name === name)?.kind ?? null;
  const personAt = new Map<string, string>();
  const orgOnSlides = new Map<string, string[]>();

  for (const p of places) {
    errors.push(...tagFailures(p, brief, named));
    if (!isIcon(p.icon)) errors.push({ section: `${p.where}.icon`, message: p.icon ? `icon "${p.icon}" isn't on the icon list; pick one from the list` : 'name an icon for this slide, from the icon list' });
    const { image: img, where } = p;
    const section = `${where}.image`;
    const tagged = (id: string) => (p.tags ?? []).includes(id);

    // Quote slides: the speaker, or none when the speaker is an organization or not a SUBJECT.
    if (p.kind === 'quote') {
      const q = brief.quotes.find((x) => x.id === p.quoteId);
      const speaker = q?.speaker_id ? brief.subjects.find((x) => x.id === q.speaker_id) ?? null : null;
      if (!speaker) {
        if (img.kind !== 'none') errors.push({ section, message: `the quote's speaker isn't in SUBJECTS: its IMAGE is none (a type-led quote slide), not ${img.kind}${img.value ? `: ${img.value}` : ''}; change the request${KEEP_WORDS}` });
      } else if (typeOf(speaker.name) === 'organization') {
        if (img.kind !== 'none') errors.push({ section, message: `the speaker (${speaker.name}) is an organization: its logo never goes in the speaker's spot, so its IMAGE is none (a type-led quote slide); change the request${KEEP_WORDS}` });
      } else if (img.kind !== 'subject' || img.value !== speaker.name) {
        errors.push({ section, message: `a quote slide's IMAGE is its speaker (subject: ${speaker.name}), never another person, a logo or a scene; a speaker without a verified photo still gets a type-led quote slide; not ${img.kind}${img.value ? `: ${img.value}` : ''}; change the request${KEEP_WORDS}` });
      }
      continue;
    }
    // Stat slides: the icon background is automatic.
    if (p.kind === 'stat' || p.kind === 'split_stat') {
      if (img.kind !== 'none') errors.push({ section, message: `a ${p.kind} slide's background is automatic: its IMAGE is none, not ${img.kind}${img.value ? `: ${img.value}` : ''}; change the request${KEEP_WORDS}` });
      continue;
    }
    if (img.kind === 'none') {
      if (where === 'cover') errors.push({ section, message: 'a cover always has an IMAGE (never none)' });
      continue;
    }
    if (!PHOTO_SLIDES.has(p.kind)) {
      errors.push({ section, message: `${img.kind}: can't show on a ${p.kind} slide (only the cover, text, landing and image slides); change the request${KEEP_WORDS}` });
      continue;
    }

    if (img.kind === 'subject') {
      const s = subjectByName.get(img.value);
      if (!s) continue; // checkDraft reports a name that isn't in SUBJECTS
      if (!tagged(s.id)) errors.push({ section, message: `subject: ${s.name} isn't tagged on this slide; request only a subject the slide is tagged with, or change the request${KEEP_WORDS}` });
      const ws = view?.subjects?.get(s.name);
      const isOrg = typeOf(s.name) === 'organization';
      if (ws) {
        // Organizations: their logo only, the cover's logo card or one story slide (Tommy, 2026-10-07).
        const has = !isOrg ? ws.headshot_available : ws.logo_available;
        if (!has) {
          const what = !isOrg ? 'no verified headshot (headshot_available: false)' : 'no verified logo (logo_available: false)';
          errors.push({ section, message: `${s.name} has ${what}; change the request to an article photo, a literal stock scene or none${KEEP_WORDS}` });
        }
      }
      if (isOrg) {
        // Story slides: its logo on at most one (photo spec §4).
        if (where !== 'cover') {
          const prev = orgOnSlides.get(s.name) ?? [];
          if (prev.length >= 1) errors.push({ section, message: `${s.name}'s logo is already on ${prev.join(' and ')}; a logo goes on the cover and at most one story slide; change this request${KEEP_WORDS}` });
          orgOnSlides.set(s.name, [...prev, where]);
        }
      } else {
        const prev = personAt.get(s.name);
        if (prev) errors.push({ section, message: `${s.name} is already requested on ${prev}; each person at most once per post (their quote slide aside); change this request${KEEP_WORDS}` });
        else personAt.set(s.name, where);
      }
    }

    if (img.kind === 'article' && view?.photos) {
      const photo = view.photos.find((x) => photoUrlKey(x.url) === photoUrlKey(img.value));
      if (!photo) {
        errors.push({ section, message: `article: ${img.value} isn't in ARTICLE PHOTOS; use one listed there, or change the request${KEEP_WORDS}` });
      } else if (photo.official_of) {
        const company = brief.subjects.find((x) => x.id === photo.official_of)?.name ?? photo.official_of;
        if (where !== 'cover' && !tagged(photo.official_of)) errors.push({ section, message: `an official image of ${company} goes only on the cover or a slide tagged with ${company}; change the request${KEEP_WORDS}` });
      } else if (!photo.subject_ids.some(tagged)) {
        const names = photo.subject_ids.map((id) => brief.subjects.find((x) => x.id === id)?.name ?? id).join(', ');
        errors.push({ section, message: `this article photo's caption names ${names}; the slide isn't tagged with any of them; change the request${KEEP_WORDS}` });
      }
    }

    if (img.kind === 'stock') {
      const slideWords = word4(p.text);
      if (![...word4(img.value)].some((w) => slideWords.has(w))) {
        errors.push({ section, message: `stock "${img.value}" doesn't name a physical thing this slide mentions; change the request to a scene the slide already mentions, or none${KEEP_WORDS}` });
      }
    }
  }
  // The other cover options never use none either.
  d.cover_options.forEach((c, i) => {
    if (i !== d.chosen_cover - 1 && c.image.kind === 'none') errors.push({ section: `cover_options[${i}].image`, message: 'a cover always has an IMAGE (never none)' });
  });
  // One EDIT NOTES line per none on a story slide that could show a photo (Tommy, 2026-10-06). Stat and
  // quote slides' none is automatic (an icon background, a type-led quote), and so is the slide after a spread.
  const nones = places.filter((p) => p.where !== 'cover' && PHOTO_SLIDES.has(p.kind) && p.image.kind === 'none' && !p.afterSpread).length;
  const noteLines = d.edit_notes.filter((n) => /\bnone\b/i.test(n)).length;
  if (noteLines < nones) errors.push({ section: 'edit_notes', message: `${nones} slide(s) with IMAGE none but ${noteLines} EDIT NOTES line(s) about none; add one line per none saying why nothing physical fits` });
  return errors;
}

/**
 * Subject tags that fail are removed (a missing list becomes empty), logged
 * as subject-tag-dropped. Words never change. Used on the Writer's final
 * attempt and right after the Editor (Tommy, 2026-10-07).
 */
export function pruneSubjectTags(d: DraftSubmission, brief: Brief, kinds: SubjectKinds = null): { draft: DraftSubmission; dropped: string[] } {
  const out = structuredClone(d);
  const named = namedSubjects(brief.subjects, kinds);
  const dropped: string[] = [];
  const places = placesOf(out, brief);
  const targets = [out.cover_options[out.chosen_cover - 1]!, ...out.slides];
  places.forEach((p, i) => {
    const t = targets[i]!;
    if (!t.subject_ids) {
      t.subject_ids = [];
      dropped.push(`subject-tag-dropped: ${p.where} had no subject_ids → []`);
      return;
    }
    const keep = t.subject_ids.filter((id) => {
      const s = named.find((x) => x.id === id);
      const ok = Boolean(s && isNamedIn(s, p.text, named));
      if (!ok) dropped.push(`subject-tag-dropped: ${p.where} ${id}${s ? ` (${s.name})` : ''} (not named on the slide)`);
      return ok;
    });
    t.subject_ids = keep;
  });
  return { draft: out, dropped };
}

export type WriterResult =
  | { ok: true; draft: DraftSubmission; filled: FilledDraft; raw: string; costUsd: number; turns: number; draftRetries: number; retryErrors: string[]; turnUsage: TurnUsage[]; imageRequestsDropped: string[] }
  | { ok: false; reason: 'malformed-output' | 'service-error' | 'refused'; detail: string; raw: string | null; costUsd: number; turns: number; draftRetries: number; retryErrors: string[]; turnUsage: TurnUsage[]; imageRequestsDropped: string[] };

export type WriterDeps = {
  create: MessagesCreate;
  isWellKnown: IsWellKnown;
  /** headshot_available / logo_available marking (photos/availability.ts); without it the flags aren't checked. */
  availability?: SubjectAvailability;
  config?: StageModelConfig;
  /** The pages the Reporter read: the ARTICLE PHOTOS list is built from them (photos/article-list.ts). */
  pages?: PageReadOk[];
};

/** A missing or unknown icon on the chosen cover or a slide becomes DEFAULT_ICON, logged as icon-defaulted (final attempt; after the Editor). */
export function defaultIcons(d: DraftSubmission): { draft: DraftSubmission; dropped: string[] } {
  const out = structuredClone(d);
  const dropped: string[] = [];
  const fix = (t: { icon?: string }, where: string) => {
    if (isIcon(t.icon)) return;
    dropped.push(`icon-defaulted: ${where} ${t.icon ? `"${t.icon}"` : '(none)'} → ${DEFAULT_ICON}`);
    t.icon = DEFAULT_ICON;
  };
  fix(out.cover_options[out.chosen_cover - 1]!, 'cover');
  out.slides.forEach((s, i) => fix(s, `slide ${i + 2}`));
  return { draft: out, dropped };
}

/** checkDraft (structure and IDs), then the M7 text checks C1–C5 on the filled, fixed draft. */
/**
 * A failing IMAGE request no longer kills a story (Tommy, 2026-10-07): on
 * the Writer's final attempt, every request still failing the handoff check
 * becomes none (the slide text is unchanged) and is logged as
 * image-request-dropped. A spread whose first photo is dropped is no longer
 * a spread. The chosen cover with none goes down the finder's cover chain
 * (photo spec §4; its last step always succeeds). A missing EDIT NOTES line
 * for a code-dropped none is only logged.
 */
export function dropFailingImageRequests(d: DraftSubmission, failures: BriefError[]): { draft: DraftSubmission; dropped: string[] } {
  const out = structuredClone(d);
  const dropped: string[] = [];
  for (const f of failures) {
    if (f.section === 'edit_notes') {
      dropped.push(`image-request-dropped (log only): ${f.message}`);
      continue;
    }
    const slide = /^slide (\d+)\.image$/.exec(f.section);
    const option = /^cover_options\[(\d+)\]\.image$/.exec(f.section);
    const img = f.section === 'cover.image' ? out.cover_options[out.chosen_cover - 1]!.image : slide ? out.slides[Number(slide[1]) - 2]?.image : option ? out.cover_options[Number(option[1])]?.image : undefined;
    if (!img || img.kind === 'none') {
      if (img) dropped.push(`image-request-dropped: ${f.section.replace(/\.image$/, '')} stays none (${f.message})`);
      continue;
    }
    dropped.push(`image-request-dropped: ${f.section.replace(/\.image$/, '')} ${img.kind}: ${img.value} → none (${f.message})`);
    img.kind = 'none';
    img.value = '';
    if (slide) out.slides[Number(slide[1]) - 2]!.spread_with_next = false;
  }
  return { draft: out, dropped };
}

export function checkWrittenDraft(
  input: unknown,
  brief: Brief,
  attempt: number,
  stage: 'writer' | 'editor' = 'writer',
  view: PhotoView | null = null,
  final?: { onDropped: (lines: string[]) => void },
): DraftSubmission {
  let d = checkDraft(input, brief);
  const failures = draftTextFailures(fillDraft(d, brief), brief, attempt, stage);
  const errors = failures.map((f) => ({ section: `${f.id} ${f.where}`, message: f.detail }));
  // Every handoff check runs on every attempt, the final one included (Tommy, 2026-10-06).
  if (stage === 'writer') {
    const handoff = imageHandoffFailures(d, brief, view);
    if (final && handoff.length > 0 && errors.length === 0) {
      // Final attempt: drop the failing tags, then the failing requests, instead of failing the story (Tommy, 2026-10-07).
      const t = pruneSubjectTags(d, brief, kindsOf(view));
      const ic = defaultIcons(t.draft);
      const r = dropFailingImageRequests(ic.draft, imageHandoffFailures(ic.draft, brief, view));
      d = checkDraft(r.draft, brief);
      final.onDropped([...t.dropped, ...ic.dropped, ...r.dropped]);
    } else {
      errors.push(...handoff);
    }
  }
  if (errors.length > 0) throw new DraftValidationError(errors);
  return d;
}

const safely = <T,>(fn: () => T[]): T[] => {
  try {
    return fn();
  } catch {
    return [];
  }
};

export async function runWriter(brief: Brief, deps: WriterDeps): Promise<WriterResult> {
  const forWriter = await briefForWriter(brief, deps.isWellKnown, deps.availability, deps.pages ?? []);
  const view = photoViewOf(forWriter, { flags: Boolean(deps.availability) });
  let first: { draft: DraftSubmission; places: string[] } | null = null;
  let imageRequestsDropped: string[] = [];
  const r = await runStructuredCall({
    create: deps.create,
    config: deps.config ?? STAGE_MODELS.writer,
    system: WRITER_SYSTEM,
    tool: SUBMIT_DRAFT_TOOL,
    user: writerUserMessage(forWriter),
    check: (input, attempt) => {
      // Words stay when a photo request fails: remember the first attempt's failed places.
      const kept = attempt > 1 && first ? safely(() => wordsChangedForPhoto(input as DraftSubmission, first!.draft, first!.places)) : [];
      try {
        const final = attempt > MAX_CHECK_RETRIES ? { onDropped: (lines: string[]) => (imageRequestsDropped = lines) } : undefined;
        const d = checkWrittenDraft(input, brief, attempt, 'writer', view, final);
        if (kept.length) throw new DraftValidationError(kept);
        return d;
      } catch (err) {
        if (!(err instanceof DraftValidationError) || err.errors === kept) throw err;
        if (attempt === 1) {
          const places = [...new Set(err.errors.filter((e) => /\.(image|subject_ids)$/.test(e.section)).map((e) => e.section.replace(/\.(image|subject_ids)$/, '')))];
          if (places.length) first = { draft: structuredClone(input as DraftSubmission), places };
        }
        throw kept.length ? new DraftValidationError([...err.errors, ...kept]) : err;
      }
    },
  });
  const common = { costUsd: r.costUsd, turns: r.turns, draftRetries: r.retries, retryErrors: r.retryErrors, turnUsage: r.turnUsage, imageRequestsDropped };
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, raw: r.raw, ...common };
  return { ok: true, draft: r.value, filled: fillDraft(r.value, brief), raw: r.raw, ...common };
}
