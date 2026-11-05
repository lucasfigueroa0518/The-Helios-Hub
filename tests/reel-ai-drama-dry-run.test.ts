// A dry run of the live loop: `runJob` with the real director, plan validation, the pre_build and content_pass fix merges, wish and
// cut-out plumbing, measuring, project files, compile, plan check, cost ledger and job record, on a story and pictures of its own.
// Only the outside world is canned: the model answers at the `create` seam with tool responses, the voice writes timing, the browser
// is JSDOM and the render writes a file. Nothing here reaches a network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';

import { compiledFrame } from '../explainers/reel-ai-drama/kit/components/compiled.js';
import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';
import { parseFrames } from '../explainers/reel-ai-drama/kit/frames.mjs';
import { writeProjectFiles } from '../explainers/reel-ai-drama/kit/project-files.mjs';
import { localArtifactStore } from '../lib/explainers/storage';
import { makeCutouts } from '../lib/reel-ai-drama/harvest/cutouts';
import { measureInventory } from '../lib/reel-ai-drama/harvest/regions';
import { claimNextJob, getJob, listArtifacts, requestJob } from '../lib/reel-ai-drama/production/jobs';
import { runJob, type ProductionDeps } from '../lib/reel-ai-drama/production/run';
import { compileReel, type CompiledRead } from '../lib/reel-ai-drama/render/compile';
import { ensureReelAiDramaSchema } from '../lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS } from '../lib/reel-ai-drama/settings';
import type { Asset, DirectorPlan, FactSheet, Pitch, VisualsInventory, WriterDraft } from '../lib/reel-ai-drama/types';
import { directReel } from '../lib/reel-ai-drama/writing/director';
import { scratchExplainersDb } from './explainers-pglite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const line = (id: string, text: string) => ({ id, text, on_screen: null, fact_ids: ['F1'], must_show: null });
const DRAFT = {
  title: 'The lab that kept the door open',
  hook: { on_screen: 'NOT LOCKED', line_id: 'L1' },
  rungs: [
    { id: 'R1', purpose: 'setup', lines: [line('L1', 'The vault door stood open all winter.'), line('L2', 'Maria Chen wrote the first warning.')] },
    { id: 'R2', purpose: 'turn', lines: [line('L3', 'The memo sat in a drawer for months.'), line('L4', 'Then the logo came down overnight.')] },
  ],
  peak_rung_id: 'R2',
  landing_rung_id: 'R2',
  close_question: 'Who should have read it?',
  word_count: 27,
  central: ['Maria Chen'],
} as unknown as WriterDraft;
const FACTS = {
  summary: 'It happened.', timeline: [], facts: [{ id: 'F1', text: 'It happened.', source_ids: ['S1'], key: true, confidence: 'confirmed' }],
  sources: [{ id: 'S1', url: 'https://example.test/a', title: 'A', publisher: 'Ex', date: null, kind: 'news' }], quotes: [], artifacts: [], cast: [{ name: 'Maria Chen', role: 'Engineer', kind: 'person' }], places: [], verdict: { holds: true, reason: 'Holds.' },
} as unknown as FactSheet;
const PITCH = {
  title: 'The lab that kept the door open', brief: 'A warning nobody read.', story_type: 'deal', era: 'race', event_date: '2024-01-01', date_precision: 'day',
  cast: [{ name: 'Maria Chen', role: 'Engineer', kind: 'person', player_id: null }], why_now: null, expected_visuals: [], sources: [{ url: 'https://example.test/a', title: 'A', publisher: 'Ex', date: null }],
} as unknown as Pitch;
const record = (id: string, file: string, kind: string, extra: Partial<Asset> = {}): Asset => ({
  id, kind, file, url: `https://example.test/${id}`, source_page: null, credit: 'Ex', license: null, shows: `picture ${id}`, people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown',
  width: 800, height: 1000, phash: null, character_image: false, made: false, upscaled: false, flags: [], ...extra,
}) as Asset;

