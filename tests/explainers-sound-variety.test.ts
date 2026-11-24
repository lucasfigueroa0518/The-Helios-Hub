// Sound variety and reach (Lucas, 2026-11-17): more of the library reachable, no sound repeated
// past a small cap, never the opener's hit again at frame 2, drop-in folders ingested offline.
// Offline: no model, no network; ffmpeg only for the ingest test (skipped without it).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { cutHitFor, CUT_HITS, openerEntries } from '../explainers/world-kit/opener-sfx.mjs';
import { families, search } from '../explainers/world-kit/sfx-find.mjs';
import {
  CAPS,
  candidatesFor,
  eventProblems,
  eventsToCues,
  loadCatalog,
  mixArgs,
  MOTIF_CAP,
  openerContext,
  resolveCues,
  soundDistance,
} from '../explainers/world-kit/sound.mjs';
import { audioFiles, inferKind, ingest, nameWords } from '../explainers/design/sfx/tools/ingest-inbox.mjs';

type Sound = { id: string; file: string; group: string; tags: string[]; duration: number; peakDb: number; meanDb: number; kind?: string };
type Resolved = { t: number; kind: string; sound: Sound; rate?: number; motif?: string };

const SFX = path.join(__dirname, '..', 'explainers', 'design', 'sfx');
const CATALOG = loadCatalog(SFX) as Sound[];
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

const frames = [{ id: 'f1', start: 0 }, { id: 'f2', start: 4 }, { id: 'f3', start: 30 }];
const series = (kind: string, n: number, extra: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => ({ t: 0.5 + i * 1.1, kind, ...extra }));
const resolve = (events: Record<string, unknown[]>, opts: Record<string, unknown> = {}) => {
  const { cues } = eventsToCues(frames, events, CATALOG);
  return resolveCues(CATALOG, cues, opts) as { resolved: Resolved[]; missing: unknown[]; variety: { distinct: number; substituted: number; repitched: number; mostPlayed: { times: number } } };
};
const counts = (list: Resolved[]) => {
  const m = new Map<string, number>();
  for (const r of list) m.set(r.sound.file, (m.get(r.sound.file) ?? 0) + 1);
  return m;
};

test('every event kind reaches many sounds, not one', () => {
  const reach = (kind: string) => new Set(candidatesFor(CATALOG, { kind, t: 0 }).family.map((h: { s: Sound }) => h.s.file)).size;
  const min: Record<string, number> = { impact: 20, whoosh: 5, pop: 8, tick: 12, click: 20, sting: 30 };
  for (const [kind, n] of Object.entries(min)) assert.ok(reach(kind) >= n, `${kind} reaches ${reach(kind)}`);
  // a `what` word that names a material reaches that material's impacts
  const glass = candidatesFor(CATALOG, { kind: 'impact', t: 0, weights: { glass: 3 } }).tier;
  assert.ok(glass.length >= 10 && glass.every((h: { s: Sound }) => h.s.tags.includes('glass')));
  // the non-foley kinds never pick paper or pen foley
  for (const kind of ['impact', 'whoosh', 'tick', 'click', 'pop', 'sting']) {
    assert.ok(!candidatesFor(CATALOG, { kind, t: 0 }).family.some((h: { s: Sound }) => h.s.tags.includes('freesound')), kind);
  }
});

test('a reel never plays one file past its cap, nor twice in a row', () => {
  const { resolved, missing, variety } = resolve({ f2: [...series('pop', 12), ...series('tick', 20, { what: 'counter steps' })], f3: series('sting', 6) });
  assert.deepEqual(missing, []);
  for (const kind of ['pop', 'tick', 'sting']) {
    const list = resolved.filter((r) => r.kind === kind);
    for (const [file, n] of counts(list)) assert.ok(n <= CAPS[kind as keyof typeof CAPS], `${file} ×${n}`);
    for (let i = 1; i < list.length; i++) assert.notEqual(list[i].sound.file, list[i - 1].sound.file, `${kind} ${i}`);
  }
  assert.ok(variety.distinct >= 20, `${variety.distinct} distinct`);
  assert.equal(variety.repitched, 0);
});

