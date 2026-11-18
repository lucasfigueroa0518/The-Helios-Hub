// The central sound library (explainers/design/sfx/library.mjs): drop-ins reach every format. Offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dropinStingers, findLibraryDir, loadLibrary, searchLibrary, stingerKindOf, SFX_DIR } from '@/explainers/design/sfx/library.mjs';
import { spawnSync } from 'node:child_process';

import { ingest } from '@/explainers/design/sfx/tools/ingest-inbox.mjs';
import { loadCatalog } from '@/explainers/world-kit/sound.mjs';
import { resolveDesigned, stingerEntry } from '@/explainers/reel-ai-drama/kit/sound.mjs';
import { soundLibrary, soundCuesTool } from '@/lib/reel-ai-drama/render/sound-design';

const drop = (id: string, kind: string, tags: string[], extra: Record<string, unknown> = {}) => ({
  id: `inbox/${id}`, file: `dropins/${id}.mp3`, pack: 'inbox', group: `inbox/${id}`.replace(/-?\d+$/, ''), kind, tags: [...tags, 'inbox'],
  duration: 1.2, peakDb: -1, meanDb: -18, attack: 10, decay: 0.4, centroid: 900, body: 0.2, description: `${tags.join(' ')} (${kind})`, ...extra,
});

function library(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-lib-'));
  fs.copyFileSync(path.join(SFX_DIR, 'catalog.json'), path.join(dir, 'catalog.json'));
  fs.copyFileSync(path.join(SFX_DIR, 'ambience-catalog.json'), path.join(dir, 'ambience-catalog.json'));
  fs.writeFileSync(path.join(dir, 'catalog-inbox.json'), JSON.stringify([
    drop('cinematic-hits/wood-slam-1', 'impact', ['cinematic', 'hit', 'wood', 'slam', 'dark']),
    drop('risers/tension-riser', 'foley', ['riser', 'tension'], { attack: 3200, duration: 3.5 }),
    drop('ui/soft-tick', 'tick', ['soft', 'tick']), // an older entry, without the kind's 'click' tag
    drop('paper/page-turn', 'foley', ['paper', 'page', 'turn']),
    drop('gone/not-synced', 'impact', ['hit']), // its MP3 is not on this machine
  ]));
  for (const id of ['cinematic-hits/wood-slam-1', 'risers/tension-riser', 'ui/soft-tick', 'paper/page-turn']) {
    fs.mkdirSync(path.dirname(path.join(dir, 'dropins', `${id}.mp3`)), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dropins', `${id}.mp3`), '');
  }
  return dir;
}

test('every format loads the bank and the drop-ins through one library', () => {
  const dir = library();
  const all = loadLibrary(dir);
  assert.equal(all.filter((s) => s.pack === 'inbox').length, 4);
  assert.equal(loadCatalog(dir).length, all.length, 'the Explainers kit reads the same list');
  assert.ok(all.find((s) => s.id === 'inbox/ui/soft-tick').tags.includes('click'), 'a drop-in carries its kind\'s tags');
  assert.ok(!all.some((s) => s.pack === 'freesound-ambience'));
  assert.ok(loadLibrary(dir, { ambience: true }).some((s) => s.pack === 'freesound-ambience'));
  assert.equal(findLibraryDir(['/nope', dir]), dir);
});

test('search ranks by words, kind and acoustics', () => {
  const all = loadLibrary(library());
  assert.equal(searchLibrary(all, { words: 'wood slam', source: 'dropins' })[0].id, 'inbox/cinematic-hits/wood-slam-1');
  assert.ok(searchLibrary(all, { words: 'page turns', n: 3 }).some((s) => s.id === 'inbox/paper/page-turn'));
  assert.ok(searchLibrary(all, { kind: 'impact', brightness: 'dark', n: 500 }).some((s) => s.id === 'inbox/cinematic-hits/wood-slam-1'));
  assert.equal(searchLibrary(all, { words: 'zzqx' }).length, 0);
});

test('drop-ins join the Reel AI Drama designer\'s stinger menu and play', () => {
  const dir = library();
  const all = loadLibrary(dir, { ambience: true });
  assert.equal(stingerKindOf(all.find((s) => s.id === 'inbox/risers/tension-riser')), 'riser');
  assert.equal(stingerKindOf(all.find((s) => s.id === 'inbox/paper/page-turn')), 'spot');
  const menu = dropinStingers(all);
  assert.deepEqual(menu.riser.map((e: { id: string }) => e.id), ['inbox/risers/tension-riser']);
  assert.equal(menu.riser[0].land, 3.2, 'a riser crests at its loudest point');

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-proj-'));
  fs.mkdirSync(path.join(project, 'assets'));
  fs.symlinkSync(dir, path.join(project, 'assets', 'sfx-library'), 'dir');
  const lib = soundLibrary(project);
  assert.ok(lib.stingers.hit.some((e) => e.id === 'inbox/cinematic-hits/wood-slam-1'));
  assert.ok(lib.stingers.hit[0].id.startsWith('pixabay/'), 'the measured default stays first');
  const schema = JSON.stringify(soundCuesTool(lib).input_schema);
  assert.ok(schema.includes('inbox/risers/tension-riser'), 'the tool accepts a drop-in id');

  assert.equal(stingerEntry('riser', 'inbox/risers/tension-riser', all)?.land, 3.2);
  const { resolved, missing } = resolveDesigned(all, { stingers: [{ kind: 'hit', t: 2, dur: 0, id: 'inbox/cinematic-hits/wood-slam-1' }] });
  assert.equal(missing.length, 0);
  assert.equal(resolved[0].sound.id, 'inbox/cinematic-hits/wood-slam-1');
});

const hasTools = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('zip', ['-v']).status === 0;

test('zips are read where they are, the MP3s go to an outside store, and a re-run skips the zip', { skip: !hasTools && 'ffmpeg or zip missing' }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-zip-'));
  const root = path.join(base, 'lib');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'catalog.json'), '[]');
  const src = path.join(base, 'src', 'Deep Impacts Sound FX', 'Impacts');
  fs.mkdirSync(src, { recursive: true });
  for (let i = 1; i <= 3; i++) spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `anoisesrc=d=${0.4 * i}:a=0.3:c=brown:s=${i}`, '-af', 'afade=t=out:st=0.1:d=0.3', path.join(src, `Impact ${i}.wav`)]);
  const zip = path.join(base, 'Deep Impacts Sound FX.zip');
  spawnSync('zip', ['-qr', zip, 'Deep Impacts Sound FX'], { cwd: path.join(base, 'src') });
  const store = path.join(base, 'store');
  const quiet = { log: () => {} };
  const r = await ingest(root, { from: [zip], store, ...quiet });
  assert.equal(r.added, 3, JSON.stringify(r.rejected));
  assert.ok(fs.lstatSync(path.join(root, 'dropins')).isSymbolicLink(), 'dropins/ links to the store');
  const entries = JSON.parse(fs.readFileSync(path.join(root, 'catalog-inbox.json'), 'utf8'));
  assert.ok(entries.every((e: { file: string; kind: string }) => fs.existsSync(path.join(store, e.file.slice('dropins/'.length))) && e.kind === 'impact'));
  assert.equal(loadLibrary(root).length, 3);
  const again = await ingest(root, { from: [zip], ...quiet });
  assert.equal(again.zipsSkipped, 1);
  assert.equal(again.added, 0);
  fs.rmSync(base, { recursive: true, force: true });
});