/** Real pictures, each a different kind of hard: a portrait, a tall page, a wide logo, a nearly black room. */
async function harvestInto(dir: string): Promise<VisualsInventory> {
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  const solid = (w: number, h: number, background: string, file: string) => sharp({ create: { width: w, height: h, channels: 3, background } }).jpeg().toFile(path.join(dir, 'media', file));
  await solid(800, 1000, '#88a0c0', 'P1.jpg');
  await solid(700, 2400, '#f4f1e8', 'D1.jpg');
  await sharp({ create: { width: 1200, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: { create: { width: 900, height: 160, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }, left: 150, top: 70 }]).png().toFile(path.join(dir, 'media', 'L1.png'));
  await solid(1600, 900, '#040404', 'R1.jpg');
  return {
    assets: [
      record('P1', 'media/P1.jpg', 'person_photo', { people: ['Maria Chen'], character_image: true, anchor_for: 'Maria Chen', flags: ['key_moment'], width: 800, height: 1000 } as never),
      record('D1', 'media/D1.jpg', 'document', { width: 700, height: 2400 }),
      record('L1', 'media/L1.png', 'logo', { width: 1200, height: 300, flags: ['logo'] }),
      record('R1', 'media/R1.jpg', 'place_photo', { width: 1600, height: 900 }),
    ],
    usable_count: 4, counts: {}, kill: null, usd: 0,
  } as VisualsInventory;
}

const blueprint = (pieces: Any[], extra: Any = {}) => ({ ground: 'charcoal', style: 'cutouts', arrangement: 'solo', pieces, labels: [], speech: [], marks: [], arrows: [], camera: { move: 'push', stops: [{ on: '', aim: 'whole' }] }, sounds: [], ...extra });
const FOCUS = { kind: 'object', what: 'the door' };
const storyFrame = (n: number, name: string, lines: string[], bp: Any, extra: Any = {}) => ({ n, name, line_ids: lines, treatment: 'photo', asset_ids: [], purpose: `Carries ${name}.`, music: n === 1 ? 'start' : 'hold', on_screen: n === 1 ? 'NOT LOCKED' : null, focus: FOCUS, blueprint: bp, ...extra });
const CLOSE = { n: 5, name: 'The question', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'The question plays over it.', music: 'hold', on_screen: null };
/** A plan the director could really send: a dark room filling the frame, a photo of a person to be cut out, a wish, a page, a logo. */
const goodPlan = (): Any => ({
  frames: [
    storyFrame(1, 'The open door', ['L1'], blueprint([{ id: 'room', asset: 'R1', fill: true, on: '' }], { hook: { text: 'NOT LOCKED', on: '' } }), { focus: { kind: 'place', what: 'the dark room' } }),
    storyFrame(2, 'Who wrote it', ['L2'], blueprint([{ id: 'maria', asset: 'P1', label: 'Maria Chen', on: 'Maria' }, { id: 'shot', asset: 'W1', on: 'warning' }], { arrangement: 'lead_inset' }), { treatment: 'collision', focus: { kind: 'person', what: 'Maria Chen' } }),
    storyFrame(3, 'The drawer', ['L3'], blueprint([{ id: 'memo', asset: 'D1', treatment: 'document', on: '' }], { marks: [{ kind: 'underline', on_piece: 'memo', target: 'text:months', on: 'months' }] }), { treatment: 'document', focus: { kind: 'document', what: 'the memo' } }),
    storyFrame(4, 'Down overnight', ['L4'], blueprint([{ id: 'logo', asset: 'L1', on: '' }, { id: 'note', note: 'overnight', note_role: 'date', on: 'overnight', until: 'logo' }]), { treatment: 'lift', focus: { kind: 'logo', what: 'the logo' } }),
    CLOSE,
  ],
  makes: [],
  wishes: [{ id: 'W1', want: 'Maria Chen at her desk', person: 'Maria Chen', fallback: 'R1', as: 'photo' }],
  lines_back: [],
});

type Toolset = { plan?: Any[]; createFails?: (tool: string) => boolean };

function harness(db: Any, tools: Toolset, over: { checks?: Partial<ProductionDeps['checks']>; render?: Partial<ProductionDeps['render']>; harvest?: Partial<ProductionDeps['harvest']>; writing?: Partial<ProductionDeps['writing']> } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-dry-'));
  const planAnswers = [...(tools.plan ?? [])];
  const requests: Any[] = [];
  const log: string[] = [];
  const voiced: string[] = [];
  /** The model, at the one seam every paid call goes through. */
  const create = async (params: Any) => {
    requests.push(params);
    const tool = params.tools[0].name as string;
    if (tools.createFails?.(tool)) throw new Error(`${tool}: the API said no`);
    // A fix or soft round inside one call gets that call's answer again; each new call takes the next.
    if (tool === 'submit_plan' && params.messages.length === 1 && planAnswers.length > 1 && requests.some((r) => r !== params && r.tools[0].name === tool)) planAnswers.shift();
    const input = planAnswers[0];
    if (tool === 'submit_plan' && params.messages.length > 1) log.push(String(params.messages.at(-1).content[0]?.content ?? params.messages.at(-1).content).slice(0, 600));
    return { id: 'm', model: params.model, role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `u${requests.length}`, name: tool, input: JSON.parse(JSON.stringify(input)) }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 } };
  };
  const base = (ctx: Any) => ({ db, create, mode: ctx.mode, jobId: ctx.jobId, settings: ctx.settings });
  const heldPlan: { plan: DirectorPlan | null; draft: WriterDraft | null } = { plan: null, draft: null };

  /** What the kit's browser check reports for one frame, from the module compile wrote. */
  const buildFrame = async (projectDir: string, f: { number: number; id: string; name: string; duration: number }) => {
    const source = fs.readFileSync(path.join(projectDir, 'assets', 'frames', `${f.id}.js`), 'utf8');
    const spec = JSON.parse(/compiledFrame\(([\s\S]*?\})(?:, \{[^{}]*\})?\);\s*$/.exec(source)![1]);
    const customModules: Any = {};
    for (const c of spec.custom ?? []) customModules[`${c.id}.js`] = (await import(pathToFileURL(path.join(projectDir, 'assets', 'custom', `${c.id}.js`)).href)).default;
    const win = new JSDOM('<!doctype html><html><body></body></html>').window as Any;
    (nk as Any).installKit(win.document, { fonts: 'f/', textures: 't/' });
    const host = win.document.createElement('div');
    win.document.body.append(host);
    const timing = JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'timing', `${f.id}.json`), 'utf8'));
    const media = Object.fromEntries((JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'inventory.json'), 'utf8')).assets as Any[]).map((a) => [a.id, a]));
    const frame = (compiledFrame as Any)(spec, customModules);
    try {
      frame.build(host, { id: f.id, duration: timing.duration, media, timing, nk });
      for (let t = 0; t <= timing.duration; t += 0.5) frame.render(t);
    } catch (e) {
      return { id: f.id, name: f.name, duration: timing.duration, failed: String(e), reports: [], notes: [] };
    }
    const rec = win.document.__compiled[f.id];
    const notes = [...(win.document.__stageNotes ?? [])];
    win.close();
    return { id: f.id, name: f.name, duration: timing.duration, ...rec, notes };
  };
  const storyFrames = (dir: string) => (parseFrames(fs.readFileSync(path.join(dir, 'STORYBOARD.md'), 'utf8')) as Any[]).filter((f) => fs.existsSync(path.join(dir, 'assets', 'frames', `${f.id}.js`)));
  const readCompiled = async (dir: string): Promise<CompiledRead> => {
    const frames: Any = {};
    for (const f of storyFrames(dir)) frames[f.number] = await buildFrame(dir, f);
    return { ok: true, frames, stills: storyFrames(dir).map((f) => ({ number: f.number, name: f.name, id: f.id, at: 1, file: 'still.jpg' })) };
  };

  const deps: ProductionDeps = {
    db,
    store: localArtifactStore(path.join(root, 'storage')),
    jobsRoot: path.join(root, 'jobs'),
    secrets: { anthropicApiKey: 'test', heygenApiKey: 'test' },
    voiceId: 'voice-1',
    jev: () => ({ callCount: 0, ask: async () => { throw new Error('no live Jev here'); } }) as never,
    pool: { nextForProduction: async () => null },
    reporting: { reportStory: async () => JSON.parse(JSON.stringify(FACTS)) },
    harvest: {
      harvestVisuals: async (i) => harvestInto(i.jobDir),
      recordUses: async () => undefined,
      // What the live search returns: a found picture, saved to the harvest with its file on disk.
      searchWishes: async (i) => {
        const found = [];
        for (const w of i.wishes) {
          if (w.id !== 'W1') continue;
          await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#a08070' } }).jpeg().toFile(path.join(i.jobDir, 'media', 'F1.jpg'));
          found.push({ wish_id: w.id, asset: record('F1', 'media/F1.jpg', 'person_photo', { people: ['Maria Chen'], width: 900, height: 1200 }) });
        }
        return { found, problems: [], usd: 0 };
      },
      // The real cut-out step around a stand-in for rembg: it keeps an oval of the photo.
      cutPeople: (i) => makeCutouts({
        cutout: async (src, out) => {
          const { width = 800, height = 1000 } = await sharp(src).metadata();
          const oval = Buffer.from(`<svg width="${width}" height="${height}"><ellipse cx="${width / 2}" cy="${height * 0.55}" rx="${width * 0.36}" ry="${height * 0.42}" fill="#fff"/></svg>`);
          await sharp(src).ensureAlpha().composite([{ input: oval, blend: 'dest-in' }]).png().toFile(out);
          return { ok: true, width, height, coverage: 0.4 };
        },
        detectFaces: null,
        db: null,
      }, i),
      ...over.harvest,
    },
    writing: {
      writeScript: async () => JSON.parse(JSON.stringify(DRAFT)),
      editStory: async () => ({ tell_back: 'A warning nobody read.', notes: [] }),
      reviseScript: async (i) => JSON.parse(JSON.stringify(i.draft)),
      directReel: (i, ctx) => directReel(base(ctx) as never, i),
      writePost: async () => ({ caption: 'cap', credits: ['Ex'], question: 'q?' }),
      ...over.writing,
    },
    checks: {
      checkFacts: async () => ({ unsupported: [] }),
      checkIntegrity: async () => ({ problems: [] }),
      checkFirstViewer: async () => ({ hookSeconds: 1, understood: true, problems: [] }),
      ...over.checks,
    },
    render: {
      kitGuide: 'THE KIT GUIDE',
      prepareWorkspace: async ({ jobsRoot, jobId }) => {
        const jobDir = path.join(jobsRoot, jobId);
        const ws = { jobDir, projectDir: path.join(jobDir, 'project'), homeDir: path.join(jobDir, 'home'), tmpDir: path.join(jobDir, 'tmp') };
        for (const d of [ws.projectDir, ws.homeDir, ws.tmpDir]) fs.mkdirSync(d, { recursive: true });
        return ws;
      },
      writeProjectFiles: (dir, i) => {
        heldPlan.plan = i.plan;
        heldPlan.draft = i.draft;
        return (writeProjectFiles as Any)(dir, { ...i, mediaRoot: path.dirname(dir) });
      },
      measurePictures: (inventory, dir) => measureInventory(inventory, dir),
      // The voice: every frame's words, evenly timed, in the file the kit reads.
      runVoice: async (dir) => {
        voiced.push(dir);
        fs.mkdirSync(path.join(dir, 'assets', 'timing'), { recursive: true });
        const text = new Map(heldPlan.draft!.rungs.flatMap((r) => r.lines.map((l) => [l.id, l.text] as const)));
        for (const f of parseFrames(fs.readFileSync(path.join(dir, 'STORYBOARD.md'), 'utf8')) as Any[]) {
          const planned = heldPlan.plan!.frames.find((x) => x.n === f.number)!;
          let t = 0.1;
          const words: Any[] = [];
          const lines = planned.line_ids.map((id) => {
            const start = t;
            for (const w of text.get(id)!.split(' ')) { words.push({ text: w, start: t, end: t + 0.3 }); t += 0.35; }
            return { id, start, end: t, label: null };
          });
          fs.writeFileSync(path.join(dir, 'assets', 'timing', `${f.id}.json`), JSON.stringify({ duration: Math.max(2.5, t + 0.3), words, lines }));
        }
      },
      compileReel: (i) => compileReel({ ...i, readWords: null }),
      readCompiled,
      assembleProject: async () => ({ ok: true, problems: [] }),
      renderVideo: async (dir) => {
        const f = path.join(dir, 'renders', 'video.mp4');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, 'mp4');
        return f;
      },
      contactSheet: async (dir) => {
        const f = path.join(dir, 'snapshots', 'contact-sheet.png');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, 'png');
        return f;
      },
      // Sheets of moments: one labelled sheet a story frame for the reviewers, one unlabelled sheet of the reel for the first viewer.
      reelSheets: async (dir, _video, i) => {
        const story = storyFrames(dir).map((f: Any) => f.number as number);
        const moment = (n: number, what: string) => ({ frame: n, id: `f${n}`, t: 1, reel_t: n, what, source: 'edge' as const });
        return {
          review: (i.frames ?? story).map((n) => ({ frame: n, file: path.join(i.dir, `frame-${n}.jpg`), moments: [moment(n, 'it lands')] })),
          viewer: i.viewer ? [{ frame: 1, file: path.join(i.dir, 'viewer.jpg'), moments: story.map((n: number) => moment(n, '')) }] : [],
        };
      },
      videoSeconds: async () => 58,
      ...over.render,
    },
  };
  return { deps, requests, voiced, heldPlan, root, log };
}

