/**
 * Writer stage (spec §3, §4; prompts file §2–3): one brief → one draft,
 * submitted through submit_draft, checked in code, quotes and numbers
 * filled by ID. One retry when the check fails (spec §7.1 glitch rule).
 *
 * The call itself (caching, check, one retry) is runStructuredCall.
 */
import { STAGE_MODELS, type StageModelConfig } from '@/lib/social/pipeline/models';
import { NOTHING, type SubjectAvailability } from '@/lib/social/photos/availability';
import type { SubjectType } from '@/lib/social/photos/identity';
import { isNamedIn, namedSubjects, type NamedSubject } from '@/lib/social/photos/named';
import { DEFAULT_ICON, isIcon } from '@/lib/social/render/icons';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import type { Brief, BriefError } from '@/lib/social/reporter/brief';
import type { MessagesCreate, TurnUsage } from '@/lib/social/reporter/reporter';

import { draftTextFailures } from '@/lib/social/mechanical/checks';

import { DraftValidationError, SUBJECT_VISUALS, SUBMIT_DRAFT_TOOL, checkDraft, fillDraft, type DraftSubmission, type FilledDraft, type VisualRequest } from './draft';
import { WRITER_SYSTEM, writerUserMessage } from './prompt';
import { rescueOverLength } from './shorten';
import { MAX_CHECK_RETRIES, runStructuredCall } from './structured-call';

/** Is this subject widely known? Spec §4.1a: yes when it has a Wikidata match. */
export type IsWellKnown = (subject: { name: string; role: string | null }, brief: Brief) => Promise<boolean>;

/**
 * The brief the Writer sees (photo spec §3, §4; Link 1, Tommy 2026-10-07):
 * the Reporter's JSON with code-set marks, so every visual the Writer can ask
 * for is one the search can deliver.
 *   SUBJECTS: well_known (cover rule); type (person / organization: the
 *     identity check's, else the Reporter's mark); headshot_available (a
 *     person's verified main photo); logo_available (an organization's
 *     verified logo; a company's main photo is never offered: logos only,
 *     Tommy, 2026-10-07).
 * ARTICLE PHOTOS are not shown (sixth round): article photos are a source
 * the search tries for every request (photo spec §4), never asked for by URL.
 */
export type WriterSubject = Omit<Brief['subjects'][number], 'type'> & {
  well_known: boolean;
  type: SubjectType | null;
  headshot_available: boolean;
  logo_available: boolean;
};

export type WriterBrief = Omit<Brief, 'subjects' | 'article_photos'> & { subjects: WriterSubject[] };

export async function briefForWriter(brief: Brief, isWellKnown: IsWellKnown, availability?: SubjectAvailability): Promise<WriterBrief> {
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
  const { article_photos: _photos, ...rest } = brief;
  void _photos;
  return { ...rest, subjects };
}

/**
 * What the handoff check needs from the Writer's brief. `subjects` is null
 * when no availability lookup ran (tests): the flags aren't checked then.
 */
export type PhotoView = { subjects: Map<string, WriterSubject> | null; kinds?: SubjectKinds };

export function photoViewOf(b: WriterBrief, opts: { flags: boolean }): PhotoView {
  return { subjects: opts.flags ? new Map(b.subjects.map((s) => [s.name, s])) : null, kinds: new Map(b.subjects.map((s) => [s.name, s.type])) };
}

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
 * every place whose visual request or tags failed on the first attempt keeps
 * its words on the retry.
 */
export function wordsChangedForPhoto(next: DraftSubmission, first: DraftSubmission, failedPlaces: string[]): BriefError[] {
  return failedPlaces.flatMap((where) => {
    const was = textAt(first, where);
    const now = textAt(next, where);
    return was !== null && now !== null && was !== now
      ? [{ section: `${where}`, message: `the words changed after its visual request failed; restore them and change the request instead (never change a slide's words to fit a photo)` }]
      : [];
  });
}

type Place = {
  where: string;
  icon: string | undefined;
  /** 'cover' or the slide type. */
  kind: 'cover' | DraftSubmission['slides'][number]['type'];
  visual: VisualRequest;
  fallback: VisualRequest;
  tags: string[] | undefined;
  /** What the slide shows: headline, body, quote and its speaker, number labels (cover: its text). */
  text: string;
  quoteId: string | null;
};

