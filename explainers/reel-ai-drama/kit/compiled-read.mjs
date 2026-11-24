// Read what the compiled frames really did, from the browser. Deterministic, free, no model. For every story frame (or only
// the given ids): load it the way the checks do, play it through, and report its stage manifest, the words and marks that
// couldn't land, and the stage's notes; with --stills <dir>, one still at the frame's main beat, for the creative pass.
//
//   node assets/kit/compiled-read.mjs [--stills <dir>] [<id> …]
//
// Prints JSON { ok, frames: { [number]: { id, name, duration, ...record } }, stills: [{ number, name, id, at, file }], skipped? }.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isClose, objectStrokes, projectFrames, projectMedia } from './frames.mjs';
import { loadFrame } from './measure.mjs';

const STEP = 0.5;

/** When a frame has settled: the last thing it plans has landed, or 60% in when nothing lands late. Pure. */
export function mainBeat(manifest, duration) {
  const times = [...(manifest?.pieces ?? []).map((p) => p.at), ...(manifest?.marks ?? []).map((m) => m.at), ...(manifest?.labels ?? []).map((l) => l.at), manifest?.hook?.at ?? 0].filter((t) => Number.isFinite(t) && t < duration);
  const last = times.length ? Math.max(...times) : 0;
  const at = last > 0 ? last + 0.6 : duration * 0.6;
  return Math.round(Math.min(at, Math.max(0, duration - 0.05)) * 1000) / 1000;
}

export async function readCompiled(root, { only = null, stills = null, open = null } = {}) {
  const opener = open ?? (await import('./browser.mjs')).open;
  const b = await opener(root).catch((e) => ({ skipped: `the browser could not start: ${e?.message ?? e}` }));
  if (!b?.page) return { ok: false, frames: {}, stills: [], skipped: b?.skipped ?? 'no browser' };
  const media = projectMedia(root);
  const strokes = objectStrokes(root);
  const frames = {};
  const shots = [];
  if (stills) mkdirSync(stills, { recursive: true });
  try {
    for (const f of projectFrames(root)) {
      if (isClose(f) || !f.id || !(f.duration > 0) || (only && !only.includes(f.id))) continue;
      b.errors.length = 0;
      try {
        await loadFrame(b.page, root, f, media, strokes);
        for (let t = 0; t < f.duration; t += STEP) await b.page.evaluate((x) => window.__render(x), t);
        await b.page.evaluate((x) => window.__render(x), Math.max(0, f.duration - 1 / 30));
        const record = await b.page.evaluate((id) => ({ ...(document.__compiled?.[id] ?? { reports: ['the frame did not go through compiledFrame'] }), notes: document.__stageNotes ?? [], skips: document.__markSkips ?? [] }), f.id);
        frames[f.number] = { id: f.id, name: f.name, duration: f.duration, ...record, errors: [...b.errors] };
        if (stills) {
          const at = mainBeat(record.manifest, f.duration);
          await b.page.evaluate((x) => window.__render(x), at);
          const shot = await b.page.screenshot({ type: 'jpeg', quality: 72 });
          const file = join(stills, `${f.id}.jpg`);
          writeFileSync(file, Buffer.from(shot));
          shots.push({ number: f.number, name: f.name, id: f.id, at, file });
        }
      } catch (e) {
        frames[f.number] = { id: f.id, name: f.name, duration: f.duration, failed: e?.message ?? String(e), reports: [], notes: [], skips: [], errors: [...b.errors] };
      }
    }
  } finally {
    await b.close();
  }
  return { ok: true, frames, stills: shots };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--stills');
  const stills = i >= 0 ? args[i + 1] : null;
  const only = args.filter((a, k) => !(i >= 0 && (k === i || k === i + 1)));
  readCompiled(process.cwd(), { only: only.length ? only : null, stills })
    .catch((e) => ({ ok: false, frames: {}, stills: [], skipped: `the read could not run: ${e instanceof Error ? e.message : String(e)}` }))
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exit(0);
    });
}
