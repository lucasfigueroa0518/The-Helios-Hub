import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

import type { BankedCutout } from '@/lib/real-case/bank';
import { estimateRescore } from '@/lib/reel-ai-drama/development/rescore';
import { BANK_CHECK_MODEL, checkBankCutout, estimateBankCheck, runBankCheck, SUBMIT_IDENTITY_TOOL } from '@/lib/reel-ai-drama/harvest/bank-check';
import { BANK_VERDICTS_FILE, fileSha256, loadBankVerdicts, trustedCutouts, type BankVerdicts } from '@/lib/reel-ai-drama/harvest/bank-verdicts';
import { centralCutoutRequests, cutoutSwaps, makeCutouts, useCutouts, wishCutoutRequests } from '@/lib/reel-ai-drama/harvest/cutouts';
import { bankSource } from '@/lib/reel-ai-drama/harvest/sources/bank';
import type { CutPerson, SourceRun, Want } from '@/lib/reel-ai-drama/harvest/types';
import { emptyTrace, noOpFlags } from '@/lib/reel-ai-drama/production/noop';
import type { Asset, CastMember, DirectorPlan, VisualsInventory } from '@/lib/reel-ai-drama/types';

// Iteration 3, Builder D: the pre-mortem's gaps (MD-81, MD-82). Offline: no model, no network, no rembg.

const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({
  id, kind: 'person_photo', file: `media/${id}.jpg`, url: `https://example.com/${id}.jpg`, source_page: null, credit: `Photo ${id}`, license: null,
  shows: `picture ${id}`, people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown', width: 1200, height: 1600,
  phash: null, character_image: false, made: false, upscaled: false, flags: [], ...extra,
});
const inv = (assets: Asset[]): VisualsInventory => ({ assets, usable_count: assets.length, counts: {}, kill: null, usd: 0 });
const member = (name: string, kind: CastMember['kind'] = 'person') => ({ name, kind });

async function jpeg(file: string, w = 400, h = 600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: w, height: h, channels: 3, background: '#8a6f5a' } }).jpeg().toFile(file);
}

/** A stand-in for rembg: a transparent PNG of the same picture. */
const fakeCut: CutPerson = async (src, out) => {
  const info = await sharp(src).ensureAlpha().png().toFile(out);
  return { ok: true, width: info.width, height: info.height, coverage: 0.4 };
};

// ── 1. Cutouts after the writer (its central list, MD-100) ──────────────────

test('centralCutoutRequests: every central person with a verified portrait and no cutout gets one; companies and the cut are skipped', () => {
  const inventory = inv([
    asset('V1', { people: ['Ada Lane'], flags: ['identity:verified'], anchor_for: 'Ada Lane', face: { x: 0.4, y: 0.2, w: 0.2, h: 0.2 } }),
    asset('V2', { people: ['Ada Lane'], flags: ['identity:verified'] }),
    asset('V3', { people: ['Bo Chen'], flags: ['cutout', 'cutout_made'], file: 'media/V3.png' }),
    asset('V4', { people: ['Cy Page'], flags: ['identity:probable'] }),
    asset('V5', { people: ['Di Moss'], flags: ['identity:verified', 'garbled'] }),
    asset('V6', { people: ['Ed Ray'], flags: ['identity:verified'] }),
  ]);
  const central = ['Ada Lane', 'Bo Chen', 'Cy Page', 'Di Moss', 'ed  ray', 'Acme', 'ada lane'];
  const { requests, problems } = centralCutoutRequests(central, [member('Ada Lane'), member('Acme', 'company')], inventory);
  // Ada: anchored by a photo → a plain cutout from her anchor (once, however her name is spelled). Ed: unknown kind but pictured → a person, no anchor → his character image.
  assert.deepEqual(requests, [
    { name: 'Ada Lane', source_id: 'V1', anchor: false },
    { name: 'Ada Lane', source_id: 'V2', anchor: false },
    { name: 'ed  ray', source_id: 'V6', anchor: true },
  ]);
  assert.equal(problems.length, 2, problems.join('\n'));
  assert.match(problems[0]!, /Cy Page has no verified solo portrait/);
  assert.match(problems[1]!, /Di Moss has no verified solo portrait/);
});