function placesOf(d: DraftSubmission, brief: Brief): Place[] {
  const chosen = d.cover_options[d.chosen_cover - 1]!;
  return [
    { where: 'cover', icon: chosen.icon, kind: 'cover', visual: chosen.visual, fallback: chosen.fallback_visual, tags: chosen.subject_ids, text: chosen.text, quoteId: null },
    ...d.slides.map((s, i): Place => {
      const q = s.quote_id ? brief.quotes.find((x) => x.id === s.quote_id) : undefined;
      const n = s.number_ids.map((id) => brief.numbers.find((x) => x.id === id)?.counts ?? '').join(' ');
      return {
        where: `slide ${i + 2}`,
        icon: s.icon,
        kind: s.type,
        visual: s.visual,
        fallback: s.fallback_visual,
        tags: s.subject_ids,
        text: [s.headline.text, s.body?.text ?? '', q?.text ?? '', q?.speaker ?? '', n].join(' '),
        quoteId: s.quote_id,
      };
    }),
  ];
}

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

/** A request the code dropped on the final attempt: an empty query; the search skips it. */
export const isDroppedVisual = (v: VisualRequest) => !v.query.trim();

/**
 * One visual request (photo spec §4, tier 1): person, company and logo name
 * a SUBJECTS entry the slide is tagged with, of the right type, with a
 * verified photo when the lookup ran; thematic and setting are plain scenes
 * that name no SUBJECT; product and event are 1–5 words.
 */
function visualFailures(v: VisualRequest, section: string, p: Place, brief: Brief, view: PhotoView | null, typeOf: (name: string) => SubjectType | null): BriefError[] {
  const words = v.query.trim().split(/\s+/).filter(Boolean).length;
  if (v.kind === 'thematic' || v.kind === 'setting') return sceneFailures(v.query, brief, section);
  if (v.kind === 'product' || v.kind === 'event') {
    return words >= 1 && words <= 5 ? [] : [{ section, message: `${v.kind} "${v.query}": name it in 1–5 words${KEEP_WORDS}` }];
  }
  const s = brief.subjects.find((x) => x.name === v.query);
  if (!s) return []; // checkDraft reports a name that isn't in SUBJECTS
  const errors: BriefError[] = [];
  if (!(p.tags ?? []).includes(s.id)) errors.push({ section, message: `${v.kind}: ${s.name} isn't tagged on this slide; ask only for a subject the slide names, or ask for a thematic, setting, product or event visual${KEEP_WORDS}` });
  const type = typeOf(s.name);
  if (v.kind === 'person' && type === 'organization') errors.push({ section, message: `${s.name} is an organization: ask for company: or logo:, not person:${KEEP_WORDS}` });
  if ((v.kind === 'company' || v.kind === 'logo') && type === 'person') errors.push({ section, message: `${s.name} is a person: ask for person:, not ${v.kind}:${KEEP_WORDS}` });
  const ws = view?.subjects?.get(s.name);
  if (ws && v.kind === 'person' && !ws.headshot_available) errors.push({ section, message: `${s.name} has no verified headshot (headshot_available: false); ask for another visual${KEEP_WORDS}` });
  if (ws && v.kind === 'logo' && !ws.logo_available) errors.push({ section, message: `${s.name} has no verified logo (logo_available: false); ask for another visual${KEEP_WORDS}` });
  return errors;
}

/**
 * The Writer's visual requests and subject tags (photo spec §4, sixth round;
 * Tommy 2026-10-07), checked on every attempt. `view` null skips the
 * availability flags (tests without a lookup).
 */