async function freshJob() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.pitches (title, pitch, event_key, status, rank_score, drama_score, material_score, visuals_grade, drama, visuals_card)
     VALUES ($1, $2::jsonb, $3, 'pooled', 0.9, 0.8, 0.7, 'green', $4::jsonb, $5::jsonb) RETURNING id`,
    [PITCH.title, JSON.stringify(PITCH), `key:${PITCH.title}`, JSON.stringify({ score: 0.8, notes: { central_want: 'clear' } }), JSON.stringify({ grade: 'green', faces: [], specific_count: 4, kinds: ['person_photo'], counts: {}, gaps: [], sample: [], usd: 0.1 })],
  );
  const req = await requestJob(db, { pitchId: rows[0].id, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.ok(req.ok);
  const job = await claimNextJob(db);
  assert.ok(job);
  return { db, job: job! };
}

const flagsOf = async (db: Any, id: string) => (await getJob(db, id))!.flags.map((f) => f.detail);

test('dry run: a fresh story goes through the whole live loop, first plan to delivery', async () => {
  const { db, job } = await freshJob();
  const designed: number[][] = [];
  const { deps, requests, voiced, heldPlan, root, log } = harness(db, {
    plan: [
      goodPlan(),
      // The image check's pre_build fix: only the frame it asked about, renamed and carrying someone else's line. On paper, so the
      // re-check's variety still finds no four frames alike (a solo frame on charcoal would make it escalate).
      { frames: [storyFrame(2, 'A new name', ['L1', 'L2'], blueprint([{ id: 'maria', asset: 'P1', on: 'Maria' }], { ground: 'kraft', style: 'paper' }), { treatment: 'collision', focus: { kind: 'person', what: 'Maria Chen' } })], makes: [], wishes: [], lines_back: [] },
      // The content pass (the design review found something missing), likewise partial.
      { frames: [storyFrame(3, 'Another name', ['L3'], blueprint([{ id: 'memo', asset: 'D1', treatment: 'document', on: 'memo' }]), { treatment: 'document', focus: { kind: 'document', what: 'the memo' } })], makes: [], wishes: [], lines_back: [] },
    ],
  }, {
    checks: {
      checkIntegrity: (() => {
        let round = 0;
        return async () => (round++ ? { problems: [] } : { problems: [{ frame: 2, asset_id: 'F1', why: 'The picture shows someone else.' }] });
      })(),
      checkDesign: async (i) => {
        designed.push([...new Set(i.sheets.map((x) => x.frame))]);
        return {
          // The off-edge finding is the solver's, not the director's: it ships as a flag here (no solver is wired).
          problems: designed.length === 1 ? [{ frame: 3, item: 'nothing_missing', severity: 'problem', what: 'The drawer is never shown.' }, { frame: 4, item: 'off_edge', severity: 'problem', what: 'The logo runs off.' }] : [],
          warnings: [],
          errors: [],
          usd: 0,
        } as never;
      },
    },
  });
  const result = await runJob(deps, job);
  const flags = await flagsOf(db, job.id);
  assert.equal(result.status, 'ok', `${JSON.stringify(result)}\n${flags.join('\n')}`);
  assert.deepEqual(log.map((l) => /frame 4's blueprint: piece "note" \(until\)/.test(l)), [true], 'the only round beyond the plan and its two fixes is the one soft finding this plan earns');

  const projectDir = path.join(root, 'jobs', job.id, 'project');
  // Frame ids held through both fixes: every story frame has a module, an events file and the voice's timing, and it was voiced once.
  const frames = parseFrames(fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8')) as Any[];
  assert.deepEqual(frames.map((f) => f.name), ['The open door', 'Who wrote it', 'The drawer', 'Down overnight', 'The question']);
  for (const f of frames.slice(0, -1)) {
    for (const file of [`assets/frames/${f.id}.js`, `assets/frames/${f.id}.events.json`, `assets/timing/${f.id}.json`]) assert.ok(fs.existsSync(path.join(projectDir, file)), file);
  }
  assert.equal(voiced.length, 1, 'a fix never touches the voice');
  assert.deepEqual(heldPlan.plan!.frames.flatMap((f) => f.line_ids), ['L1', 'L2', 'L3', 'L4'], 'every line once');
  assert.ok(!flags.some((d) => /word_missing/.test(d) && !/nope/.test(d)), flags.filter((d) => /word_missing/.test(d)).join('\n'));

  // The wish was searched, and the person on the stage stands as a real, cleaned cut-out, also in the frame a fix changed.
  const inventory = JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'inventory.json'), 'utf8')) as VisualsInventory;
  const cuts = inventory.assets.filter((a) => a.flags.includes('cutout'));
  assert.ok(cuts.length >= 1, 'stage cut-outs were made');
  assert.ok(cuts.every((a) => a.regions?.cut?.with_source === true), 'and cleaned with their photos in hand');
  const second = heldPlan.plan!.frames[1].blueprint!.pieces.map((p) => p.asset);
  assert.ok(cuts.some((a) => second.includes(a.id)), `frame 2 stages the cut-out: ${second.join()}`);
  assert.ok(inventory.assets.every((a) => a.regions?.shape !== undefined || a.regions?.brightness !== undefined), 'every picture was measured');

  // The design review read every story frame, then only the frame the content pass changed; the off-edge finding stayed a flag.
  assert.deepEqual(designed, [[1, 2, 3, 4], [3]]);
  assert.ok(flags.includes('Design: Frame 4, nothing off the edge: The logo runs off.'), flags.join('\n'));
  assert.ok(!flags.some((d) => /never shown/.test(d)), 'the content pass answered it');

  // Every call put its breakpoint on the stable prefix.
  const plans = requests.filter((r) => r.tools[0].name === 'submit_plan');
  assert.equal(plans.length, requests.length, 'only the director was asked anything');
  assert.equal(plans.length, 4, 'the plan, its soft round, two fixes: no round spent on a frame nobody asked about');
  assert.deepEqual(plans.slice(2).map((r) => r.model), [DEFAULT_SETTINGS.director_fix_model, DEFAULT_SETTINGS.director_fix_model], 'pre_build and content_pass on the fix model; no escalation');
  for (const r of requests) assert.ok(r.system.at(-1).cache_control, `${r.tools[0].name} caches its system prefix`);
  for (const r of plans) assert.ok(r.messages[0].content[0].cache_control, 'and the plan the shared input');

  // Cost and the record.
  const fresh = (await getJob(db, job.id))!;
  assert.equal(fresh.status, 'ok');
  assert.ok(fresh.spend_usd > 0);
  const { rows } = await db.query<{ component: string }>('SELECT DISTINCT component FROM reel_ai_drama.cost_events WHERE job_id = $1', [job.id]);
  for (const c of ['director', 'director_fix']) assert.ok(rows.some((r) => r.component === c), `${c} is on the ledger: ${rows.map((r) => r.component).join()}`);
  const kinds = (await listArtifacts(db, job.id)).map((a) => a.kind);
  for (const k of ['fact_sheet', 'inventory', 'writer_draft', 'director_plan', 'breakage', 'video', 'contact_sheet', 'delivery_report']) assert.ok(kinds.includes(k as never), k);
});

test('dry run: a piece told to leave before it arrives reaches the job as a report, the frame still builds', async () => {
  const { db, job } = await freshJob();
  const { deps } = harness(db, { plan: [goodPlan()] });
  assert.equal((await runJob(deps, job)).status, 'ok');
  const flags = await flagsOf(db, job.id);
  assert.ok(flags.some((d) => /until_before_on: piece note/.test(d)), flags.join('\n'));
  assert.ok(!flags.some((d) => /stage_failed/.test(d)), flags.join('\n'));
});

test('dry run: a director that never gets its plan right still makes a reel, repaired and flagged', async () => {
  const { db, job } = await freshJob();
  const broken = goodPlan();
  // The last frame isn't the close, numbers wander, a line is lost, a picture doesn't exist, a field of the wrong shape.
  broken.frames = [{ ...broken.frames[0], n: 4 }, { ...broken.frames[2], n: 9, line_ids: ['L3', 'L3'] }, { ...broken.frames[3], blueprint: blueprint([{ id: 'x', asset: 'NOPE', on: '' }]), n: 2 }, { n: 8, treatment: 'photo' }];
  broken.lines_back = null;
  const { deps, requests } = harness(db, { plan: [broken] });
  const result = await runJob(deps, job);
  const flags = await flagsOf(db, job.id);
  assert.equal(result.status, 'ok', `${JSON.stringify(result)}\n${flags.join('\n')}`);
  assert.equal(requests.filter((r) => r.tools[0].name === 'submit_plan' && r.messages[0].content.length === 1).length, 2, 'the first plan was asked once more, and only once');
  assert.ok(flags.some((d) => /^Director plan, /.test(d)), flags.join('\n'));
});

test('dry run: a director with no answer at all fails the job cleanly, with what it cost on record', async () => {
  const { db, job } = await freshJob();
  const { deps } = harness(db, { plan: [goodPlan()], createFails: (t) => t === 'submit_plan' });
  const result = await runJob(deps, job);
  assert.equal(result.status, 'failed');
  assert.match(String((result as Any).error), /the API said no/);
  assert.equal((await getJob(db, job.id))!.status, 'failed');
});

test('dry run: every step after the plan may fail and the reel still ships, each failure flagged', async () => {
  const { db, job } = await freshJob();
  const boom = (what: string) => async () => { throw new Error(`${what} broke`); };
  let directorCalls = 0;
  const { deps, root } = harness(db, { plan: [goodPlan()] }, {
    checks: {
      checkFacts: boom('the facts check') as never,
      // The image check names a frame; its fix then fails.
      checkIntegrity: async () => ({ problems: [{ frame: 2, asset_id: 'F1', why: 'Wrong picture.' }] }),
      checkFirstViewer: boom('the first viewer') as never,
      checkDesign: boom('the design review') as never,
    },
    writing: {
      directReel: async (i, ctx) => {
        directorCalls += 1;
        if (i.fix) throw new Error('the fix call broke');
        return directReel({ db, create: async (p: Any) => ({ id: 'm', model: p.model, role: 'assistant', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'u', name: 'submit_plan', input: goodPlan() }], usage: { input_tokens: 10, output_tokens: 10 } }), mode: ctx.mode, jobId: ctx.jobId, settings: ctx.settings } as never, i);
      },
      writePost: boom('the post text') as never,
    },
    harvest: { recordUses: boom('the reuse record') as never, searchWishes: boom('the wish search') as never },
    render: {
      designSound: boom('the sound designer') as never,
      contactSheet: boom('the contact sheet') as never,
      videoSeconds: boom('ffprobe') as never,
      readCompiled: boom('the plan check') as never,
    },
  });
  const result = await runJob(deps, job);
  const flags = await flagsOf(db, job.id);
  assert.equal(result.status, 'ok', `${JSON.stringify(result)}\n${flags.join('\n')}`);
  assert.ok(directorCalls >= 2);
  for (const said of [/facts check failed/, /wish search failed/, /pre-build re-plan failed/, /sound designer failed/, /plan check could not run/, /contact sheet failed/, /first viewer failed/, /Design review failed; shipped without it: the design review broke/, /post text failed/, /reuse record|used failed/]) {
    assert.ok(flags.some((d) => said.test(d)), `${said}\n${flags.join('\n')}`);
  }
  const artifacts = await listArtifacts(db, job.id);
  assert.ok(artifacts.some((a) => a.kind === 'video'), 'the video was delivered');
  assert.ok(artifacts.some((a) => a.kind === 'delivery_report'));
  assert.ok(fs.existsSync(path.join(root, 'storage')));
});

test('dry run: a render that fails once gets a second try before the reel is lost', async () => {
  const { db, job } = await freshJob();
  let renders = 0;
  const { deps } = harness(db, { plan: [goodPlan()] }, {
    render: {
      renderVideo: async (dir) => {
        renders += 1;
        if (renders === 1) throw new Error('a tab crashed');
        const f = path.join(dir, 'renders', 'video.mp4');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, 'mp4');
        return f;
      },
    },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.equal(renders, 2);
  assert.ok((await flagsOf(db, job.id)).some((d) => /render failed: a tab crashed/.test(d)));
});
