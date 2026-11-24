/**
 * Vertical-fit for Morning Download (IG Story, 1080×1920), 2026-11-23. Lab first; the pure parts are production-ready.
 *
 * A model says WHAT must stay visible (a box around the picture's essential content); code does the geometry:
 * - if that box fits inside a full-height 9:16 window, the photo is cropped to vertical around it;
 * - otherwise the whole photo is placed in the middle, over a scaled-up, blurred copy of itself.
 *
 *   npx tsx scripts/story-crop.ts pick                 choose the test photos (free)
 *   npx tsx scripts/story-crop.ts ask jev|haiku --yes  ask the model (Jev: box + yes/no; Haiku: yes/no + box)
 *   npx tsx scripts/story-crop.ts render <who><TAG>     render every test photo with that method's decisions (free)
 */
import fs from 'node:fs';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { box, image, noul, TypeSafeClient, type Questions } from '@typesafe-ai/sdk';
import sharp from 'sharp';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { jevCostUsd } from '@/lib/social/jev/client';

export const STORY_W = 1080;
export const STORY_H = 1920;
/** Room kept around the essential box, as a fraction of the window width, so the crop doesn't graze its edges. */
export const CROP_MARGIN = 0.04;

export type Box = { top: number; bottom: number; left: number; right: number };
export type FitDecision = { mode: 'crop'; left: number; width: number } | { mode: 'blur' };

/** Lucas, 2026-11-23: "If it's possible to have most of the subject in the frame, then it should do that." */
export const MOST_OF_SUBJECT = 0.45;

/**
 * Pure geometry. `essential` is in fractions of the image. A full-height 9:16 window is (h·9/16)/w of the width.
 * Crop when the whole subject (plus margin) fits, or when the window covers most of it and the picture carries no
 * text that must be read in full; the window is centred on the subject and clamped to the image. Otherwise blur-fit.
 */
export function decideFit(w: number, h: number, essential: Box | null, hasText = false): FitDecision {
  const win = Math.min(1, (h * 9) / 16 / w);
  if (win >= 1) return { mode: 'crop', left: 0, width: 1 };
  if (!essential) return { mode: 'blur' };
  const width = Math.max(1e-3, essential.right - essential.left);
  const fits = width + 2 * CROP_MARGIN * win <= win;
  if (!fits && (hasText || win / width < MOST_OF_SUBJECT)) return { mode: 'blur' };
  const centre = (essential.left + essential.right) / 2;
  const left = Math.min(Math.max(centre - win / 2, 0), 1 - win);
  return { mode: 'crop', left, width: win };
}

/** How far the shown part of the photo is stretched in the story frame (output px per source px), and its target size. */
export function storyStretch(w: number, h: number, d: FitDecision): { stretch: number; tw: number; th: number } {
  if (d.mode === 'crop') return { stretch: STORY_H / h, tw: STORY_W, th: STORY_H };
  const s = Math.min(STORY_W / w, STORY_H / h);
  return { stretch: s, tw: Math.round(w * s), th: Math.round(h * s) };
}

/** Makes a region sharper at a target size (an upscaler); returns an image of any size, resized afterwards. */
export type Sharpen = (region: Buffer, tw: number, th: number) => Promise<Buffer>;

/** Render one photo into a 1080×1920 story frame; `sharpen`, when given, runs on the shown region only. */
export async function renderStory(input: Buffer, d: FitDecision, sharpen?: Sharpen): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const w = meta.width!, h = meta.height!;
  const { tw, th } = storyStretch(w, h, d);
  if (d.mode === 'crop') {
    const left = Math.round(d.left * w), width = Math.max(1, Math.min(w - left, Math.round(d.width * w)));
    let region: Buffer = await sharp(input).extract({ left, top: 0, width, height: h }).toBuffer();
    if (sharpen) region = await sharpen(region, tw, th);
    return sharp(region).resize(STORY_W, STORY_H, { fit: 'cover', kernel: 'lanczos3' }).jpeg({ quality: 90 }).toBuffer();
  }
  const bg = await sharp(input).resize(STORY_W, STORY_H, { fit: 'cover' }).blur(40).modulate({ brightness: 0.7 }).toBuffer();
  const fg = await sharp(sharpen ? await sharpen(input, tw, th) : input).resize(tw, th, { fit: 'fill', kernel: 'lanczos3' }).toBuffer();
  return sharp(bg).composite([{ input: fg, top: Math.round((STORY_H - th) / 2), left: Math.round((STORY_W - tw) / 2) }]).jpeg({ quality: 90 }).toBuffer();
}