export function visualHandoffFailures(d: DraftSubmission, brief: Brief, view: PhotoView | null): BriefError[] {
  const errors: BriefError[] = [];
  const named = namedSubjects(brief.subjects, kindsOf(view));
  const typeOf = (name: string) => named.find((x) => x.name === name)?.kind ?? null;
  for (const p of placesOf(d, brief)) {
    errors.push(...tagFailures(p, brief, named));
    if (!isIcon(p.icon)) errors.push({ section: `${p.where}.icon`, message: p.icon ? `icon "${p.icon}" isn't on the icon list; pick one from the list` : 'name an icon for this slide, from the icon list' });
    errors.push(...visualFailures(p.visual, `${p.where}.visual`, p, brief, view, typeOf));
    errors.push(...visualFailures(p.fallback, `${p.where}.fallback_visual`, p, brief, view, typeOf));
    // A scene's fallback is a scene too (Lucas, 2026-10-08: a research slide fell back to company: and got the CEO's portrait).
    if (!SUBJECT_VISUALS.has(p.visual.kind) && SUBJECT_VISUALS.has(p.fallback.kind) && p.fallback.query.trim()) {
      errors.push({ section: `${p.where}.fallback_visual`, message: `the visual is ${p.visual.kind}, so the fallback is a thematic, setting, product or event visual too, never ${p.fallback.kind}: (it would put a face or logo on a slide that isn't about them)${KEEP_WORDS}` });
    }
    if (p.visual.kind === p.fallback.kind && p.visual.query.trim().toLowerCase() === p.fallback.query.trim().toLowerCase()) {
      errors.push({ section: `${p.where}.fallback_visual`, message: 'the fallback visual repeats the visual; ask for a different one' });
    }
    // A quote slide's visual is its speaker when the speaker is a person in SUBJECTS with a verified
    // headshot (seventh round: a speaker without one no longer has to be asked for, which the
    // headshot check would then reject; the slide asks for what the quote is about).
    if (p.kind === 'quote') {
      const q = brief.quotes.find((x) => x.id === p.quoteId);
      const speaker = q?.speaker_id ? brief.subjects.find((x) => x.id === q.speaker_id) ?? null : null;
      const ws = speaker ? view?.subjects?.get(speaker.name) : undefined;
      const hasPhoto = ws ? ws.headshot_available : true;
      if (speaker && hasPhoto && typeOf(speaker.name) !== 'organization' && (p.visual.kind !== 'person' || p.visual.query !== speaker.name)) {
        errors.push({ section: `${p.where}.visual`, message: `a quote slide's visual is its speaker (person: ${speaker.name})${KEEP_WORDS}` });
      }
    }
  }
  // The stat-slide cap is gone (seventh round, Lucas 2026-10-08): variety comes from the Writer's
  // rules and Jev's layouts, not a count.
  return errors;
}

/**
 * A scene (a thematic or setting visual): a plain physical scene of 1–6
 * words (seventh round: room for a word that rules out a homonym), tied to the topic but not necessarily named on the slide (Tommy,
 * 2026-10-07: "a circuit board or data centers … a picture of a tree").
 * Never a SUBJECTS name (no people, no companies, no products).
 */
export function sceneFailures(scene: string, brief: Brief, section: string): BriefError[] {
  const words = scene.trim().split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 6) return [{ section, message: `scene "${scene}": a plain physical scene of 2–6 words that can't be misread without the story${KEEP_WORDS}` }];
  const lower = ` ${scene.toLowerCase()} `;
  // The naming rule's spirit (photo spec §3): a full name, or a person's last name.
  const named = brief.subjects.find((s) => {
    const full = s.name.toLowerCase().trim();
    const last = s.type === 'person' ? full.split(/\s+/).pop() : null;
    return lower.includes(` ${full} `) || (!!last && last.length >= 3 && lower.includes(` ${last} `));
  });
  if (named) return [{ section, message: `scene "${scene}" names ${named.name}; a scene never names a person, company or product (it would show someone else's); describe the physical thing instead${KEEP_WORDS}` }];
  return [];
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
  | { ok: true; draft: DraftSubmission; filled: FilledDraft; raw: string; costUsd: number; turns: number; draftRetries: number; retryErrors: string[]; turnUsage: TurnUsage[]; visualsDropped: string[] }
  | { ok: false; reason: 'malformed-output' | 'service-error' | 'refused'; detail: string; raw: string | null; costUsd: number; turns: number; draftRetries: number; retryErrors: string[]; turnUsage: TurnUsage[]; visualsDropped: string[] };

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

/**
 * A failing visual request no longer kills a story (Tommy, 2026-10-07): on
 * the Writer's final attempt, a failing visual is replaced by its fallback
 * when the fallback passes, else dropped (an empty query: the search skips
 * it and the slide ends at its icon), logged as visual-dropped. Words never
 * change.
 */
