/**
 * Render a hook on a stored reel, offline and free, from slots alone: code's own choice of pictures and words, the reel's real
 * voice, timing and music, the kit's real frame module and real sound placement. For checking a template by eye, never used in
 * production. Writes <out>/<hook>-<reel>.mp4 and <hook>-<reel>.jpg (a strip of stills).
 *
 *   npx tsx lib/reel-ai-drama/hooks/acceptance.ts <job dir> <reel name> <out dir> [hook,hook,…]
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { open } from '@/explainers/reel-ai-drama/kit/browser.mjs';
import { objectStrokes, projectFrames, projectMedia } from '@/explainers/reel-ai-drama/kit/frames.mjs';
import { loadFrame } from '@/explainers/reel-ai-drama/kit/measure.mjs';
import { placeSound } from '@/explainers/reel-ai-drama/kit/sound.mjs';
import { codeHook, hookOptions } from '@/lib/reel-ai-drama/hooks/eligibility';
import { compileReel } from '@/lib/reel-ai-drama/render/compile';
import type { DirectorPlan, HookChoice, SourceRef, VisualsInventory } from '@/lib/reel-ai-drama/types';
import { KIT_DIR } from '@/lib/reel-ai-drama/render/workspace';

const FPS = 30;

/** Real page titles from a stored reel's headline screenshots: the sources a stored job kept. */
export function sourcesOf(inventory: VisualsInventory): SourceRef[] {
  return inventory.assets.filter((a) => a.kind === 'headline').flatMap((a) => {
    const title = /page "(.*?)" on /.exec(a.shows)?.[1];
    return title ? [{ url: a.source_page ?? '', title, publisher: '', date: null }] : [];
  });
}

const link = (from: string, to: string) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.symlinkSync(fs.realpathSync(from), to);
};