/**
 * Band fit (Lucas, 2026-11-23: "the photos need to be fitted to the band… Jensen's face was only shown halfway off the
 * frame. That can never happen. It's the subject"). A Morning Download story shows its photo in a 1080×1180 band at
 * the top (.st-story__photo) that fades into the backdrop from 52% of its height (fades.ts). The subject must sit
 * whole in the clear part of the band, never cut and never in the fade.
 *
 * Pure geometry. The scale is the largest that both covers the band and keeps the subject (plus margin) inside the
 * clear zone; if those disagree, the subject wins and a blurred copy fills what the photo doesn't cover (the band's
 * bottom fades out, so a short photo leaves its gap where it barely shows). A picture with text a viewer must read
 * whole, or no subject box, treats the whole picture as the subject.
 */
export const BAND_W = 1080;
export const BAND_H = 1180;
/**
 * How far down the band the subject's bottom edge may reach. A subject may run into the top of the fade (opacity
 * ≥ 0.4 at 0.8 on black) but never off an edge; text a viewer must read stays where the photo is clear (≥ 0.8 at 0.62).
 */
export const BAND_CLEAR = 0.8;
export const BAND_CLEAR_TEXT = 0.62;
/** Breathing room around a subject, on any side where the subject doesn't already reach the picture's own edge. */
export const BAND_MARGIN = 0.03;
/**
 * A photo that can't fill the band this far down (whole subject kept) is contained instead: shown whole-subject at full
 * opacity, centred between the masthead (ends 350px) and the copy (starts 1110px), over its own blur fill.
 * Lucas, 2026-11-23: "The photos are hanging out on the top of the screen when they SHOULD be hanging out in the middle."
 */
export const BAND_COVER_MIN = 0.85;
export const CONTAINED_TOP = 380;
export const CONTAINED_BOTTOM = 1040;
export type BandPlan = { scale: number; left: number; top: number; drawW: number; drawH: number; covers: boolean; contained: boolean };

export function decideBand(w: number, h: number, essential: Box | null, hasText = false): BandPlan {
  const b = !essential || hasText ? { left: 0, right: 1, top: 0, bottom: 1 } : essential;
  const sw = Math.max(1, (b.right - b.left) * w), sh = Math.max(1, (b.bottom - b.top) * h);
  const m = BAND_MARGIN * BAND_W, clear = (hasText ? BAND_CLEAR_TEXT : BAND_CLEAR) * BAND_H;
  const edge = 0.01;
  const ml = b.left > edge ? m : 0, mr = b.right < 1 - edge ? m : 0, mt = b.top > edge ? m : 0;
  const cover = Math.max(BAND_W / w, BAND_H / h);
  const scale = Math.min(cover, (BAND_W - ml - mr) / sw, (clear - mt) / sh);
  const drawW = w * scale, drawH = h * scale;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  // Prefer covering the band (no gaps), centred on the subject; then force the subject fully into view.
  const cx = BAND_W / 2 - ((b.left + b.right) / 2) * drawW;
  let left = drawW >= BAND_W ? clamp(cx, BAND_W - drawW, 0) : (BAND_W - drawW) / 2;
  left = clamp(left, ml - b.left * drawW, BAND_W - mr - b.right * drawW);
  const cy = (mt + clear) / 2 - ((b.top + b.bottom) / 2) * drawH;
  let top = drawH >= BAND_H ? clamp(cy, BAND_H - drawH, 0) : 0;
  top = clamp(top, mt - b.top * drawH, clear - b.bottom * drawH);
  const covers = left <= 0.5 && top <= 0.5 && left + drawW >= BAND_W - 0.5 && top + drawH >= BAND_H - 0.5;
  if (drawW >= BAND_W - 0.5 && drawH >= BAND_COVER_MIN * BAND_H) return { scale, left, top, drawW, drawH, covers, contained: false };
  // Contained: same subject-first scale, capped to the space between masthead and copy, centred there.
  const room = CONTAINED_BOTTOM - CONTAINED_TOP;
  const cs = Math.min(scale, room / h, BAND_W / w);
  const cw = w * cs, ch = h * cs;
  let cl = cw >= BAND_W ? clamp(BAND_W / 2 - ((b.left + b.right) / 2) * cw, BAND_W - cw, 0) : (BAND_W - cw) / 2;
  cl = clamp(cl, -b.left * cw, BAND_W - b.right * cw);
  return { scale: cs, left: cl, top: CONTAINED_TOP + (room - ch) / 2, drawW: cw, drawH: ch, covers: false, contained: true };
}