test("the opener's hit never returns as an accent, and frame 2 opens on something else", () => {
  const meta = {
    sfx: [
      { source: 'host', role: 'opener-stem', file: 'assets/sfx/opener-stem.wav', sounds: ['pixabay/impact-bass-1.mp3', 'pixabay/pop.mp3'] },
      { source: 'host', role: 'opener-hit', file: 'assets/sfx/impact-bass-1.mp3' }, // an older entry: matched by name
    ],
  };
  const opener = openerContext(meta, CATALOG, frames);
  assert.equal(opener.hit, 'pixabay/impact-bass-1.mp3');
  assert.deepEqual(opener.files.sort(), ['pixabay/impact-bass-1.mp3', 'pixabay/pop.mp3']);
  assert.equal(opener.until, 7);
  // impacts that ask for the bass hit by name and by words still get another sound
  const { resolved } = resolve({ f2: [{ t: 0, kind: 'impact', what: 'bass slam' }, { t: 0.1, kind: 'pop' }, { t: 2, kind: 'impact', sound: 'pixabay/impact-bass-1' }], f3: series('impact', 4, { what: 'bass hit' }) }, { opener });
  assert.ok(!resolved.some((r) => r.sound.file === 'pixabay/impact-bass-1.mp3'), resolved.map((r) => r.sound.id).join(' '));
  assert.notEqual(resolved.find((r) => r.kind === 'pop')!.sound.file, 'pixabay/pop.mp3', 'no opener sound in frame 2’s first seconds');
  const impacts = resolved.filter((r) => r.kind === 'impact');
  for (let i = 1; i < impacts.length; i++) assert.notEqual(impacts[i].sound.file, impacts[i - 1].sound.file);
});

test('the cut hit is one the opener stem did not play', () => {
  assert.equal(cutHitFor(['pixabay/impact-bass-1.mp3']), 'pixabay/impact-bass-2.mp3');
  assert.equal(cutHitFor(['pixabay/impact-bass-2.mp3']), 'pixabay/impact-bass-1.mp3');
  assert.equal(cutHitFor([]), CUT_HITS[0]);
  for (const f of CUT_HITS) assert.ok(CATALOG.some((s) => s.file === f), `${f} is in the library`);
  const [, hit] = openerEntries(3, { file: 'assets/sfx/opener-hit.mp3', seconds: 2.592, library: 'pixabay/impact-bass-2.mp3' } as never);
  assert.deepEqual(hit, { frame: 1, file: 'assets/sfx/opener-hit.mp3', offset_s: 3, duration_s: 2.592, volume: 0.6, source: 'host', role: 'opener-hit', library: 'pixabay/impact-bass-2.mp3' });
});

test('a motif keeps one exact sound past the cap; a named sound plays as named', () => {
  const { resolved } = resolve({ f2: series('pop', 6, { motif: 'token-arrives' }), f3: [{ t: 0, kind: 'foley', what: 'stamp', sound: 'freesound/stamp/362624-2' }] });
  const pops = resolved.filter((r) => r.kind === 'pop');
  assert.equal(pops.length, 6);
  assert.equal(new Set(pops.slice(0, MOTIF_CAP).map((r) => r.sound.file)).size, 1, 'the motif holds past the pop cap of 3');
  assert.notEqual(pops[MOTIF_CAP].sound.file, pops[0].sound.file, 'and gives way after MOTIF_CAP');
  const named = CATALOG.find((s) => s.id === 'freesound/stamp/362624-2');
  assert.ok(named);
  assert.equal(resolved.find((r) => r.kind === 'foley')!.sound.id, named.id);
});

test('when nothing similar is left the sound still plays, re-pitched and reported', () => {
  const one = [{ id: 'x/pop', file: 'x/pop.mp3', group: 'pixabay/pop', tags: ['pop'], duration: 0.5, peakDb: -1, meanDb: -20 }];
  const { cues } = eventsToCues([{ id: 'a', start: 0 }], { a: series('pop', 5) }, one);
  const { resolved, variety } = resolveCues(one, cues) as { resolved: Resolved[]; variety: { repitched: number } };
  assert.equal(resolved.length, 5, 'variety never drops a sound');
  assert.ok(variety.repitched >= 3);
  assert.ok(resolved.slice(1).every((r) => r.rate && r.rate !== 1));
  assert.match(mixArgs(resolved, 10, 'out.wav', '/lib').join(' '), /asetrate=\d+,aresample=48000/);
});

test('events accept a named sound and a motif, and reject bad ones', () => {
  assert.deepEqual(eventProblems([{ t: 1, kind: 'pop', what: 'badge', sound: 'pixabay/pop', motif: 'badge' }], 5), []);
  assert.match(eventProblems([{ t: 1, kind: 'pop', sound: 3 }], 5)[0], /"sound" is a library id/);
  assert.match(eventProblems([{ t: 1, kind: 'pop', motif: '' }], 5)[0], /"motif"/);
});

test('similar sounds are closer than different ones', () => {
  const by = (file: string) => CATALOG.find((s) => s.file.endsWith(file))!;
  const a = by('impactPunch_heavy_000.ogg');
  assert.ok(soundDistance(a, by('impactPunch_heavy_001.ogg')) < soundDistance(a, by('pixabay/chime.mp3')));
});

