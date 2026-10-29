import fs from 'node:fs';
import path from 'node:path';

import { seedKind, seedSvg } from '@/explainers/reel-ai-drama/kit/settings/index.js';
import { priceImageUsage, type ImageUsage } from '@/lib/reels/visual/image';
import type { Asset, DirectorPlan, MakeRequest, StoryboardFrame, VisualKind, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { CHARACTER_TREATMENTS, type Treatment } from '@/lib/reel-ai-drama/writing/schemas';
import { isCharacterImage, isLogo } from '@/lib/reel-ai-drama/writing/validate';

/**
 * The director's make requests turned into assets (MD-59, MD-14): each MakeRequest becomes an Asset whose
 * id is its M-id, `made: true`, with its `made_kind`.
 *   - a seed (an exact match with a seeded setting, expression or collage layer): the kit's code-built SVG,
 *     written as the file; free.
 *   - an expression sketch: traced by the image model from the person's picture (from_assets, else their
 *     anchor, else any portrait of them), in marker line style with the expression the brief asks for.
 *   - a drawing, a setting or a collage layer: drawn by the image model to the brief (a drawing traces
 *     from_assets when it names a picture). Always drawn, never photoreal.
 * Fails open per request: a failed make becomes a problem string, and `planWithoutFailedMakes` puts the
 * frame back on existing assets. No Claude call here; the image model's spend is returned and, when
 * `deps.record` is given, recorded per call.
 */

export const MAKE_MODEL = 'gpt-image-2';
export const MAKE_QUALITY = 'medium';
/** Portrait for a setting (it fills the 9:16 frame); square for everything else. */
export const MAKE_SIZE: Record<MakeRequest['kind'], string> = { setting: '1024x1536', expression: '1024x1024', drawing: '1024x1024', collage: '1024x1024' };
/** What one image-model make is assumed to cost before it runs (medium quality, with a reference). */
export const MAKE_ESTIMATE_USD = 0.08;
export const MAKE_MAX_USD = 0.8;
export const MAKE_CONCURRENCY = 3;

export type GenerateImage = (req: { prompt: string; reference?: string; size: string }) => Promise<{ png: Buffer; usage: ImageUsage }>;

export type MakeDeps = {
  /** The image model (default: the live OpenAI call). Tests inject a stub. */
  generate?: GenerateImage;
  /** Spend ceiling for the image model in this call (default MAKE_MAX_USD); makes past it fail open. */
  maxUsd?: number;
  /** Records one image-model call (bind it to recordCost with the job id). */
  record?: (e: { component: 'make'; vendor: 'openai'; usd: number; make: string }) => Promise<void>;
};

// ── Prompts (one drawn style per kind) ────────────────────────────────────

const MARKER = [
  'A line drawing in black dry-erase marker on a plain white background, the way a good illustrator sketches on a whiteboard.',
  'Hard constraints:',
  '- Black marker lines only, confident single-weight strokes about 8 px thick; no shading, no grey fills, no colour.',
  '- No text, letters, numbers, logos or labels anywhere.',
  '- Plain white background with nothing else drawn (no ground line, no frame, no scenery) unless the subject below asks for it.',
  '- It reads unmistakably as a drawing, never as a photograph.',
].join('\n');

const SET = [
  'An illustrated stage set for a documentary, drawn in ink lines with flat, muted colour washes (warm browns, slate blues, a little amber light), like a graphic-novel background.',
  'Hard constraints:',
  '- It reads unmistakably as a drawing, never as a photograph: visible ink outlines, flat colour, no photographic texture.',
  '- The place is empty: no people, no figures, no faces, no silhouettes. Leave clear spots (chairs, a floor, a table edge) where figures will be placed later.',
  '- No text, letters, numbers, logos or signs anywhere.',
  '- Seen front-on at eye level. The top quarter of the picture is dark and plain (a wall or ceiling in shadow).',
].join('\n');

const PAPER = [
  'A single cut-paper collage element on a plain white background: flat paper with visible torn or cut edges and a little paper grain.',
  'Hard constraints:',
  '- It reads unmistakably as made: paper, ink and print texture, never a photograph.',
  '- No real people, no faces, no text, letters, numbers or logos.',
  '- One element, whole, centred, filling about 80% of the square, nothing else around it.',
].join('\n');

export function makePrompt(m: MakeRequest, hasReference: boolean): string {
  const brief = m.brief.trim();
  if (m.kind === 'expression') {
    return `${MARKER}\n\nSubject: the person in the reference photo, head and shoulders, drawn as a lively marker sketch with this expression and gesture: ${brief}. Keep the features that make them recognisable (face shape, hairline, glasses if any) in a few lines, and make the expression read at a glance. Draw only the person, never the photo's background.`;
  }
  if (m.kind === 'drawing') {
    return `${MARKER}\n\nSubject: ${brief}.${hasReference ? ' Draw it from the reference picture, keeping what makes it recognisable; draw only the subject, never the picture\'s background.' : ''}`;
  }
  if (m.kind === 'setting') return `${SET}\n\nThe place: ${brief}.`;
  return `${PAPER}\n\nThe element: ${brief}.`;
}

// ── The live generator (pattern copied from the real-case drawing generator, not imported) ─────────

type ImagesResponse = {
  data?: Array<{ b64_json?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
  error?: { message?: string };
};

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** images/generations without a reference, images/edits with one. */
export const generateMakeImage: GenerateImage = async ({ prompt, reference, size }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');
  let response: Response;
  if (reference) {
    const form = new FormData();
    form.append('model', MAKE_MODEL);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('quality', MAKE_QUALITY);
    form.append('n', '1');
    const type = MIME[path.extname(reference).toLowerCase()] ?? 'image/png';
    form.append('image', new Blob([fs.readFileSync(reference)], { type }), `reference${path.extname(reference) || '.png'}`);
    response = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', signal: AbortSignal.timeout(240_000), headers: { authorization: `Bearer ${apiKey}` }, body: form });
  } else {
    response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal: AbortSignal.timeout(240_000),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MAKE_MODEL, prompt, size, quality: MAKE_QUALITY, output_format: 'png', n: 1 }),
    });
  }
  const body = (await response.json().catch(() => null)) as ImagesResponse | null;
  if (!response.ok) throw new Error(body?.error?.message ?? `Image make failed (${response.status}).`);
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error('The image model returned no image.');
  const u = body?.usage ?? {};
  const textInputTokens = u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0;
  const imageInputTokens = u.input_tokens_details?.image_tokens ?? 0;
  const imageOutputTokens = u.output_tokens ?? 0;
  return { png: Buffer.from(b64, 'base64'), usage: { textInputTokens, imageInputTokens, imageOutputTokens, usd: priceImageUsage({ textInputTokens, imageInputTokens, imageOutputTokens }) } };
};