test('makeCutouts: cuts into the next V id, anchors only when asked, fails open per person', async () => {
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-cut-'));
  await jpeg(path.join(jobDir, 'media', 'V1.jpg'));
  await jpeg(path.join(jobDir, 'media', 'V7.jpg'));
  const inventory = inv([asset('V1', { people: ['Ada Lane'], flags: ['identity:verified'], qids: ['Q1'] }), asset('V2', { people: ['Bo Chen'], flags: ['identity:verified'] })]);
  const out = await makeCutouts(
    { cutout: fakeCut, detectFaces: async (files) => new Map(files.map((f) => [f, [{ x: 0.3, y: 0.1, w: 0.3, h: 0.3, score: 0.9 }]])) },
    {
      inventory,
      requests: [
        { name: 'Ada Lane', source_id: 'V1', anchor: true },
        { name: 'Bo Chen', source_id: 'V2', anchor: false }, // file missing on disk
        { name: 'Nobody', source_id: 'V99', anchor: false },
      ],
      jobDir,
      jobId: null,
    },
  );
  assert.equal(out.assets.length, 1);
  const cut = out.assets[0]!;
  assert.equal(cut.id, 'V8', 'numbered after the media folder\'s last V file');
  assert.equal(cut.file, 'media/V8.png');
  assert.ok(fs.existsSync(path.join(jobDir, cut.file)));
  assert.equal((await sharp(path.join(jobDir, cut.file)).metadata()).hasAlpha, true);
  assert.deepEqual(cut.people, ['Ada Lane']);
  assert.equal(cut.anchor_for, 'Ada Lane');
  assert.equal(cut.character_image, true);
  for (const f of ['cutout', 'cutout_made', 'cutout_of:V1', 'identity:verified', 'anchor:Ada Lane']) assert.ok(cut.flags.includes(f), f);
  assert.ok(cut.face && cut.phash);
  assert.equal(out.problems.length, 2);
  assert.match(out.problems[0]!, /Bo Chen: media\/V2\.jpg is missing on disk/);
  assert.match(out.problems[1]!, /V99 is not in the inventory/);
  assert.ok(!fs.readdirSync(path.join(jobDir, 'media')).some((f) => f.startsWith('tmp-cutout')));

  // No background remover: one plain problem per person, nothing made.
  const none = await makeCutouts({ cutout: null }, { inventory, requests: [{ name: 'Ada Lane', source_id: 'V1', anchor: false }], jobDir, jobId: null });
  assert.equal(none.assets.length, 0);
  assert.match(none.problems[0]!, /no background remover \(rembg\)/);
});

test('wish photos in cutout treatments are cut out, and only those frames use the cutout', () => {
  const plan: DirectorPlan = {
    frames: [
      { n: 1, name: 'a', line_ids: ['L1'], treatment: 'cutout_lift', asset_ids: ['V9'], purpose: 'p', motion: 'V9 rises', marks: 'ring V9', sound: '', music: 'hold', on_screen: null, shows: [{ person: 'Ada Lane', asset_id: 'V9', treatment: 'cutout_lift' }] },
      { n: 2, name: 'b', line_ids: ['L2'], treatment: 'photo', asset_ids: ['V9'], purpose: 'p', motion: 'push on V9', marks: '', sound: '', music: 'hold', on_screen: null },
      { n: 3, name: 'c', line_ids: ['L3'], treatment: 'collision', asset_ids: ['V9', 'V2', 'V10'], purpose: 'p', motion: '', marks: '', sound: '', music: 'hold', on_screen: null },
    ],
    lines_back: [],
  };
  const inventory = inv([
    asset('V2'),
    asset('V9', { people: ['Ada Lane'], flags: ['wish:W1', 'identity:probable'] }),
    asset('V10', { kind: 'place_photo', flags: ['wish:W2'] }),
  ]);
  const found = [
    { wish: { id: 'W1', person: 'Ada Lane', want: 'Ada on stage', frame_ns: [1, 2, 3], fallback: 'V2' }, asset_id: 'V9' },
    { wish: { id: 'W2', person: null, want: 'the office', frame_ns: [3], fallback: 'V2' }, asset_id: 'V10' },
  ];
  const requests = wishCutoutRequests(plan, found, inventory);
  assert.deepEqual(requests, [{ name: 'Ada Lane', source_id: 'V9', anchor: false, frames: [1, 3] }]);
  const made = [asset('V11', { people: ['Ada Lane'], flags: ['cutout', 'cutout_made', 'cutout_of:V9'], file: 'media/V11.png' })];
  const next = useCutouts(plan, cutoutSwaps(requests, made));
  assert.deepEqual(next.frames.map((f) => f.asset_ids), [['V11'], ['V9'], ['V11', 'V2', 'V10']]);
  assert.equal(next.frames[0]!.shows![0]!.asset_id, 'V11');
  assert.equal(next.frames[0]!.motion, 'V11 rises');
  assert.equal(next.frames[0]!.marks, 'ring V11');
  assert.equal(next.frames[1]!.motion, 'push on V9', 'a plain photo frame keeps the photo');
  assert.deepEqual(useCutouts(plan, []), plan);
});

