import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import sharp from 'sharp';

import type { CompiledFrameRecord } from '@/lib/reel-ai-drama/render/compile';
import { EDGE_INSET, findingTimes, MERGE_WITHIN, pickMoments, sceneChanges, SETTLE, type Moment } from '@/lib/reel-ai-drama/render/moments';
import type { Runner } from '@/lib/reel-ai-drama/render/runner';
import { fullStill, makeSheets, sheetGrid, stripLines, stripSvg, TILE, viewerSheets } from '@/lib/reel-ai-drama/render/sheets';
import type { FrameSpan } from '@/lib/reel-ai-drama/render/video';
import { frameSpans, OPENING_STILL_AT } from '@/lib/reel-ai-drama/render/video';

// ── Fixtures (the shapes of a real project's STORYBOARD, compiled read and checks) ──────────────

const SPANS: FrameSpan[] = [
  { number: 1, name: 'open', treatment: 'photo', start: 0, end: 7.887 },
  { number: 2, name: 'post', treatment: 'cutout_lift', start: 7.887, end: 15.09 },
  { number: 3, name: 'Close', treatment: 'close', start: 15.09, end: 17.59 },
];

const RECORDS: Record<string, CompiledFrameRecord> = {
  2: {
    id: '02-the-post',
    manifest: {
      pieces: [
        { id: 'ground', at: 0, until: 7.203 },
        { id: 'p_brad', at: 2.17, until: 7.203 },
        { id: 'p_ms', at: 2.17, until: 3.717 },
      ],
      labels: [{ text: 'Brad Smith', at: 2.52, until: 4.92 }],
      marks: [{ kind: 'circle', on: 'p_brad', at: 4.4 }],
      speech: [{ on: 'p_brad', text: 'Keep children with their parents', at: 5.503 }],
      camera: { stops: [{ at: 1.2, aim: 'whole' }] },
    },
  },
};

const pick = (o: Partial<Parameters<typeof pickMoments>[0]> = {}) => pickMoments({ spans: SPANS, records: RECORDS, findings: [], changes: [], ...o });
const ofFrame = (ms: Moment[], n: number) => ms.filter((m) => m.frame === n);
const moment = (frame: number, reel_t: number, what = 'x'): Moment => ({ frame, id: `0${frame}-x`, t: reel_t, reel_t, what, source: 'timeline' });

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rad-sheets-'));
}