/** Render one photo into the 1080×1180 band; `sharpen`, when given, runs on the shown region only. */
export async function renderBand(input: Buffer, p: BandPlan, sharpen?: Sharpen): Promise<Buffer> {
  const meta = await sharp(input).metadata();
  const w = meta.width!, h = meta.height!;
  // The part of the source that lands inside the band, and where it lands.
  const sx = Math.max(0, Math.floor(-p.left / p.scale)), sy = Math.max(0, Math.floor(-p.top / p.scale));
  const ex = Math.min(w, Math.ceil((BAND_W - p.left) / p.scale)), ey = Math.min(h, Math.ceil((BAND_H - p.top) / p.scale));
  const dx = Math.max(0, Math.round(p.left + sx * p.scale)), dy = Math.max(0, Math.round(p.top + sy * p.scale));
  const tw = Math.min(BAND_W - dx, Math.round((ex - sx) * p.scale)), th = Math.min(BAND_H - dy, Math.round((ey - sy) * p.scale));
  let region: Buffer = await sharp(input).extract({ left: sx, top: sy, width: ex - sx, height: ey - sy }).toBuffer();
  if (sharpen) region = await sharpen(region, tw, th);
  const fg = await sharp(region).resize(tw, th, { fit: 'fill', kernel: 'lanczos3' }).toBuffer();
  const bg = p.covers
    ? await sharp({ create: { width: BAND_W, height: BAND_H, channels: 3, background: '#000' } }).png().toBuffer()
    : await sharp(input).resize(BAND_W, BAND_H, { fit: 'cover' }).blur(40).modulate({ brightness: 0.7 }).toBuffer();
  return sharp(bg).composite([{ input: fg, left: dx, top: dy }]).jpeg({ quality: 90 }).toBuffer();
}

const LAB = path.join(process.cwd(), '.memes-local/news-ranker-lab/story-crop');
const TRIAL = path.join(process.cwd(), '.memes-local/news-ranker-lab/md-trial');
const LEDGER = path.join(process.cwd(), '.memes-local/news-ranker-lab/tourney/ledger.json');
const CAP_USD = 3.0; // Lucas: "build this system, test it", 2026-11-23 (~$0.15)
const HAIKU = 'claude-haiku-5-5';

export const ESSENTIAL = 'The main subject: the smallest region that still shows what this picture is a picture of. Include every element a viewer needs to get it, such as each key person, product, screen or headline. Leave out background, scenery, extended limbs, props and corner badges that the picture can lose.';
export const HAS_TEXT = 'Does the picture carry text a viewer must read in full to get it, such as a headline, title, caption, label or chart?';
export const CROPPABLE = 'Could this picture be cropped to a tall vertical frame, keeping its full height but only a narrow central slice of its width, without cutting off any main person, object, screen or text that matters?';

type Pick = { file: string; w: number; h: number };

async function pick() {
  fs.mkdirSync(LAB, { recursive: true });
  const final = JSON.parse(fs.readFileSync(path.join(TRIAL, 'final.json'), 'utf8'));
  const posted = new Set<string>();
  for (const x of Object.values(final.days) as { posts: { photo: { file: string } | null }[] }[]) for (const p of x.posts) if (p.photo) posted.add(p.photo.file);
  const all: string[] = [];
  for (const d of fs.readdirSync(TRIAL).filter((x) => /^2026/.test(x)).sort()) for (const f of fs.readdirSync(path.join(TRIAL, d)).sort()) all.push(`${d}/${f}`);
  let seed = 1123;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const order = [...all.filter((f) => posted.has(f)), ...all.filter((f) => !posted.has(f)).sort(() => rand() - 0.5)];
  const picks: Pick[] = [];
  for (const f of order) {
    if (picks.length >= 40) break;
    const m = await sharp(path.join(TRIAL, f)).metadata();
    if (m.width! > m.height! * 1.15) picks.push({ file: f, w: m.width!, h: m.height! });
  }
  fs.writeFileSync(path.join(LAB, 'picks.json'), JSON.stringify(picks, null, 1));
  console.log(`picked ${picks.length} landscape photos (${picks.filter((p) => posted.has(p.file)).length} posted picks)`);
}

const HAIKU_TOOL: Anthropic.Tool = {
  name: 'vertical_fit', description: 'Whether the picture survives a vertical crop, and where its essential content is.',
  input_schema: { type: 'object', properties: {
    croppable: { type: 'boolean', description: CROPPABLE },
    essential_left: { type: 'number', description: 'Left edge of the essential region, as a fraction of the width (0 to 1).' },
    essential_right: { type: 'number', description: 'Right edge of the essential region, as a fraction of the width (0 to 1).' },
  }, required: ['croppable', 'essential_left', 'essential_right'] },
};

