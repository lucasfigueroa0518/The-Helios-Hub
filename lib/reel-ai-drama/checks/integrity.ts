import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import { loadPrompt } from '@/lib/reel-ai-drama/prompts';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Asset, DirectorPlan, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { runSubmit, type Ledger, type SendMessage } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_LOOKS_TOOL } from '@/lib/reel-ai-drama/writing/schemas';
import { isCharacterImage } from '@/lib/reel-ai-drama/writing/validate';

/**
 * C2, the integrity check (MD-39): each image shows what its line claims, and every used asset has a
 * source and credit. Code checks the records; Haiku looks at the pictures, a few per call. Only a
 * clear "no" or a disqualifier is a problem; "unsure" passes (checks fail open; one fix, then warn).
 */

export type ImageData = { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' };

export type IntegrityDeps = Ledger & {
  create: SendMessage;
  /** The job dir that asset `file` paths are relative to. */
  jobDir: string;
  settings?: ReelAiDramaSettings;
  root?: string;
  /** Reads and downsizes one asset for the look; defaults to `readImageForLook`. */
  readImage?: (file: string) => Promise<ImageData>;
  /** Images per Haiku call. */
  batchSize?: number;
};

export type IntegrityProblem = { frame: number; asset_id: string; why: string };

const LOOK_EDGE = 768;

/** A JPEG no larger than LOOK_EDGE on its long side: plenty for "who and what is this", and cheap. */
export async function readImageForLook(file: string): Promise<ImageData> {
  const buf = await sharp(await readFile(file)).rotate().resize(LOOK_EDGE, LOOK_EDGE, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return { data: buf.toString('base64'), mediaType: 'image/jpeg' };
}

/** Record checks that need no model: the asset exists and carries a source and a credit. */
export function recordProblems(plan: DirectorPlan, inventory: VisualsInventory): IntegrityProblem[] {
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const out: IntegrityProblem[] = [];
  for (const f of plan.frames) {
    for (const id of f.asset_ids) {
      const a = byId.get(id);
      if (!a) out.push({ frame: f.n, asset_id: id, why: `${id} is not in the inventory.` });
      else if (!a.made && !a.credit?.trim()) out.push({ frame: f.n, asset_id: id, why: `${id} has no credit recorded.` });
      else if (!a.made && !a.url && !a.source_page) out.push({ frame: f.n, asset_id: id, why: `${id} has no source recorded.` });
    }
  }
  return out;
}

/** `otherUses`: the image's other frames and their purposes, when it is not a person's character image (MD-41, MD-46). */
type LookItem = { frame: number; asset: Asset; claim: string; onScreen: string; purpose: string; otherUses: { frame: number; purpose: string }[] };

/**
 * One item per (frame, asset): the same image is judged against each line it plays under. An image other
 * than a character image that appears in more than one frame carries its other uses, so the look can
 * judge "one image, one job" (it may repeat only when it says the same thing again).
 */
export function lookItems(plan: DirectorPlan, inventory: VisualsInventory, draft: WriterDraft): LookItem[] {
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const lines = new Map(draft.rungs.flatMap((r) => r.lines).map((l) => [l.id, l]));
  const items: LookItem[] = [];
  for (const f of plan.frames) {
    if (f.treatment === 'close') continue;
    const claim = f.line_ids.map((id) => lines.get(id)?.text ?? '').join(' ').trim();
    const onScreen = [f.on_screen, ...f.line_ids.map((id) => lines.get(id)?.on_screen ?? null)].filter(Boolean).join(' / ');
    for (const id of f.asset_ids) {
      const asset = byId.get(id);
      if (!asset) continue;
      // A character image or a main character's anchor recurs as their presence: one job (MD-41, MD-60).
      const otherUses = isCharacterImage(asset) || asset.anchor_for ? [] : plan.frames.filter((g) => g.n !== f.n && g.asset_ids.includes(id)).map((g) => ({ frame: g.n, purpose: g.purpose }));
      items.push({ frame: f.n, asset, claim, onScreen, purpose: f.purpose, otherUses });
    }
  }
  return items;
}

type Look = { image: number; sees: string; matches: 'yes' | 'no' | 'unsure'; disqualified: boolean; why: string };

function parseLooks(count: number) {
  return (raw: unknown) => {
    const looks = (raw as { looks?: Look[] })?.looks;
    if (!Array.isArray(looks)) return { value: null, problems: ['looks is missing'] };
    const seen = new Set(looks.map((l) => l.image));
    const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !seen.has(n));
    return { value: looks, problems: missing.length ? [`no look for image ${missing.join(', ')}`] : [] };
  };
}

export async function checkIntegrity(
  deps: IntegrityDeps,
  input: { plan: DirectorPlan; inventory: VisualsInventory; draft: WriterDraft },
): Promise<{ problems: IntegrityProblem[] }> {
  const settings = deps.settings ?? DEFAULT_SETTINGS;
  const read = deps.readImage ?? ((file: string) => readImageForLook(path.join(deps.jobDir, file)));
  const problems = recordProblems(input.plan, input.inventory);
  const items = lookItems(input.plan, input.inventory, input.draft);
  const size = Math.max(1, deps.batchSize ?? 8);
  const system = loadPrompt('integrity', deps.root);

  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, start + size);
    const content: Anthropic.ContentBlockParam[] = [];
    for (const [i, item] of batch.entries()) {
      const img = await read(item.asset.file);
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
      content.push({
        type: 'text',
        text: `Image ${i + 1}. Narration over it: "${item.claim}"${item.onScreen ? `. On screen: "${item.onScreen}"` : ''}. Recorded as showing: "${item.asset.shows}"${item.asset.date_taken ? ` (dated ${item.asset.date_taken}, ${item.asset.date_confidence})` : ''}${item.asset.made ? `; a made visual (${item.asset.made_kind ?? 'drawing, map, screenshot or graphic'})` : ''}${item.asset.anchor_for ? `; the anchor image of ${item.asset.anchor_for}` : ''}.${item.otherUses.length ? ` Its job here: "${item.purpose}". The same image is also used in ${item.otherUses.map((u) => `frame ${u.frame} ("${u.purpose}")`).join(', ')}.` : ''}`,
      });
    }
    const result = await runSubmit(deps.create, deps, {
      component: 'integrity_check',
      model: settings.vision_model,
      system,
      user: content,
      tool: SUBMIT_LOOKS_TOOL,
      maxTokens: 8_000,
      parse: parseLooks(batch.length),
    });
    for (const look of result.value) {
      const item = batch[look.image - 1];
      if (!item) continue;
      if (look.matches === 'no' || look.disqualified) {
        problems.push({ frame: item.frame, asset_id: item.asset.id, why: look.why?.trim() || `${item.asset.id} doesn't show what its line claims (it shows: ${look.sees}).` });
      }
    }
  }
  return { problems };
}