// ── 2. Bank identity check ─────────────────────────────────────────────────

async function bankRoot(): Promise<{ root: string; cutouts: BankedCutout[] }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-bank-'));
  const dir = path.join(root, 'explainers', 'real-case', 'bank');
  fs.mkdirSync(path.join(dir, 'cutouts'), { recursive: true });
  const cutouts: BankedCutout[] = [];
  for (const [id, name, qid, shade] of [['ada-lane', 'Ada Lane', 'Q1', '#ff0000'], ['bo-chen', 'Bo Chen', 'Q2', '#00ff00']] as const) {
    const file = `explainers/real-case/bank/cutouts/${id}.png`;
    await sharp({ create: { width: 60, height: 80, channels: 4, background: shade } }).png().toFile(path.join(root, file));
    cutouts.push({ id, name, qid, file, width: 60, height: 80, credit: 'c', provenance: `https://commons.wikimedia.org/wiki/File:${name.replace(' ', '_')}_2019.jpg`, approved: true });
  }
  fs.writeFileSync(path.join(dir, 'cutouts.json'), JSON.stringify({ cutouts }));
  return { root, cutouts };
}

const verdict = (root: string, c: BankedCutout, v: 'same' | 'different' | 'unsure', sha?: string) => ({
  id: c.id, name: c.name, qid: c.qid, verdict: v, reason: 'r', reference: null, sha256: sha ?? fileSha256(path.join(root, c.file)), model: 'm', checked_at: 't',
});

test('the harvest skips a banked cutout judged not the same person, only for the file that was checked', async () => {
  const { root, cutouts } = await bankRoot();
  assert.equal(trustedCutouts(cutouts, root).length, 2, 'no verdict file: every cutout stays');
  const verdicts: BankVerdicts = { verdicts: [verdict(root, cutouts[0]!, 'different'), verdict(root, cutouts[1]!, 'unsure')] };
  fs.mkdirSync(path.join(root, path.dirname(BANK_VERDICTS_FILE)), { recursive: true });
  fs.writeFileSync(path.join(root, BANK_VERDICTS_FILE), JSON.stringify(verdicts));
  assert.deepEqual(loadBankVerdicts(root), verdicts);
  assert.deepEqual(trustedCutouts(cutouts, root).map((c) => c.id), ['bo-chen'], '"unsure" keeps the cutout; "different" drops it');
  // A re-made cutout (another file) is not judged by the old verdict.
  const stale: BankVerdicts = { verdicts: [verdict(root, cutouts[0]!, 'different', 'abc')] };
  assert.equal(trustedCutouts(cutouts, root, stale).length, 2);

  const want = (name: string): Want => ({ id: `person:${name}`, kind: 'person_photo', what: name, terms: name, people: [name], qids: [], playerId: null, key_moment: false, sources: ['bank'] });
  const run = { deps: { root } } as unknown as SourceRun;
  assert.deepEqual(await bankSource(want('Ada Lane'), run), []);
  assert.equal((await bankSource(want('Bo Chen'), run)).length, 1);
  // An unreadable verdict file never stops a harvest.
  fs.writeFileSync(path.join(root, BANK_VERDICTS_FILE), '{nope');
  assert.equal(trustedCutouts(cutouts, root).length, 2);
});

