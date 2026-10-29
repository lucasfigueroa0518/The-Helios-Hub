import fs from 'node:fs';
import path from 'node:path';

import { isClose, parseFrames } from '@/explainers/reel-ai-drama/kit/frames.mjs';
import type { Asset, DirectorPlan, StoryboardFrame, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';

/**
 * Pure edits on the locked script and the shot plan: the facts check's cut (MD-39: a claim still
 * unsupported after its fix is cut, never shipped), the re-validation after it, and the plan kept in
 * step with the script.
 */

export const lineIds = (draft: WriterDraft): string[] => draft.rungs.flatMap((r) => r.lines.map((l) => l.id));

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Remove lines; drop rungs left empty; keep the hook, turn and landing pointing at lines that exist.
 * A cut hook line takes its on-screen words with it (they promised the cut claim); the landing passes to
 * the last rung that remains, so the final line keeps its role.
 */
export function cutLines(draft: WriterDraft, cut: readonly string[]): WriterDraft {
  const gone = new Set(cut);
  const order = draft.rungs.map((r) => r.id);
  const rungs = draft.rungs.map((r) => ({ ...r, lines: r.lines.filter((l) => !gone.has(l.id)) })).filter((r) => r.lines.length > 0);
  const kept = new Set(rungs.map((r) => r.id));
  // A cut rung hands its role to the nearest rung after it (else before it).
  const nearest = (id: string): string => {
    if (kept.has(id)) return id;
    const at = order.indexOf(id);
    const after = order.slice(at + 1).find((x) => kept.has(x));
    const before = order.slice(0, Math.max(0, at)).reverse().find((x) => kept.has(x));
    return after ?? before ?? id;
  };
  const first = rungs[0]?.lines[0]?.id ?? draft.hook.line_id;
  return {
    ...draft,
    rungs,
    turn_rung_id: nearest(draft.turn_rung_id),
    landing_rung_id: nearest(draft.landing_rung_id),
    hook: gone.has(draft.hook.line_id) ? { on_screen: '', line_id: first } : draft.hook,
    word_count: rungs.reduce((n, r) => n + r.lines.reduce((m, l) => m + words(l.text), 0), 0),
  };
}

/** Problems that make a draft unusable for the build (each one sentence). Empty means it's valid. */
export function draftProblems(draft: WriterDraft): string[] {
  const out: string[] = [];
  const ids = lineIds(draft);
  if (ids.length === 0) return ['The script has no lines left.'];
  if (new Set(ids).size !== ids.length) out.push('The script repeats a line id.');
  const rungIds = new Set(draft.rungs.map((r) => r.id));
  if (!ids.includes(draft.hook.line_id)) out.push(`The hook points at a missing line (${draft.hook.line_id}).`);
  if (!rungIds.has(draft.turn_rung_id)) out.push(`The turn points at a missing rung (${draft.turn_rung_id}).`);
  if (!rungIds.has(draft.landing_rung_id)) out.push(`The landing points at a missing rung (${draft.landing_rung_id}).`);
  if (!draft.close_question?.trim()) out.push('The script has no closing question.');
  for (const r of draft.rungs) for (const l of r.lines) if (!l.text.trim()) out.push(`Line ${l.id} is empty.`);
  return out;
}

/**
 * Keep the plan in step with the script: drop line ids the script no longer has, drop frames left
 * without lines (a frame that never had lines, like the close, stays), give an uncovered line to the
 * frame holding the line before it, and renumber.
 */
export function reconcilePlan(draft: WriterDraft, plan: DirectorPlan): DirectorPlan {
  const ids = lineIds(draft);
  const known = new Set(ids);
  let frames: StoryboardFrame[] = plan.frames
    .map((f) => ({ ...f, line_ids: f.line_ids.filter((id) => known.has(id)), _had: f.line_ids.length > 0 }))
    .filter((f) => !f._had || f.line_ids.length > 0)
    .map(({ _had, ...f }) => f);
  const covered = new Set(frames.flatMap((f) => f.line_ids));
  for (const [i, id] of ids.entries()) {
    if (covered.has(id)) continue;
    const prev = ids.slice(0, i).reverse().find((p) => covered.has(p));
    const host = prev ? frames.find((f) => f.line_ids.includes(prev)) : frames.find((f) => f.line_ids.length > 0) ?? frames[0];
    if (!host) continue;
    if (prev) host.line_ids.splice(host.line_ids.indexOf(prev) + 1, 0, id);
    else host.line_ids.unshift(id);
    covered.add(id);
  }
  frames = frames.map((f, i) => ({ ...f, n: i + 1 }));
  return { ...plan, frames };
}

/** Line ids whose words changed between two drafts (text or label) and still exist in the later one. */
export function changedLineIds(before: WriterDraft, after: WriterDraft): string[] {
  const old = new Map(before.rungs.flatMap((r) => r.lines.map((l) => [l.id, l] as const)));
  return after.rungs.flatMap((r) => r.lines).filter((l) => {
    const o = old.get(l.id);
    return !o || o.text !== l.text || (o.on_screen ?? null) !== (l.on_screen ?? null) || (o.must_show ?? null) !== (l.must_show ?? null);
  }).map((l) => l.id);
}

/** Clear frame-level words equal to `words` (the cut hook's), so no frame keeps a promise the script dropped. */
export function clearFrameWords(plan: DirectorPlan, words: string): DirectorPlan {
  const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return { ...plan, frames: plan.frames.map((f) => (norm(f.on_screen) && norm(f.on_screen) === norm(words) ? { ...f, on_screen: null } : f)) };
}

/**
 * How long the close question is voiced, in seconds, from the project's audio_meta.json after the voice
 * step (the close is the last storyboard frame); null when there is no voice record (stubbed runs).
 */
export function closeVoiceSeconds(projectDir: string): number | null {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(projectDir, 'audio_meta.json'), 'utf8')) as { voices?: { frame?: number | string; duration_s?: number }[] };
    const close = parseFrames(fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8')).filter((f) => isClose(f)).pop()?.number;
    if (close === undefined) return null;
    const voice = (meta.voices ?? []).find((v) => Number(v.frame) === close);
    return typeof voice?.duration_s === 'number' && voice.duration_s > 0 ? Math.round(voice.duration_s * 100) / 100 : null;
  } catch {
    return null;
  }
}