test('the lookup command finds families and lists the library compactly', () => {
  const lines = search(CATALOG, { words: 'paper slide' });
  assert.match(lines[0], /families/);
  assert.match(lines[1], /^freesound\/paper-slide\//);
  assert.match(search(CATALOG, { kind: 'pop' } as never)[0], /^pop: \d+ sounds in \d+ families/);
  const all = families(CATALOG).join('\n');
  assert.ok(all.length < 6000, `${all.length} chars`);
});

test('names become words and a kind', () => {
  assert.deepEqual(nameWords('Impacts/Big_Hit03 (wet).wav').sort(), ['big', 'hit', 'impact', 'impacts', 'wet'].sort());
  assert.equal(inferKind(nameWords('Swooshes/fast-swoosh-2.wav')), 'whoosh');
  assert.equal(inferKind(nameWords('Paper/page turn 03.mp3')), 'foley');
  assert.equal(inferKind(nameWords('UI/bubblePop.ogg')), 'pop');
});

test('a dropped-in folder is measured, normalized, deduplicated and cataloged', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-inbox-'));
  fs.writeFileSync(path.join(root, 'catalog.json'), '[]');
  const inbox = path.join(root, 'inbox');
  fs.mkdirSync(path.join(inbox, 'Cinematic Hits'), { recursive: true });
  fs.mkdirSync(path.join(inbox, 'Paper'), { recursive: true });
  const gen = (out: string, src: string, af = 'anull') => assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-af', af, out]).status, 0, out);
  gen(path.join(inbox, 'Cinematic Hits', 'deep-thud-01.wav'), 'anoisesrc=d=0.8:a=0.3:c=brown', 'lowpass=f=250,adelay=150,afade=t=out:st=0.17:d=0.6:curve=exp');
  fs.copyFileSync(path.join(inbox, 'Cinematic Hits', 'deep-thud-01.wav'), path.join(inbox, 'Cinematic Hits', 'zz-same-thud.wav'));
  gen(path.join(inbox, 'Paper', 'page_turn.wav'), 'anoisesrc=d=0.6:a=0.2:c=white', 'afade=t=in:d=0.1,afade=t=out:st=0.3:d=0.3');
  gen(path.join(inbox, 'Paper', 'silence.wav'), 'anullsrc=d=0.5');
  fs.writeFileSync(path.join(inbox, 'Paper', 'broken.mp3'), 'not audio');
  assert.equal(audioFiles(inbox).length, 5);

  const quiet = { log: () => {} };
  const dry = await ingest(root, { dryRun: true, ...quiet });
  assert.equal(dry.added, 2);
  assert.ok(!fs.existsSync(path.join(root, 'catalog-inbox.json')), 'a dry run writes nothing');

  const r = await ingest(root, quiet);
  assert.equal(r.added, 2, JSON.stringify(r));
  assert.deepEqual(r.kinds, { impact: 1, foley: 1 });
  assert.equal(r.duplicates.length, 1);
  assert.deepEqual(r.rejected.map((x: { why: string }) => x.why.split(' ')[0]).sort(), ['ffmpeg', 'silent']);
  const entries = JSON.parse(fs.readFileSync(path.join(root, 'catalog-inbox.json'), 'utf8'));
  const hit = entries.find((e: { kind: string }) => e.kind === 'impact');
  assert.equal(hit.id, 'inbox/cinematic-hits/deep-thud-01');
  assert.equal(hit.file, 'dropins/cinematic-hits/deep-thud-01.mp3');
  assert.equal(hit.peakDb, -1);
  assert.ok(hit.duration < 0.85, `leading silence trimmed (${hit.duration}s of 0.95s)`);
  assert.ok(hit.tags.includes('dark') && hit.tags.includes('thud') && hit.description.includes('(impact)'), hit.description);
  assert.ok(fs.existsSync(path.join(root, hit.file)));
  // a re-run skips what is in; the drop-ins join the kind they name
  const again = await ingest(root, quiet);
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 5, 'the cache skips every file it has seen, added or rejected');
  const merged = loadCatalog(root);
  assert.ok(candidatesFor(merged, { kind: 'impact', t: 0 }).family.some((h: { s: Sound }) => h.s.id === hit.id));
  assert.ok(candidatesFor(merged, { kind: 'foley', t: 0, weights: { page: 2, turn: 2 } }).tier.some((h: { s: Sound }) => h.s.id === 'inbox/paper/page-turn'));
  fs.rmSync(root, { recursive: true, force: true });
});