// ── Assets ────────────────────────────────────────────────────────────────

const KIND_OF: Record<MakeRequest['kind'], VisualKind> = { setting: 'place_photo', expression: 'person_photo', drawing: 'object', collage: 'paper' };

const SHOWS: Record<MakeRequest['kind'], string> = {
  setting: 'A drawn illustration of an empty setting, made for this reel (not a photograph)',
  expression: 'A marker sketch, made for this reel (a drawing, not a photograph)',
  drawing: 'A marker drawing, made for this reel (not a photograph)',
  collage: 'A cut-paper collage element, made for this reel (not a photograph)',
};

function madeAsset(m: MakeRequest, file: string, size: { width: number; height: number }, extra: { flags: string[]; credit: string }): Asset {
  return {
    id: m.id,
    kind: KIND_OF[m.kind],
    file,
    url: null,
    source_page: null,
    credit: extra.credit,
    license: null,
    shows: `${SHOWS[m.kind]}: ${m.brief.trim()}`,
    people: [...(m.people ?? [])],
    qids: [],
    place: null,
    date_taken: null,
    date_confidence: 'unknown',
    width: size.width,
    height: size.height,
    phash: null,
    character_image: false,
    made: true,
    upscaled: false,
    flags: ['made', `made:${m.kind}`, ...(m.from_assets ?? []).map((a) => `from:${a}`), ...extra.flags],
    anchor_for: null,
    face: null,
    made_kind: m.kind,
  };
}