/** The director's answer for the flagged frames replaces only those frames (C2's one fix). */
export function mergeFrames(plan: DirectorPlan, fixed: DirectorPlan, flagged: readonly number[]): DirectorPlan {
  const want = new Set(flagged);
  // Makes the re-planned frames ask for join the plan's; an id the plan already has keeps the plan's brief.
  const have = new Set((plan.makes ?? []).map((m) => m.id));
  const makes = [...(plan.makes ?? []), ...(fixed.makes ?? []).filter((m) => !have.has(m.id))];
  return { ...plan, frames: plan.frames.map((f) => (want.has(f.n) ? fixed.frames.find((g) => g.n === f.n) ?? f : f)), makes, lines_back: [] };
}

/** The asset key the 20-day rule reads (schema: the perceptual hash when known, else the source URL). */
export function assetKey(a: Asset, jobId: string): string {
  return a.phash ?? a.url ?? `${jobId}:${a.file}`;
}

/** The assets the final plan shows, once each, with the first frame that shows them. */
export function usedAssets(plan: DirectorPlan, inventory: VisualsInventory): { asset: Asset; frame: StoryboardFrame }[] {
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const out: { asset: Asset; frame: StoryboardFrame }[] = [];
  for (const f of plan.frames) {
    for (const id of f.asset_ids) {
      const asset = byId.get(id);
      if (!asset || seen.has(id)) continue;
      seen.add(id);
      out.push({ asset, frame: f });
    }
  }
  return out;
}

/** What the captions say, frame by frame, for the first viewer when the kit gives no transcript. */
export function captionsText(draft: WriterDraft, plan: DirectorPlan): string {
  const text = new Map(draft.rungs.flatMap((r) => r.lines.map((l) => [l.id, l] as const)));
  const out = plan.frames.map((f) => {
    const spoken = f.line_ids.map((id) => text.get(id)?.text ?? '').filter(Boolean).join(' ');
    const shown = f.on_screen ? ` [on screen: ${f.on_screen}]` : '';
    return `${f.n}. ${spoken}${shown}`.trim();
  });
  out.push(`close. ${draft.close_question}`);
  return out.join('\n');
}