/** A stub ffmpeg: writes one flat tile of a colour that changes per call, as the real cut would. */
async function stubCuts() {
  const colours = await Promise.all(['#c02020', '#20c020', '#2020c0'].map((c) => sharp({ create: { width: TILE.W, height: TILE.H, channels: 3, background: c } }).jpeg({ quality: 100 }).toBuffer()));
  const calls: string[][] = [];
  const run: Runner = (_cmd, args) => {
    fs.writeFileSync(args.at(-1)!, colours[calls.length % colours.length]!);
    calls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

// ── pickMoments ────────────────────────────────────────────────────────

test('edge: each frame has a first and last moment inside its span; the reel opens at OPENING_STILL_AT; the close is left out', () => {
  const ms = pick({ records: {} });
  assert.deepEqual(ms.map((m) => [m.frame, m.reel_t, m.source]), [
    [1, OPENING_STILL_AT, 'edge'],
    [1, 7.837, 'edge'],
    [2, 7.937, 'edge'],
    [2, 15.04, 'edge'],
  ]);
  assert.match(ms[0]!.what, /first instant/);
  assert.equal(ms[0]!.id, 'frame-01');
});

test('moments of two frames never merge, however close: each stays in its own frame', () => {
  const ms = pick({ records: {} });
  assert.ok(ms[2]!.reel_t - ms[1]!.reel_t < MERGE_WITHIN);
  assert.equal(ms[1]!.frame, 1);
  assert.equal(ms[2]!.frame, 2);
});

test('timeline: arrivals, exits, marks, labels, speech and camera stops are shot SETTLE after they start, in frame and reel time', () => {
  const ms = ofFrame(pick(), 2);
  const at = (what: RegExp) => ms.find((m) => what.test(m.what));
  const has = (what: RegExp, t: number) => {
    const m = at(what);
    assert.ok(m, String(what));
    assert.equal(m.source === 'timeline' || m.source === 'edge', true);
    assert.ok(Math.abs(m.t - t) <= MERGE_WITHIN, `${what}: ${m.t} vs ${t}`);
    assert.equal(m.reel_t, Math.round((7.887 + m.t) * 1000) / 1000);
  };
  has(/ground arrives/, SETTLE);
  has(/p_brad arrives/, 2.17 + SETTLE);
  has(/p_ms leaves/, 3.717 + SETTLE);
  has(/circle mark on p_brad/, 4.4 + SETTLE);
  has(/label "Brad Smith"/, 2.52 + SETTLE);
  has(/speech "Keep children/, 5.503 + SETTLE);
  has(/camera stop on whole/, 1.2 + SETTLE);
  assert.ok(!ms.some((m) => /p_brad leaves|ground leaves/.test(m.what)), 'a piece that stays to the end has no exit');
  assert.equal(ms[0]!.id, '02-the-post');
});

test('merging: moments within 0.15 s keep every label, the time is the latest unless an edge holds it; further apart they stay; nothing is dropped', () => {
  const spans = [SPANS[1]!];
  const manifest = {
    pieces: [{ id: 'a', at: 2 }, { id: 'b', at: 2.1 }, { id: 'c', at: 2.3 }, { id: 'd', at: 7.1 }],
  };
  const ms = pickMoments({ spans, records: { 2: { id: '02-x', manifest } }, findings: [], changes: [] });
  const pair = ms.find((m) => m.what.includes('a arrives'))!;
  assert.match(pair.what, /a arrives; b arrives/);
  assert.equal(pair.t, 2.7);
  assert.equal(pair.source, 'timeline');
  assert.ok(ms.some((m) => m.what === 'c arrives'), 'just past the window stays its own moment');
  const end = ms.at(-1)!;
  assert.match(end.what, /the frame ends/);
  assert.match(end.what, /d arrives/, 'a late arrival is clamped into the frame and merges with its edge');
  assert.equal(end.source, 'edge');
  assert.equal(end.t, Math.round((7.203 - EDGE_INSET) * 1000) / 1000);
  // Same-time moments with the same label show it once.
  const same = pickMoments({ spans, records: { 2: { id: '02-x', manifest: { pieces: [{ id: 'a', at: 2 }, { id: 'a', at: 2 }] } } }, findings: [], changes: [] });
  assert.equal(same.find((m) => m.what.includes('a arrives'))!.what, 'a arrives');
});

test('finding: the middle of each named range, on the frame it names, in the real checks\' line shapes', () => {
  assert.deepEqual(findingTimes('"x" is parked (7s–7.8s)'), [7.4]);
  assert.deepEqual(findingTimes('"x" sits low (1.2s); and again (3s-5s)'), [1.2, 4]);
  assert.deepEqual(findingTimes('mark something the picture shows'), []);
  assert.deepEqual(findingTimes('"x" is visible with no picture (from 2.3s)'), [2.3]);
  assert.deepEqual(findingTimes('"x" is still fading in at the first instant (t = 0.1s, opacity 0.40): put it on'), [0.1]);
  assert.deepEqual(findingTimes('"x" first shows at 6.8s, in the frame\'s last 1s: too late'), [6.8]);
  assert.deepEqual(findingTimes('the face sits at x 540, y 1300 (2s–3s); centre it at y 800–1100'), [2.5]);
  const ms = pick({
    findings: [
      'screen: [off_frame] 02-the-post: "Azure Government" is parked partly off the edge (6.5s–6.7s)',
      'bounds: 01-open: "Headline" sits under the captions (5.0s)',
      'screen: [mark_on_nothing] 02-the-post: a highlight mark was skipped: no time named',
      'screen: [off_frame] 09-another: not one of these frames (1s)',
    ],
  });
  const two = ofFrame(ms, 2).find((m) => m.source === 'finding')!;
  assert.equal(two.t, 6.6);
  assert.match(two.what, /^check: \[off_frame\] "Azure Government"/);
  assert.ok(!two.what.includes('02-the-post'));
  const one = ofFrame(ms, 1).find((m) => m.source === 'finding')!;
  assert.equal(one.reel_t, 5);
  assert.equal(ms.filter((m) => m.source === 'finding').length, 2);
  // With no compiled read to name ids, the frame comes from the id-shaped word.
  assert.ok(ofFrame(pick({ records: {}, findings: ['screen: [void] 02-the-post: empty (2s)'] }), 2).some((m) => m.source === 'finding' && m.t === 2));
});

test('change: a sharp change the timeline doesn\'t explain becomes a moment; cuts and landing events do not; a frame with no manifest gets them all', () => {
  const start = 7.887;
  // A cut at the frame's start, an arrival landing (2.17 + 0.3), and the close's span: all explained or not this frame's.
  const quiet = ofFrame(pick({ changes: [start + 0.033, start + 2.47, 16] }), 2);
  assert.deepEqual(quiet.filter((m) => m.source === 'change'), []);
  // Solver-written frames may have no manifest: only the scene score sees them.
  const bare = ofFrame(pick({ records: {}, changes: [start + 2.4] }), 2).filter((m) => m.source === 'change');
  assert.deepEqual(bare.map((m) => m.reel_t), [Math.round((start + 2.4) * 1000) / 1000]);
  const free = pickMoments({ spans: [SPANS[0]!], records: { 1: { id: '01-a', manifest: { pieces: [{ id: 'a', at: 0 }] } } }, findings: [], changes: [4.3] });
  assert.deepEqual(free.filter((m) => m.source === 'change').map((m) => [m.t, m.what]), [[4.3, 'the picture changes sharply']]);
});

test('sceneChanges: reads the kept frames\' times from showinfo and fails open', () => {
  const stderr = '[Parsed_showinfo_2 @ 0x1] n:   0 pts: 387 pts_time:4.3     duration:3\n[Parsed_showinfo_2 @ 0x1] n:   1 pts: 711 pts_time:7.9 \n';
  let args: string[] = [];
  const run: Runner = (_c, a) => {
    args = a;
    return { status: 0, stdout: '', stderr };
  };
  assert.deepEqual(sceneChanges('video.mp4', { run }), [4.3, 7.9]);
  assert.ok(args.some((a) => /select='gt\(scene,[\d.]+\)',showinfo/.test(a)));
  assert.deepEqual(sceneChanges('video.mp4', { run: () => ({ status: 1, stdout: '', stderr: 'pts_time:1' }) }), []);
});

// ── Sheets ─────────────────────────────────────────────────────────────

test('layout by moment count: 1, 2 across, 2x2, 3x2', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => { const g = sheetGrid(n); return `${g.cols}x${g.rows}`; }), ['1x1', '2x1', '2x2', '2x2', '3x2', '3x2']);
});