async function ask(who: 'jev' | 'haiku') {
  const picks: Pick[] = JSON.parse(fs.readFileSync(path.join(LAB, 'picks.json'), 'utf8'));
  const out: Record<string, { croppable: number; box: Box | null; text?: number; ms: number }> = {};
  let cost = 0;
  const msgs: Anthropic.Message[] = [];
  const client = who === 'haiku' ? new Anthropic() : null;
  const jev = who === 'jev' ? new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } }) : null;
  const q = [...picks];
  await Promise.all(Array.from({ length: who === 'jev' ? 6 : 4 }, async () => {
    for (let p = q.shift(); p; p = q.shift()) {
      const bytes = fs.readFileSync(path.join(TRIAL, p.file));
      const t0 = Date.now();
      try {
        if (client) {
          const m = await client.messages.create({ model: HAIKU, max_tokens: 1500, system: cachedSystemText('You prepare news photos for a vertical phone story. Answer about the picture through the vertical_fit tool.'), tools: [withToolCache(HAIKU_TOOL)],
            messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: bytes.toString('base64') } }, { type: 'text', text: `The essential region is: ${ESSENTIAL}` }] }] });
          msgs.push(m);
          const u = m.content.find((x): x is Anthropic.ToolUseBlock => x.type === 'tool_use')!.input as { croppable: boolean; essential_left: number; essential_right: number };
          out[p.file] = { croppable: Number(u.croppable), box: { top: 0, bottom: 1, left: u.essential_left, right: u.essential_right }, ms: Date.now() - t0 };
        } else {
          // box questions need the jev-preview model; one call carries both questions.
          const res = await jev!.systemOne({ state: image(bytes), questions: { essential: box(ESSENTIAL), croppable: noul(CROPPABLE, { true: 'Croppable to vertical', false: 'Content spans the width' }), text: noul(HAS_TEXT, { true: 'Text to read in full', false: 'No text that matters' }) } as unknown as Questions, model: 'jev-preview' } as never);
          cost += jevCostUsd({ input_tokens: res.usage.input_tokens ?? 0, output_tokens: res.usage.output_tokens ?? 0 });
          const a = res.answers as Record<string, { box?: Box; noul?: number }>;
          out[p.file] = { croppable: a.croppable!.noul!, box: a.essential!.box ?? null, text: a.text?.noul, ms: Date.now() - t0 };
        }
      } catch (e) { console.error(`skip ${p.file}: ${e instanceof Error ? e.message.slice(0, 160) : e}`); }
    }
  }));
  if (client) cost = Number(priceAnthropicMessages(msgs, { modelId: HAIKU }).costUsd);
  const l = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  if (l.spent + cost > CAP_USD) console.warn('over cap');
  l.spent += cost; l.runs.push({ spec: `story-crop ${who}`, cost, at: new Date().toISOString() });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 1));
  fs.writeFileSync(path.join(LAB, `ask-${who}${process.env.TAG ?? ''}.json`), JSON.stringify({ costUsd: cost, results: out }, null, 1));
  console.log(`${who}: ${Object.keys(out).length}/${picks.length}, $${cost.toFixed(4)}`);
}

async function render(method: string) {
  const picks: Pick[] = JSON.parse(fs.readFileSync(path.join(LAB, 'picks.json'), 'utf8'));
  const src = JSON.parse(fs.readFileSync(path.join(LAB, `ask-${method}.json`), 'utf8')).results;
  const dir = path.join(LAB, `render-${method}`);
  fs.mkdirSync(dir, { recursive: true });
  const decisions: Record<string, FitDecision> = {};
  for (const p of picks) {
    const r = src[p.file];
    if (!r) continue;
    const d = decideFit(p.w, p.h, r.box, (r.text ?? 0) >= 0.5);
    decisions[p.file] = d;
    fs.writeFileSync(path.join(dir, p.file.replace('/', '_')), await renderStory(fs.readFileSync(path.join(TRIAL, p.file)), d));
  }
  fs.writeFileSync(path.join(LAB, `decisions-${method}.json`), JSON.stringify(decisions, null, 1));
  console.log(`rendered ${Object.keys(decisions).length}: crop ${Object.values(decisions).filter((d) => d.mode === 'crop').length}, blur ${Object.values(decisions).filter((d) => d.mode === 'blur').length}`);
}

if (process.argv[1]?.endsWith('story-crop.ts')) {
  const [cmd, who] = process.argv.slice(2);
  const run = cmd === 'pick' ? pick() : cmd === 'render' ? render(who!) : cmd === 'ask' && process.argv.includes('--yes') && (who === 'jev' || who === 'haiku') ? ask(who) : Promise.resolve(console.log('usage: pick | ask jev|haiku --yes | render <method>'));
  run.catch((e) => { console.error(e); process.exitCode = 1; });
}
