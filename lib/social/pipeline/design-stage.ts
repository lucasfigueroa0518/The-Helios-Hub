/**
 * The `design` stage for runDay (plan M5 + M6 + M7 photo/render checks): basic photos for the
 * chosen cover and every story slide, then the render Post the local
 * preview draws. Cost is Jev's identity checks only (fractions of a cent);
 * Wikidata, Commons and Openverse are free.
 */
import { createJevTally, jevCostUsd, type JevAsk } from '@/lib/social/jev/client';
import { checkDroppedText, checkPhotoCredit } from '@/lib/social/mechanical/checks';
import { photosForDraft } from '@/lib/social/photos/design';
import type { BankEntry } from '@/lib/social/photos/bank';
import { DESIGNED_GRAPHICS } from '@/lib/social/photos/designed';
import type { IdentityCache } from '@/lib/social/photos/p18';
import { pickCoverStarter } from '@/lib/social/photos/starter-set';
import type { UsedPhotoLog } from '@/lib/social/photos/used-photos';
import type { PhotoDeps } from '@/lib/social/photos/find';
import type { FitCheck } from '@/lib/social/render/fit-check';
import { toRenderPost } from '@/lib/social/render/from-draft';

import type { PipelineStages } from './stages';

/**
 * `fitCheck` is the render-fit check (every element inside the slide);
 * live runs pass `checkRenderFit`, tests a stub. Then the M7 checks that
 * need photos or the render (spec §6):
 *   C6 photo credit / licence / agency → a story slide drops the photo
 *      (text-only); the cover takes the next starter-set photo (logged)
 *   render fit, C7 dropped text → set aside as `render-failed`
 */
export type DesignDeps = PhotoDeps & {
  fitCheck: FitCheck;
  /** The used-photo log (7-day rule) and the bank (designed stat backgrounds); empty when not given (tests). */
  usedLog?: UsedPhotoLog;
  bank?: BankEntry[];
  now?: () => Date;
  /** Identity results per story, shared with the Writer's availability flags. */
  identitiesFor?: (storyId: string) => IdentityCache;
};

export function createDesignStage(deps: DesignDeps): PipelineStages['design'] {
  // Photos picked earlier in this run (Tommy, 2026-10-07: both PREVIEW covers got the same microchip).
  const usedThisRun = new Set<string>();
  return async (draft, brief, story) => {
    const tally = createJevTally();
    const jev: JevAsk = async (req, meta) => {
      const res = await deps.jev(req, meta);
      tally.costUsd += jevCostUsd(res.usage);
      return res;
    };
    const now = deps.now?.() ?? new Date();
    // The used-photo check: the last 7 days (the log) plus every photo picked earlier in this run.
    const recent = new Set([...(deps.usedLog ? await deps.usedLog.recent(now) : []), ...usedThisRun]);
    const lastUsed = deps.usedLog ? await deps.usedLog.lastUsed() : new Map<string, string>();
    const photos = await photosForDraft(draft.filled, brief.parsed, brief.pages, { ...deps, jev }, { recent, bank: deps.bank ?? [], lastUsed, identities: deps.identitiesFor?.(draft.storyId) });
    // C6: never ship a photo without an allowed, credited licence.
    const traces = [photos.cover, ...photos.slides];
    const used = new Set([...recent, ...traces.flatMap((t) => (t.photo ? [t.photo.url] : []))]);
    const photoReplacements: string[] = [];
    for (const [i, t] of traces.entries()) {
      const failures = t.photo ? checkPhotoCredit(t.photo, i === 0 ? 'cover' : `slide ${i + 1}`, brief.parsed) : [];
      if (failures.length === 0) continue;
      // Story slides drop the photo (text-only); the cover takes a starter photo (the starter set is cover-only).
      if (i > 0) {
        photoReplacements.push(`C6 ${failures[0]!.where}: ${failures.map((f) => f.detail).join('; ')} → text-only`);
        t.steps.push(`C6 dropped: ${failures.map((f) => f.detail).join('; ')} → text-only`);
        t.photo = null;
        t.via = 'text-only';
        continue;
      }
      // The cover's last step (spec §5.1 Photo chain v1): the branded cover card once approved, else an AI-compute starter photo.
      if ((deps.designed ?? DESIGNED_GRAPHICS).coverCard) {
        photoReplacements.push(`C6 ${failures[0]!.where}: ${failures.map((f) => f.detail).join('; ')} → branded cover card`);
        t.steps.push(`C6 replaced: ${failures.map((f) => f.detail).join('; ')} → branded cover card`);
        t.photo = null;
        t.via = 'cover-card';
        continue;
      }
      const starter = pickCoverStarter(used).photo;
      used.add(starter.url);
      photoReplacements.push(`C6 ${failures[0]!.where}: ${failures.map((f) => f.detail).join('; ')} → ${starter.url}`);
      t.steps.push(`C6 replaced: ${failures.map((f) => f.detail).join('; ')} → starter set ${starter.url}`);
      t.photo = starter;
      t.via = 'starter';
    }
    const render = toRenderPost(
      draft.filled,
      { cover: photos.cover.photo, slides: photos.slides.map((t) => t.photo), coverCard: photos.cover.via === 'cover-card' },
      { source: brief.parsed.sources[0]?.outlet ?? story.outlets[0] ?? '', sourceUrl: brief.parsed.sources[0]?.url ?? story.url, publishedAt: story.publishedAt.toISOString() },
    );
    const fit = await deps.fitCheck(render);
    if (!fit.ok) {
      const detail = [...fit.problems, ...fit.violations.map((v) => `slide ${v.slide} ${v.element} outside the slide (${JSON.stringify(v.over)}): "${v.text}"`)].join('; ');
      return { ok: false, reasonCode: 'render-failed', detail, costUsd: tally.costUsd };
    }
    // M8b: keep the face-centred crops the check chose, so the preview draws the same thing.
    for (const f of fit.focus ?? []) {
      const sl = render.slides[f.slide - 1];
      if (f.focus && sl && sl.photoUrl === f.photo) sl.photoFocus = f.focus;
    }
    // C7: every text field of the final draft is on its rendered slide.
    const dropped = checkDroppedText(draft.filled, fit.slideText);
    if (dropped.length > 0) {
      return { ok: false, reasonCode: 'render-failed', detail: dropped.map((f) => `C7 ${f.where}: ${f.detail}`).join('; '), costUsd: tally.costUsd };
    }
    for (const t of traces) if (t.photo) usedThisRun.add(t.photo.url);
    return {
      ok: true,
      value: {
        storyId: draft.storyId,
        title: draft.filled.cover,
        render,
        photos: traces,
        checks: { fixes: draft.mechanical?.fixes ?? [], warnings: draft.mechanical?.warnings ?? [], photoReplacements },
        stages: [],
        costUsd: tally.costUsd,
      },
      costUsd: tally.costUsd,
    };
  };
}