test('makeSheets: tiles stay 441x784 at every count, the strip sits outside the picture, and more than six starts another sheet', async () => {
  const dir = tempDir();
  const { run, calls } = await stubCuts();
  const counts = { 1: 1, 2: 2, 3: 3, 4: 5, 5: 7 };
  const moments = Object.entries(counts).flatMap(([f, n]) => Array.from({ length: n }, (_, i) => moment(Number(f), Number(f) * 10 + i)));
  const sheets = await makeSheets('v.mp4', moments, dir, { run });

  assert.deepEqual(sheets.map((s) => [s.frame, s.moments.length]), [[1, 1], [2, 2], [3, 3], [4, 5], [5, 6], [5, 1]]);
  assert.equal(calls.length, moments.length, 'near-identical or not, every moment gets its tile');
  assert.deepEqual(sheets.flatMap((s) => s.moments).sort((a, b) => a.reel_t - b.reel_t), moments.sort((a, b) => a.reel_t - b.reel_t));
  assert.ok(calls.every((a) => a.includes(`scale=${TILE.W}:${TILE.H}`)));
  for (const s of sheets) {
    const { width, height } = await sharp(s.file).metadata();
    const { cols, rows } = sheetGrid(s.moments.length);
    assert.equal(width, cols * TILE.W + (cols - 1) * 8, 'columns of full-size tiles');
    assert.ok(height! > rows * TILE.H + (rows - 1) * 8, 'rows of full-size tiles, with strips besides');
    assert.ok(height! < 2000, 'under the API limit for many images');
  }
  assert.deepEqual(fs.readdirSync(dir).sort(), ['frame-01-1.jpg', 'frame-02-1.jpg', 'frame-03-1.jpg', 'frame-04-1.jpg', 'frame-05-1.jpg', 'frame-05-2.jpg'], 'only sheets are left behind');
});