/** A one-frame project over the stored reel's files; the stored reel isn't touched. */
function scratchProject(source: string, plan: DirectorPlan): { root: string; id: string; number: number } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-accept-'));
  for (const dir of ['media', 'fonts', 'voice', 'bgm', 'sfx-library']) link(path.join(source, 'assets', dir), path.join(root, 'assets', dir));
  link(KIT_DIR, path.join(root, 'assets', 'kit'));
  fs.copyFileSync(path.join(source, 'assets', 'inventory.json'), path.join(root, 'assets', 'inventory.json'));
  const first = projectFrames(source)[0];
  fs.mkdirSync(path.join(root, 'assets', 'timing'), { recursive: true });
  fs.copyFileSync(path.join(source, 'assets', 'timing', `${first.id}.json`), path.join(root, 'assets', 'timing', `${first.id}.json`));
  const board = fs.readFileSync(path.join(source, 'STORYBOARD.md'), 'utf8');
  const blocks = board.split(/(?=^#+\s*Frame\s)/m);
  fs.writeFileSync(path.join(root, 'STORYBOARD.md'), blocks.slice(0, 2).join(''));
  const meta = JSON.parse(fs.readFileSync(path.join(source, 'audio_meta.json'), 'utf8'));
  fs.writeFileSync(path.join(root, 'audio_meta.json'), JSON.stringify({ bgm: meta.bgm, voices: meta.voices.slice(0, 1), sfx: [] }));
  void plan;
  return { root, id: first.id, number: first.number };
}

async function renderOne(source: string, reel: string, out: string, choice: HookChoice): Promise<string> {
  const saved = JSON.parse(fs.readFileSync(path.join(source, 'assets', 'plan.json'), 'utf8')) as DirectorPlan;
  const plan: DirectorPlan = { ...saved, frames: saved.frames.slice(0, 1), hook: choice };
  const { root, id } = scratchProject(source, plan);
  const { problems } = await compileReel({ plan, projectDir: root, readWords: null });
  const placed = placeSound(root) as { ok: boolean; errors: string[]; placed: number; dropped: unknown[] };
  const b = await open(root);
  if (!('page' in b) || !b.page) throw new Error('no browser');
  const f = projectFrames(root)[0];
  const timing = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'timing', `${id}.json`), 'utf8')) as { words: { text: string; start: number }[]; duration: number };
  const duration = timing.duration;
  await loadFrame(b.page, root, { ...f, duration }, projectMedia(root), objectStrokes(root));
  // The captions as the skin sets them: on a dark plate, in the top band.
  await b.page.evaluate(() => {
    const el = document.createElement('div');
    el.id = 'cap';
    el.style.cssText = 'position:absolute;left:72px;right:72px;top:292px;font:700 74px/1.2 "Pragmatica Extended";color:#fff;z-index:9';
    document.body.append(el);
  });
  const groups: { t: number; text: string }[] = [];
  for (let i = 0; i < timing.words.length; i += 3) groups.push({ t: timing.words[i].start, text: timing.words.slice(i, i + 3).map((w) => w.text).join(' ') });
  const name = `${choice.id}-${reel}`;
  const silent = path.join(root, 'v.mp4');
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = Math.ceil(duration * FPS);
  const stills: string[] = [];
  const stillAt = new Set(Array.from({ length: 8 }, (_, i) => Math.floor(((i + 0.5) * frames) / 8)));
  for (let n = 0; n < frames; n++) {
    const t = n / FPS;
    const caption = [...groups].reverse().find((g) => t >= g.t)?.text ?? '';
    await b.page.evaluate(({ t, caption }: { t: number; caption: string }) => {
      (window as unknown as { __render(x: number): void }).__render(t);
      const el = document.getElementById('cap') as HTMLElement;
      el.innerHTML = caption ? `<span style="background:rgba(0,0,0,.82);-webkit-box-decoration-break:clone;box-decoration-break:clone;padding:4px 18px">${caption}</span>` : '';
    }, { t, caption });
    const shot = await b.page.screenshot({ type: 'jpeg', quality: 90 });
    if (stillAt.has(n)) {
      const file = path.join(root, `still-${n}.jpg`);
      fs.writeFileSync(file, Buffer.from(shot));
      stills.push(file);
    }
    if (!ff.stdin.write(Buffer.from(shot))) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  const record = await b.page.evaluate((x: string) => (document as unknown as { __compiled: Record<string, { plain: boolean; reports: string[] }> }).__compiled?.[x], id);
  const pageErrors = [...(b.errors ?? [])];
  await b.close?.();

  const meta = JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8'));
  const voice = path.join(root, meta.voices[0].path);
  const bgm = path.join(root, meta.bgm.path);
  const events = path.join(root, 'assets', 'sfx', 'events.wav');
  const mp4 = path.join(out, `${name}.mp4`);
  fs.mkdirSync(out, { recursive: true });
  const mix = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', silent, '-i', voice, '-i', bgm, '-i', events, '-filter_complex', `[1:a]volume=1[v];[2:a]volume=${meta.bgm.volume ?? 0.31}[m];[3:a]volume=0.9[e];[v][m][e]amix=inputs=3:normalize=0:duration=longest,alimiter=limit=0.95,atrim=0:${duration}[a]`, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(duration), '-movflags', '+faststart', mp4], { encoding: 'utf8' });
  if (mix.status !== 0) throw new Error(`mix: ${String(mix.stderr).slice(-300)}`);
  spawnSync('ffmpeg', ['-v', 'error', '-y', ...stills.flatMap((s) => ['-i', s]), '-filter_complex', `${stills.map((_, i) => `[${i}:v]scale=170:-1[s${i}]`).join(';')};${stills.map((_, i) => `[s${i}]`).join('')}hstack=inputs=${stills.length}`, path.join(out, `${name}.jpg`)]);
  const summary = `${name}: ${duration.toFixed(1)}s, ${placed.placed} sounds${placed.dropped.length ? `, ${placed.dropped.length} dropped` : ''}${placed.errors.length ? `, sound errors ${placed.errors[0]}` : ''}${record?.plain ? ', FELL BACK' : ''}${pageErrors.length ? `, page error ${pageErrors[0]}` : ''}${problems.length ? ` | ${problems.slice(0, 2).join('; ')}` : ''}${record?.reports?.length ? ` | ${record.reports.slice(0, 2).join('; ')}` : ''} | ${choice.beats.map((x) => x.asset).join(' ')} | "${choice.charged}"`;
  if (process.env.HOOK_KEEP) return `${summary}\nkept ${root}`;
  fs.rmSync(root, { recursive: true, force: true });
  return summary;
}

async function main() {
  const [job, reel, out, only] = process.argv.slice(2);
  const source = path.join(job, 'render', 'project');
  const inventory = JSON.parse(fs.readFileSync(path.join(source, 'assets', 'inventory.json'), 'utf8')) as VisualsInventory;
  const words = (JSON.parse(fs.readFileSync(path.join(source, 'audio_meta.json'), 'utf8')).voices[0].words as { text: string }[]).map((w) => w.text).join(' ');
  const options = hookOptions(inventory, sourcesOf(inventory)).filter((o) => !only || only.split(',').includes(o.id));
  // HOOK_CHOICE: one HookChoice as JSON, to render a director's slots rather than code's. HOOK_NAME: the file's reel part.
  if (process.env.HOOK_CHOICE) {
    console.log(await renderOne(source, process.env.HOOK_NAME ?? reel, out, JSON.parse(process.env.HOOK_CHOICE) as HookChoice));
    return;
  }
  for (const o of options) {
    try {
      console.log(await renderOne(source, reel, out, codeHook(o, { inventory, words })));
    } catch (e) {
      console.log(`${o.id}-${reel}: FAILED ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().then(() => process.exit(0));