test('the bank check: one cached Haiku call per person, auto tool choice, a reference other than the cutout\'s own source; verdicts written', async () => {
  const { root, cutouts } = await bankRoot();
  const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#123456' } }).jpeg().toBuffer();
  const urls: string[] = [];
  const http = (async (u: string | URL) => {
    const url = String(u);
    urls.push(url);
    if (url.includes('wikidata.org')) {
      const qid = new URL(url).searchParams.get('ids')!;
      const p18 = qid === 'Q1' ? 'Ada Lane 2019.jpg' : 'Bo Chen portrait.jpg';
      return new Response(JSON.stringify({ entities: { [qid]: { claims: { P18: [{ rank: 'normal', mainsnak: { datavalue: { value: p18 } } }] } } } }));
    }
    if (url.includes('list=search')) return new Response(JSON.stringify({ query: { search: [{ title: 'File:Ada Lane 2019.jpg' }, { title: 'File:Ada Lane at a desk.jpg' }] } }));
    if (url.includes('Special:FilePath')) return new Response(png);
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const replies = [
    { verdict: 'different', reason: 'Another face.' },
    { verdict: 'same', reason: 'Same face.' },
  ];
  const create = async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    sent.push(params);
    return {
      id: 'm', type: 'message', role: 'assistant', model: BANK_CHECK_MODEL, stop_reason: 'tool_use', stop_sequence: null,
      content: [{ type: 'tool_use', id: 't', name: SUBMIT_IDENTITY_TOOL.name, input: replies.shift() }],
      usage: { input_tokens: 2000, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Message;
  };
  const spent: number[] = [];
  const result = await runBankCheck({ create, http, root, record: async (l) => void spent.push(l.usd) }, cutouts, { verdicts: [] });
  assert.equal(sent.length, 2);
  for (const p of sent) {
    assert.equal(p.model, 'claude-haiku-5-5');
    assert.deepEqual(p.tool_choice, { type: 'auto' });
    assert.ok((p.system as Anthropic.TextBlockParam[])[0]!.cache_control, 'the instructions are cached');
    assert.ok((p.tools![0] as Anthropic.Tool).cache_control, 'the tool is cached');
    assert.equal((p.messages[0]!.content as unknown[]).filter((b) => (b as { type: string }).type === 'image').length, 2);
  }
  // Ada's main image is the file her cutout was cut from, so a depicts file is the reference.
  assert.equal(result.verdicts.verdicts.find((v) => v.id === 'ada-lane')!.reference, 'Ada Lane at a desk.jpg');
  assert.equal(result.verdicts.verdicts.find((v) => v.id === 'bo-chen')!.reference, 'Bo Chen portrait.jpg');
  assert.deepEqual(result.verdicts.verdicts.map((v) => v.verdict), ['different', 'same']);
  assert.equal(spent.length, 2);
  assert.ok(result.usd > 0 && result.usd < 0.05);
  assert.deepEqual(trustedCutouts(cutouts, root).map((c) => c.id), ['bo-chen'], 'the written verdicts take effect');

  // No portrait anywhere: "unsure", no call, no spend.
  const empty = (async (u: string | URL) => new Response(String(u).includes('wikidata') ? JSON.stringify({ entities: {} }) : JSON.stringify({ query: { search: [] } }))) as typeof fetch;
  const lone = await checkBankCutout({ create: async () => assert.fail('no call without a reference'), http: empty, root }, cutouts[0]!);
  assert.equal(lone.verdict.verdict, 'unsure');
  assert.equal(lone.usd, 0);
});

test('the scripts\' estimates stay tiny', () => {
  assert.ok(estimateBankCheck(18) > 0.01 && estimateBankCheck(18) < 0.2, String(estimateBankCheck(18)));
  assert.ok(estimateRescore(4) > 0 && estimateRescore(4) < 0.01, String(estimateRescore(4)));
});

// ── 3. No-op detector ──────────────────────────────────────────────────────

test('noOpFlags: one loud flag per step that quietly did nothing, none when every step did its job', () => {
  const central = ['Ada Lane', 'Bo Chen', 'Acme'];
  const cast = [member('Ada Lane'), member('Bo Chen'), member('Cy Page'), member('Acme', 'company')];
  const inventory = inv([asset('V1', { people: ['Ada Lane'], flags: ['cutout'] }), asset('V2', { people: ['Bo Chen'], flags: ['cutout', 'garbled'] })]);

  const quiet = { ...emptyTrace(), wishes: { planned: 3, notSearched: null }, soundCues: 7 };
  assert.deepEqual(noOpFlags(quiet, { central, cast, inventory: inv([...inventory.assets, asset('V3', { people: ['Bo Chen'], flags: ['cutout'] })]) }), []);

  const loud = noOpFlags(
    { editorFailed: 'overloaded', rewriteFailed: null, wishes: { planned: 2, notSearched: 'no wish search is wired' }, soundCues: 0 },
    { central, cast, inventory },
  );
  assert.deepEqual(loud.map((f) => f.check), ['story', 'render', 'render', 'render']);
  assert.ok(loud.every((f) => f.detail.startsWith('NO-OP: ')));
  assert.match(loud[0]!.detail, /story editor never read the script \(overloaded\)/);
  assert.match(loud[1]!.detail, /wished for 2 shot\(s\) but none was searched \(no wish search is wired\)/);
  assert.match(loud[2]!.detail, /sound designer wrote no cues/);
  assert.match(loud[3]!.detail, /no cutout of Bo Chen, who is central/, 'a garbled cutout does not count; the company and anyone not central are not checked');

  const noRewrite = noOpFlags({ ...emptyTrace(), rewriteFailed: 'timeout' }, { central: [], cast, inventory });
  assert.deepEqual(noRewrite.map((f) => f.detail), ["NO-OP: the writer's rewrite on the story editor's notes failed (timeout). The first draft went out with the notes unanswered."]);
  assert.deepEqual(noOpFlags({ ...emptyTrace(), wishes: { planned: 0, notSearched: 'x' } }, { central: [], cast, inventory }), [], 'no wishes, nothing to search');
});