test('makeSheets: the picture is whole below its strip; the strip is drawn on black beside it', async () => {
  const dir = tempDir();
  const { run } = await stubCuts();
  const [sheet] = await makeSheets('v.mp4', [moment(1, 2, 'p_brad arrives')], dir, { run });
  const { data, info } = await sharp(sheet!.file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
  const strip = info.height - TILE.H;
  assert.equal(info.width, TILE.W);
  assert.ok(strip >= 38, 'a strip above the picture');
  for (const [x, y] of [[0, strip + 2], [TILE.W - 1, strip + 2], [0, info.height - 1], [TILE.W - 1, info.height - 1], [220, strip + 392]]) {
    const [r, g, b] = px(x!, y!);
    assert.ok(r! > 150 && g! < 70 && b! < 70, `the tile's colour at ${x},${y}: ${[r, g, b]}`);
  }
  // The label is really drawn: some pixels in the strip are light.
  let light = 0;
  for (let y = 0; y < strip - 4; y++) for (let x = 0; x < TILE.W; x++) if (px(x, y)[0]! > 160) light++;
  assert.ok(light > 200, `label pixels: ${light}`);
});

test('labels: frame, both times and what happens; wrapped, capped and safe for SVG', async () => {
  const lines = stripLines({ ...moment(3, 23.41, 'p_brad arrives & <circle> mark'), t: 2.13 });
  assert.equal(lines[0], 'Frame 3 · reel 23.4s · frame 2.1s');
  assert.equal(lines[1], 'p_brad arrives & <circle> mark');
  const svg = stripSvg(lines, 100);
  assert.match(svg, /&amp; &lt;circle&gt;/);
  await sharp(Buffer.from(svg)).png().toBuffer();
  const long = stripLines(moment(3, 1, 'word '.repeat(80)));
  assert.equal(long.length, 7);
  assert.ok(long.every((l) => l.length <= 34));
  assert.ok(long.at(-1)!.endsWith('…'));
  assert.deepEqual(stripLines({ ...moment(3, 23.41, ''), t: 2.13 }), ['Frame 3 · 23.4s']);
  const unbroken = stripLines(moment(3, 1, 'x'.repeat(50)));
  assert.equal(unbroken.length, 3);
});

test('viewerSheets: the same tiles with nothing from the plan on them', async () => {
  const dir = tempDir();
  const { run } = await stubCuts();
  const sheets = await viewerSheets('v.mp4', [moment(1, 2, 'p_brad arrives')], dir, { run });
  assert.equal(sheets[0]!.moments[0]!.what, '');
  assert.equal(sheets[0]!.moments[0]!.reel_t, 2);
});

test('stills fail loudly, re-made frames leave no old sheets, and fullStill is unscaled', async () => {
  const dir = tempDir();
  const { run, calls } = await stubCuts();
  await makeSheets('v.mp4', Array.from({ length: 7 }, (_, i) => moment(1, i)), dir, { run });
  assert.equal(fs.readdirSync(dir).length, 2);
  await makeSheets('v.mp4', [moment(1, 1)], dir, { run });
  assert.deepEqual(fs.readdirSync(dir), ['frame-01-1.jpg']);
  await assert.rejects(makeSheets('v.mp4', [moment(2, 1)], dir, { run: () => ({ status: 1, stdout: '', stderr: 'boom' }) }), /the still at 1s failed: boom/);
  await assert.rejects(makeSheets('v.mp4', [moment(2, 1)], dir, { run: () => ({ status: 0, stdout: '', stderr: '' }) }), /the still at 1s failed/, 'past the end, ffmpeg exits 0 and writes nothing');
  assert.deepEqual(fs.readdirSync(dir), ['frame-01-1.jpg'], 'a failed call leaves no tile folder');
  assert.deepEqual(await makeSheets('v.mp4', [], dir, { run }), []);
  const file = path.join(dir, 'nested', 'full.jpg');
  assert.equal(await fullStill('v.mp4', 3.5, file, { run }), file);
  const last = calls.at(-1)!;
  assert.ok(last.includes('3.5') && !last.includes('-vf'));
});

// ── The real project (tests/fixtures/iter11-live: the first live reel's storyboard, frames, timing and phone video) ──────

const LIVE = path.join(process.cwd(), 'tests', 'fixtures', 'iter11-live');
const LIVE_PROJECT = path.join(LIVE, 'project');
const LIVE_VIDEO = path.join(LIVE, 'video-phone.mp4');
const LIVE_FRAMES = ['04-the-post-goes-viral', '08-old-email-unexplained-line', '09-300-000-signatures'];
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

type LiveBlueprint = {
  pieces?: { id: string; on?: string }[];
  labels?: { text: string; on?: string }[];
  marks?: { kind: string; on_piece?: string; on?: string }[];
  arrows?: { from: string; to: string; on?: string }[];
  speech?: { on?: string; piece?: string; text: string }[];
  camera?: { stops?: { on?: string; aim: string }[] };
};

/**
 * A frame's manifest as the stage reports it, rebuilt offline from its compiled module and its voice timing: each piece,
 * mark, arrow, label and camera stop lands on the first word of its `on` phrase (0 when it has none). The browser that
 * normally reports it isn't available to tests.
 */
function liveRecord(id: string): CompiledFrameRecord {
  const js = fs.readFileSync(path.join(LIVE_PROJECT, 'assets', 'frames', `${id}.js`), 'utf8');
  const bp = (JSON.parse(js.slice(js.indexOf('compiledFrame(') + 'compiledFrame('.length, js.lastIndexOf(');'))) as { blueprint: LiveBlueprint }).blueprint;
  const timing = JSON.parse(fs.readFileSync(path.join(LIVE_PROJECT, 'assets', 'timing', `${id}.json`), 'utf8')) as { duration: number; words: { text: string; start: number }[] };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim().split(' ').filter(Boolean);
  const words = timing.words.map((w) => ({ w: norm(w.text).join(''), at: w.start }));
  const cue = (on?: string) => {
    const want = norm(on ?? '');
    if (!want.length) return 0;
    const i = words.findIndex((_, k) => want.every((x, j) => words[k + j]?.w === x.replace(/ /g, '')));
    return i < 0 ? 0 : words[i]!.at;
  };
  return {
    id,
    duration: timing.duration,
    manifest: {
      pieces: (bp.pieces ?? []).map((p) => ({ id: p.id, at: cue(p.on) })),
      marks: (bp.marks ?? []).map((k) => ({ kind: k.kind, on: k.on_piece ?? null, at: cue(k.on) })),
      arrows: (bp.arrows ?? []).map((a) => ({ from: a.from, to: a.to, at: cue(a.on) })),
      labels: (bp.labels ?? []).map((l) => ({ text: l.text, at: cue(l.on) })),
      speech: (bp.speech ?? []).map((s) => ({ on: s.piece ?? '', text: s.text, at: cue(s.on) })),
      camera: { stops: (bp.camera?.stops ?? []).map((s) => ({ at: cue(s.on), aim: s.aim })) },
    },
  };
}

function liveInput() {
  const spans = frameSpans(fs.readFileSync(path.join(LIVE_PROJECT, 'STORYBOARD.md'), 'utf8'));
  const records = Object.fromEntries(LIVE_FRAMES.map((id) => [String(Number(id.slice(0, 2))), liveRecord(id)]));
  return { spans, records };
}

test('real project: all four sources on the live reel\'s storyboard, frames and timing; nothing within 0.15 s of another in a frame', () => {
  const { spans, records } = liveInput();
  // Real check lines, in the shapes the kit writes them (assemble prefixes the step).
  const findings = [
    'screen: [off_frame] 08-old-email-unexplained-line: "p_old" is mostly off the edge (2.1s–2.9s)',
    'screen: [low_contrast] 09-300-000-signatures: "p_count" reads at contrast 1.8:1 against what is behind it (from 4.2s); give it a plate or a contrasting colour',
    'bounds: 04-the-post-goes-viral: [too_small] "boycott" is too small to read on a phone (14px on screen, at least 28px; push in, enlarge, or make it filler) (1.0s)',
  ];
  // Scene changes the video really has at its cuts, plus two the timeline can't explain: 4.3 s into frame 1, which has no manifest, and frame 8.
  const changes = [4.3, 7.9, 22.467, 45.367, 48.966, 52.7];
  const ms = pickMoments({ spans, records, findings, changes });
  const story = spans.filter((s) => s.treatment !== 'close');

  assert.deepEqual([...new Set(ms.map((m) => m.frame))], story.map((s) => s.number), 'every story frame, the close left out');
  for (const s of story) {
    const own = ofFrame(ms, s.number);
    assert.ok(own.every((m) => m.reel_t >= s.start && m.reel_t < s.end), `frame ${s.number} stays in its span`);
    assert.ok(own.every((m, i) => i === 0 || m.t - own[i - 1]!.t > MERGE_WITHIN), `frame ${s.number} has no two moments within ${MERGE_WITHIN}s`);
    assert.ok(own.length >= 2 && own[0]!.source === 'edge' && own.at(-1)!.source === 'edge', `frame ${s.number} has both edges`);
  }
  assert.equal(ms[0]!.reel_t, OPENING_STILL_AT);
  for (const n of [4, 8, 9]) assert.ok(ofFrame(ms, n).some((m) => m.source === 'timeline'), `frame ${n} has timeline moments`);
  assert.ok(ofFrame(ms, 1).every((m) => m.source !== 'timeline'), 'a frame with no manifest has no timeline moments');

  const f8 = ofFrame(ms, 8);
  assert.ok(f8.some((m) => /p_ice arrives/.test(m.what) && /p_contract arrives/.test(m.what)), 'two pieces on the same word share one tile with both labels');
  assert.ok(f8.some((m) => /circle mark on p_face/.test(m.what)));
  assert.ok(f8.some((m) => /arrow p_contract to p_old/.test(m.what)));
  assert.ok(f8.some((m) => m.source === 'finding' && m.t === 2.5 && /\[off_frame\] "p_old"/.test(m.what)));
  assert.ok(ofFrame(ms, 9).some((m) => /check: \[low_contrast\]/.test(m.what) && m.t === 4.2), 'an open range is shot where it starts');
  assert.ok(ofFrame(ms, 4).some((m) => /check: \[too_small\] "boycott"/.test(m.what) && m.t === 1), 'bounds lines name the frame before the rule');
  assert.ok(ofFrame(ms, 9).some((m) => /counter/.test(m.what) || /p_count arrives/.test(m.what)));

  const change = ms.filter((m) => m.source === 'change');
  assert.deepEqual(change.map((m) => [m.frame, m.reel_t]), [[1, 4.3], [8, 48.966]], 'cuts are the edges; only unexplained changes become moments');
});

test('real video: sceneChanges reads the rendered reel\'s cuts with ffmpeg', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const changes = sceneChanges(LIVE_VIDEO);
  const { spans } = liveInput();
  assert.ok(changes.length >= 8, `changes: ${changes.join(', ')}`);
  // Most frame cuts show as a sharp change within a frame of video of the storyboard's start.
  const cuts = spans.slice(1).filter((s) => changes.some((c) => Math.abs(c - s.start) <= 0.1));
  assert.ok(cuts.length >= spans.length / 2, `cuts seen: ${cuts.map((s) => s.number).join(', ')}`);
  const ms = pickMoments({ ...liveInput(), findings: [], changes });
  assert.ok(ms.some((m) => m.source === 'change'), 'the live reel has changes no timeline explains');
});