export function dropFailingVisuals(d: DraftSubmission, failures: BriefError[]): { draft: DraftSubmission; dropped: string[] } {
  const out = structuredClone(d);
  const dropped: string[] = [];
  const failing = new Set(failures.map((f) => f.section));
  const targets = [{ where: 'cover', t: out.cover_options[out.chosen_cover - 1]! }, ...out.slides.map((t, i) => ({ where: `slide ${i + 2}`, t }))];
  for (const { where, t } of targets) {
    const badVisual = failing.has(`${where}.visual`);
    const badFallback = failing.has(`${where}.fallback_visual`);
    if (badVisual && !badFallback) {
      dropped.push(`visual-dropped: ${where} ${t.visual.kind}: ${t.visual.query} → its fallback ${t.fallback_visual.kind}: ${t.fallback_visual.query}`);
      t.visual = { ...t.fallback_visual };
    } else if (badVisual) {
      dropped.push(`visual-dropped: ${where} ${t.visual.kind}: ${t.visual.query} and its fallback → none (icon)`);
      t.visual = { ...t.visual, query: '' };
    }
    if (badFallback) {
      dropped.push(`visual-dropped: ${where} fallback ${t.fallback_visual.kind}: ${t.fallback_visual.query} → none`);
      t.fallback_visual = { ...t.fallback_visual, query: '' };
    }
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
    const handoff = visualHandoffFailures(d, brief, view);
    if (final && handoff.length > 0 && errors.length === 0) {
      // Final attempt: drop the failing tags, then the failing requests, instead of failing the story (Tommy, 2026-10-07).
      const t = pruneSubjectTags(d, brief, kindsOf(view));
      const ic = defaultIcons(t.draft);
      const r = dropFailingVisuals(ic.draft, visualHandoffFailures(ic.draft, brief, view));
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
  const forWriter = await briefForWriter(brief, deps.isWellKnown, deps.availability);
  const view = photoViewOf(forWriter, { flags: Boolean(deps.availability) });
  let first: { draft: DraftSubmission; places: string[] } | null = null;
  let visualsDropped: string[] = [];
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
        const final = attempt > MAX_CHECK_RETRIES ? { onDropped: (lines: string[]) => (visualsDropped = lines) } : undefined;
        const d = checkWrittenDraft(input, brief, attempt, 'writer', view, final);
        if (kept.length) throw new DraftValidationError(kept);
        return d;
      } catch (err) {
        if (!(err instanceof DraftValidationError) || err.errors === kept) throw err;
        if (attempt === 1) {
          const places = [...new Set(err.errors.filter((e) => /\.(visual|fallback_visual|subject_ids)$/.test(e.section)).map((e) => e.section.replace(/\.(visual|fallback_visual|subject_ids)$/, '')))];
          if (places.length) first = { draft: structuredClone(input as DraftSubmission), places };
        }
        throw kept.length ? new DraftValidationError([...err.errors, ...kept]) : err;
      }
    },
  });
  const common = { costUsd: r.costUsd, turns: r.turns, draftRetries: r.retries, retryErrors: r.retryErrors, turnUsage: r.turnUsage, visualsDropped };
  if (!r.ok && r.reason === 'malformed-output') {
    // Lines still over their limit after the retry: one small call shortens them instead of losing the story.
    const rescue = await rescueOverLength(r.raw, deps.create, (input) => checkWrittenDraft(input, brief, MAX_CHECK_RETRIES + 1, 'writer', view, { onDropped: (lines) => (visualsDropped = lines) }));
    const spent = { ...common, costUsd: common.costUsd + rescue.costUsd, turnUsage: [...common.turnUsage, ...rescue.turnUsage], visualsDropped, retryErrors: rescue.note ? [...common.retryErrors, rescue.note] : common.retryErrors };
    if (rescue.value) return { ok: true, draft: rescue.value, filled: fillDraft(rescue.value, brief), raw: JSON.stringify(rescue.value, null, 2), ...spent };
    return { ok: false, reason: r.reason, detail: r.detail, raw: r.raw, ...spent };
  }
  if (!r.ok) return { ok: false, reason: r.reason, detail: r.detail, raw: r.raw, ...common };
  return { ok: true, draft: r.value, filled: fillDraft(r.value, brief), raw: r.raw, ...common };
}