/** The picture an expression sketch or drawing traces: from_assets first, then the person's anchor, then any portrait. */
export function referenceFor(m: MakeRequest, inventory: VisualsInventory): Asset | null {
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  for (const id of m.from_assets ?? []) {
    const a = byId.get(id);
    if (a && !isLogo(a)) return a;
  }
  if (m.kind === 'drawing' && !(m.people ?? []).length) return null;
  for (const p of m.people ?? []) {
    const anchor = inventory.assets.find((a) => a.anchor_for === p);
    if (anchor) return anchor;
    const any = inventory.assets.find((a) => a.people.includes(p) && !isLogo(a) && (a.kind === 'person_photo' || isCharacterImage(a)));
    if (any) return any;
  }
  return null;
}

const pngSize = (png: Buffer) =>
  png.length > 24 && png.readUInt32BE(12) === 0x49484452 ? { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } : null;

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const run = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

export async function makeAssets(
  input: { plan: DirectorPlan; inventory: VisualsInventory; jobDir: string; draft: WriterDraft },
  deps: MakeDeps = {},
): Promise<{ assets: Asset[]; usd: number; problems: string[] }> {
  const makes = input.plan.makes ?? [];
  const mediaDir = path.join(input.jobDir, 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  const generate = deps.generate ?? generateMakeImage;
  const maxUsd = deps.maxUsd ?? MAKE_MAX_USD;
  const made = new Map<string, Asset>();
  const problems: string[] = [];
  let usd = 0;
  let committed = 0;
  const generated: MakeRequest[] = [];

  for (const m of makes) {
    if (m.seed) {
      if (seedKind(m.seed) === m.kind) {
        const s = seedSvg(m.seed);
        const file = path.join('media', `${m.id}.svg`);
        fs.writeFileSync(path.join(input.jobDir, file), s.svg);
        made.set(m.id, madeAsset(m, file, s, { flags: [`seed:${m.seed}`], credit: 'Illustration: Helios' }));
        continue;
      }
      problems.push(`${m.id}: "${m.seed}" is not a seeded ${m.kind}; made to the brief instead`);
    }
    generated.push(m);
  }

  await pool(generated, MAKE_CONCURRENCY, async (m) => {
    let held = 0;
    try {
      const ref = m.kind === 'expression' || m.kind === 'drawing' ? referenceFor(m, input.inventory) : null;
      if (m.kind === 'expression' && !ref) throw new Error('no picture of the person to trace');
      const refPath = ref ? path.resolve(input.jobDir, ref.file) : undefined;
      if (refPath && !fs.existsSync(refPath)) throw new Error(`the reference ${ref!.id} has no file`);
      if (committed + MAKE_ESTIMATE_USD > maxUsd + 1e-9) throw new Error(`over the make budget ($${maxUsd.toFixed(2)})`);
      committed += MAKE_ESTIMATE_USD;
      held = MAKE_ESTIMATE_USD;
      const out = await generate({ prompt: makePrompt(m, Boolean(refPath)), reference: refPath, size: MAKE_SIZE[m.kind] });
      usd += out.usage.usd;
      committed += out.usage.usd - MAKE_ESTIMATE_USD;
      held = 0;
      await deps.record?.({ component: 'make', vendor: 'openai', usd: out.usage.usd, make: m.id }).catch(() => undefined);
      const file = path.join('media', `${m.id}.png`);
      fs.writeFileSync(path.join(input.jobDir, file), out.png);
      const [w, h] = MAKE_SIZE[m.kind].split('x').map(Number);
      const credit = ref ? `Illustration by Helios, drawn from: ${ref.credit}` : 'Illustration: Helios';
      made.set(m.id, madeAsset(m, file, pngSize(out.png) ?? { width: w, height: h }, { flags: ref ? [`traced_from:${ref.id}`] : [], credit }));
    } catch (err) {
      committed -= held;
      problems.push(`${m.id} (${m.kind}) was not made: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Keep the plan's order whatever order the pool finished in.
  const assets = makes.map((m) => made.get(m.id)).filter((a): a is Asset => Boolean(a));
  return { assets, usd: Math.round(usd * 10000) / 10000, problems };
}

// ── Fail open: frames that used a failed make go back to existing assets ─────────

/**
 * Put each frame that used a make which wasn't made back on existing assets: the make's first source
 * (from_assets), else (a sketch or drawing of a person) that person's anchor; a tableau that lost a made setting becomes a
 * collision (two people) or a cutout_lift (one), a frame left holding a character image outside the
 * staging treatments becomes a cutout_lift, and a frame left with no asset at all becomes a photo of the
 * fallback. Returns the new plan and one note per change (for the delivery flags).
 */
export function planWithoutFailedMakes(plan: DirectorPlan, madeIds: Iterable<string>, inventory: VisualsInventory): { plan: DirectorPlan; notes: string[] } {
  const ok = new Set(madeIds);
  const failed = new Map((plan.makes ?? []).filter((m) => !ok.has(m.id)).map((m) => [m.id, m]));
  if (!failed.size) return { plan, notes: [] };
  const byId = new Map(inventory.assets.map((a) => [a.id, a]));
  const notes: string[] = [];
  // A sketch or drawing of a person falls back to their picture; a setting or collage element only to its
  // own sources (the people staged in it are already in the frame as cutouts).
  const fallbackFor = (m: MakeRequest): string | null =>
    (m.from_assets ?? []).find((a) => byId.has(a)) ??
    (m.kind === 'expression' || m.kind === 'drawing' ? (m.people ?? []).map((p) => inventory.assets.find((a) => a.anchor_for === p)?.id).find(Boolean) ?? null : null);

  const frames = plan.frames.map((f): StoryboardFrame => {
    const lost = f.asset_ids.filter((a) => failed.has(a));
    if (!lost.length) return f;
    let ids: string[] = [];
    const swap = new Map<string, string | null>();
    for (const a of f.asset_ids) {
      const m = failed.get(a);
      if (!m) { if (!ids.includes(a)) ids.push(a); continue; }
      const fb = fallbackFor(m);
      swap.set(a, fb);
      if (fb && !ids.includes(fb)) ids.push(fb);
    }
    ids = ids.filter((a) => byId.has(a) || ok.has(a));
    const shows = (f.shows ?? []).flatMap((sh) => {
      if (!swap.has(sh.asset_id)) return [sh];
      const to = swap.get(sh.asset_id);
      return to ? [{ ...sh, asset_id: to }] : [];
    });
    let treatment = f.treatment;
    const people = ids.map((a) => byId.get(a)).filter((a): a is Asset => Boolean(a && isCharacterImage(a)));
    const lostSetting = lost.some((a) => failed.get(a)!.kind === 'setting');
    if (treatment === 'tableau' && lostSetting) treatment = people.length >= 2 ? 'collision' : people.length === 1 ? 'cutout_lift' : 'photo';
    if (people.length && !CHARACTER_TREATMENTS.includes(treatment as Treatment)) treatment = 'cutout_lift';
    if (!ids.length && treatment !== 'whiteboard' && treatment !== 'board' && treatment !== 'newspaper') treatment = 'photo';
    notes.push(`frame ${f.n}: ${lost.join(', ')} could not be made; it uses ${ids.join(', ') || 'no asset'}${treatment !== f.treatment ? ` as a ${treatment}` : ''} instead`);
    return { ...f, asset_ids: ids, shows: shows.map((sh) => ({ ...sh, treatment: sh.treatment === f.treatment ? treatment : sh.treatment })), treatment };
  });
  return { plan: { ...plan, frames, makes: (plan.makes ?? []).filter((m) => ok.has(m.id)) }, notes };
}