test('real video: a frame\'s sheet is cut from the video, tiles full size, the picture whole below its label', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const dir = tempDir();
  const ms = ofFrame(pickMoments({ ...liveInput(), findings: [], changes: [] }), 8);
  assert.ok(ms.length > 4, 'enough moments to fill a 3x2 sheet');
  const sheets = await makeSheets(LIVE_VIDEO, ms, dir);
  assert.deepEqual(sheets.flatMap((s) => s.moments), ms, 'every moment on a tile, in order');
  const sheet = sheets[0]!;
  const { cols, rows } = sheetGrid(sheet.moments.length);
  const { data, info } = await sharp(sheet.file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, cols * TILE.W + (cols - 1) * 8);
  const strip = (info.height - (rows - 1) * 8) / rows - TILE.H;
  assert.ok(strip >= 38 && Number.isInteger(strip), `strip ${strip}`);
  // The first tile's picture is the video at that moment: compare it with a full still scaled to the tile.
  const full = await fullStill(LIVE_VIDEO, sheet.moments[0]!.reel_t, path.join(dir, 'full.png'));
  assert.equal((await sharp(full).metadata()).width, 720, 'the full still is the video\'s own size');
  const want = await sharp(full).resize(TILE.W, TILE.H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  let diff = 0;
  for (let y = 0; y < TILE.H; y++) for (let x = 0; x < TILE.W; x++) for (let c = 0; c < 3; c++) diff += Math.abs(data[((strip + y) * info.width + x) * 3 + c]! - want[(y * TILE.W + x) * 3 + c]!);
  assert.ok(diff / (TILE.W * TILE.H * 3) < 12, `mean difference ${diff / (TILE.W * TILE.H * 3)}`);
});
