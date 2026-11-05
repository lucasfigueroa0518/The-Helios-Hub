// Write a Reel AI Drama project's SCRIPT.md, STORYBOARD.md and media from the writer's draft, the
// director's plan and the harvest's inventory (CONTRACT.md § B4). Deterministic, no model, Node only.
//
// The formats are the ones the pipeline's scripts read:
//   SCRIPT.md      audio.mjs: `## … (Frame N)` opens a voice line, `**key:**` rows are metadata, the
//                  4-space indented block is the only text spoken (one voice file per frame)
//   STORYBOARD.md  audio.mjs / captions.mjs / assemble-index.mjs (faceless-explainer lib/storyboard.mjs:
//                  front matter, `## Frame N — Name`, `- key: value`), and this kit's frames.mjs, pace.mjs
//                  (`- duration:` rewritten from the voice), mount.mjs (`- src:`, `- treatment:`) and
//                  music.mjs (`- music:`). `music: none` in the front matter keeps audio.mjs from
//                  fetching a bed: music.mjs places the music itself.
//   assets/media/  a copy of every inventory asset and its sidecars (<file>.boxes.json or <stem>.boxes.json:
//                  iteration 4's { faces, words, photos, lift } in 0–1 of the image → the inventory's
//                  `regions` (and pixel `boxes` from its words); or the older measured text
//                  boxes { image?, width, height, boxes: [{ text, x, y, w, h }] } in image pixels, B2's
//                  format, also named by the asset flag `boxes:<path>`; <stem>.map.json + <stem>.plain.png: a rendered map; <stem>.fg.png and
//                  <stem>.plate.<ext>: a parallax cut and its gap-fill plate)
//   assets/inventory.json  the inventory with files pointing at assets/media/ and the sidecars inlined
//   assets/frame-assets/<frame id>.json  the inventory records one frame's storyboard entry names
//                  (ctx.media in every frame)
//   assets/lines.json  each frame's lines in order: { [frame id]: [{ id, words, label, label_kind, pause_after }] };
//                  pace.mjs turns it into `lines` in every timing file (ctx.timing.lines), so each line's
//                  label lands on its own line (W-39); `label_kind` 'date' (MD-130) styles a date label
//                  more prominently (nk.label's `kind`)
//
// One storyboard frame holds one or more script lines; the last frame is the brand close, voiced with
// the draft's closing question (MD-18). A plan without a close gets one. Every line's `on_screen` label
// is carried into its frame's `- labels:` field (the frame's own `on_screen` is not repeated there), and
// a line's `pause_after` becomes the frame's `- pause_after:` (a silent picture beat after its voice).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLOSE } from './close-timing.js';
import { MUSIC_CUES, TREATMENTS } from './frames.mjs';

/** Narration pace for the first duration estimate (pace.mjs replaces it from the real voice). */
export const WORDS_PER_SECOND = 2.6;
/** The longest silent picture beat after a frame's voice (W-130), in seconds. */
export const PAUSE_MAX = 1;

const one = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const pad2 = (n) => String(n).padStart(2, '0');
const r2 = (n) => Math.round(n * 100) / 100;

/** A frame id slug: lowercase letters, digits and dashes, at most 28 characters. */
export function slug(name) {
  const s = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28).replace(/-+$/, '');
  return s || 'frame';
}

/** Every line of the draft by id, with its rung's purpose. */
export function draftLines(draft) {
  const out = new Map();
  for (const rung of draft?.rungs ?? []) for (const line of rung.lines ?? []) out.set(line.id, { ...line, rung: rung.id, rungPurpose: rung.purpose });
  return out;
}

/** The plan's frames in order, numbered from 1, with the close last (added when missing). */
export function planFrames(plan, draft) {
  const frames = [...(plan?.frames ?? [])].sort((a, b) => a.n - b.n).map((f) => ({ ...f }));
  if (!frames.length || frames[frames.length - 1].treatment !== 'close') {
    frames.push({ n: 0, name: 'Close', line_ids: [], treatment: 'close', asset_ids: [], purpose: 'The brand close; the comment question is spoken over it', blueprint: null, music: 'end', on_screen: null });
  }
  return frames.map((f, i) => ({ ...f, treatment: blueprintTreatment(f), n: i + 1, id: `${pad2(i + 1)}-${slug(f.name)}`, question: f.treatment === 'close' ? one(draft?.close_question) : null }));
}

/**
 * The storyboard `- treatment:` of a compiled frame: the kit's checks and the captions read it, and the module's must match.
 * A whiteboard ground is a whiteboard (captions turn to ink there); a frame that isn't on one can't say it is. Pure.
 */
export function blueprintTreatment(f) {
  const b = f?.blueprint;
  if (!b || f.treatment === 'close') return f?.treatment;
  if (b.ground === 'whiteboard') return 'whiteboard';
  const staged = b.style === 'paper' ? 'collage' : 'collision';
  return f.treatment === 'whiteboard' || !TREATMENTS.includes(f.treatment) ? staged : f.treatment;
}

const quoted = (w) => `“${one(w)}”`;

/**
 * A blueprint as storyboard lines Lucas and the checks can read: `[key, value]`, in the order a frame unfolds. Every time is
 * the spoken words it lands on (“” is the frame's start). Pure.
 */
export function blueprintFields(b) {
  if (!b) return [];
  const piece = (p) => [
    `${p.id}${p.role === 'lead' ? ' (lead)' : ''}: ${[p.asset, p.treatment, p.fill ? 'full frame' : '', p.note != null ? `note ${quoted(p.note)}${p.note_role ? ` as ${p.note_role}` : ''}` : ''].filter(Boolean).join(' ') || 'nothing'}`,
    p.side ? `on the ${p.side}` : '',
    p.belongs ? `with ${p.belongs}` : '',
    p.onto ? `onto ${p.onto.piece}'s ${p.onto.box}` : '',
    p.crop ? 'cropped' : '',
    p.label ? `named ${quoted(p.label)}` : '',
    `lands on ${quoted(p.on)}`,
    p.until ? `leaves on ${quoted(p.until)}` : '',
  ].filter(Boolean).join(', ');
  const join = (list, f) => (list ?? []).map(f).join('; ');
  return [
    ['ground', [b.ground, `style ${b.style}`, `arrangement ${b.arrangement}`, b.peak ? 'peak' : ''].filter(Boolean).join(' · ')],
    ['hook', b.hook ? `${quoted(b.hook.text)} on ${quoted(b.hook.on)}` : ''],
    ['pieces', join(b.pieces, piece)],
    ['named', join(b.labels, (l) => `${quoted(l.text)}${l.sub ? ` / ${quoted(l.sub)}` : ''}${l.kind ? ` (${l.kind})` : ''}${l.for ? ` for ${l.for}` : ''} on ${quoted(l.on)}`)],
    ['speech', join(b.speech, (x) => `${x.on_piece} says ${quoted(x.text)} on ${quoted(x.on)}${x.until ? ` until ${quoted(x.until)}` : ''}`)],
    ['marks', join(b.marks, (m) => `${m.kind} on ${m.on_piece}${m.target ? ` at ${m.target}` : ''}${m.from ? ` from ${m.from}` : ''} on ${quoted(m.on)}`)],
    ['arrows', join(b.arrows, (a) => `${a.from} to ${a.to} on ${quoted(a.on)}`)],
    ['camera', b.camera ? `${b.camera.move}${(b.camera.stops ?? []).length ? `: ${join(b.camera.stops, (c) => `${c.aim}${c.zoom ? ` at ${c.zoom}x` : ''} on ${quoted(c.on)}`)}` : ''}` : ''],
    ['ground_tone', join(b.ground_tone, (g) => `to ${g.to} on ${quoted(g.on)}`)],
    ['sounds', join(b.sounds, (x) => `${x.kind}: ${one(x.what)} on ${quoted(x.on)}${x.dur ? ` for ${x.dur}s` : ''}`)],
  ].filter(([, v]) => one(v));
}

/** The storyboard's text with the named frames' blueprints written in (the free replay); everything else stays. Pure. */
export function withBlueprints(storyboard, frames) {
  const text = String(storyboard);
  const heads = [...text.matchAll(/^##\s+Frame\s+(\d+).*$/gm)];
  const byN = new Map(frames.map((f) => [Number(f.n), f]));
  const GONE = new Set(['motion', 'sound', 'ground', 'hook', 'pieces', 'named', 'speech', 'marks', 'arrows', 'camera', 'ground_tone', 'sounds']);
  let out = text.slice(0, heads[0]?.index ?? text.length);
  heads.forEach((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const block = text.slice(m.index, end);
    const f = byN.get(Number(m[1]));
    if (!f?.blueprint) { out += block; return; }
    const lines = block.split('\n').filter((l) => !GONE.has(/^-\s+([\w-]+):/.exec(l)?.[1]));
    const at = lines.findIndex((l) => /^-\s+music:/.test(l));
    const fields = blueprintFields(f.blueprint).map(([k, v]) => `- ${k}: ${one(v)}`);
    lines.splice(at < 0 ? lines.length : at, 0, ...fields);
    out += lines.join('\n').replace(/^-\s+treatment:.*$/m, `- treatment: ${blueprintTreatment(f)}`);
  });
  return out;
}

/** Problems with a draft/plan/inventory triple (unknown ids, lines left out or used twice). */
export function projectProblems(draft, frames, inventory) {
  const out = [];
  const lines = draftLines(draft);
  const assets = new Set((inventory?.assets ?? []).map((a) => a.id));
  const used = new Map();
  frames.forEach((f, i) => {
    if (!TREATMENTS.includes(f.treatment)) out.push(`frame ${f.n}: treatment "${f.treatment}" is not one the kit builds`);
    if (f.treatment === 'close' && i !== frames.length - 1) out.push(`frame ${f.n}: the close must be the last frame`);
    if (f.music && !MUSIC_CUES.includes(f.music)) out.push(`frame ${f.n}: music "${f.music}" must be one of ${MUSIC_CUES.join(', ')}`);
    for (const id of f.line_ids ?? []) {
      if (!lines.has(id)) out.push(`frame ${f.n}: line ${id} is not in the draft`);
      if (used.has(id)) out.push(`line ${id} is in frames ${used.get(id)} and ${f.n}`);
      used.set(id, f.n);
    }
    for (const id of f.asset_ids ?? []) if (!assets.has(id)) out.push(`frame ${f.n}: asset ${id} is not in the inventory`);
  });
  for (const id of lines.keys()) if (!used.has(id)) out.push(`line ${id} is in no frame (it would never be spoken)`);
  if (!one(draft?.close_question)) out.push('the draft has no closing question for the close');
  return out;
}

const words = (text) => one(text).split(' ').filter(Boolean).length;
const sameText = (a, b) => one(a).toLowerCase() === one(b).toLowerCase();

/** A label that is only a date: "2015", "December 2015", "Dec. 11, 2015", "11 December 2015", "late 2015", "2014–2015". */
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const YEAR = "(?:19|20)\\d{2}|'\\d{2}";
const DATE_ONLY = new RegExp(`^(?:(?:early|mid|late|spring|summer|autumn|fall|winter)[- ]+)?(?:(?:\\d{1,2}(?:st|nd|rd|th)? +)?${MONTH}(?: +\\d{1,2}(?:st|nd|rd|th)?)?,? +)?(?:${YEAR})(?: *[–—-] *(?:${YEAR}))?$`, 'i');
export const isDateLabel = (label) => DATE_ONLY.test(one(label));

/**
 * The kind of a line's label (MD-130): 'date' when the writer marks it (`on_screen_kind: 'date'`; L1's label
 * is always a date), else null. A line written before the writer marked dates (no `on_screen_kind` at all)
 * counts as a date when its label is nothing but a date.
 */
export function labelKind(line, label) {
  if (!label) return null;
  if (line?.on_screen_kind === 'date') return 'date';
  if (line && 'on_screen_kind' in line) return null;
  return isDateLabel(label) ? 'date' : null;
}

/**
 * The frame's lines in order: { id, words, label, label_kind, pause_after } (label: the line's on_screen, or
 * null when the director dropped it, MD-126; label_kind: 'date' or null, MD-130).
 */
export function frameLines(frame, lines) {
  if (frame.treatment === 'close') return [];
  const dropped = new Set(frame.drop_labels ?? []);
  return (frame.line_ids ?? []).filter((id) => lines.has(id)).map((id) => {
    const l = lines.get(id);
    const p = Number(l.pause_after);
    const label = dropped.has(id) ? null : one(l.on_screen) || null;
    return { id, words: words(l.text), label, label_kind: labelKind(l, label), pause_after: Number.isFinite(p) && p > 0 ? r2(Math.min(p, PAUSE_MAX)) : 0 };
  });
}

/** The silent beat after a frame's voice: its lines' pauses, at most PAUSE_MAX. */
export function framePause(frame, lines) {
  return r2(Math.min(PAUSE_MAX, frameLines(frame, lines).reduce((n, l) => n + l.pause_after, 0)));
}

/** The `- labels:` field: every carried line's label, timed to its line (L2: … | L3: …), minus the frame's own words. */
export function frameLabels(frame, lines) {
  return frameLines(frame, lines)
    .filter((l) => l.label && !sameText(l.label, frame.on_screen))
    .map((l) => `${l.id}: ${l.label}`)
    .join(' | ');
}

/** What the voice says over a frame: its lines in order, or the closing question on the close. */
export function frameVoice(frame, lines) {
  if (frame.treatment === 'close') return frame.question ?? '';
  return (frame.line_ids ?? []).map((id) => one(lines.get(id)?.text)).filter(Boolean).join(' ');
}

/** A first duration: the words at WORDS_PER_SECOND plus a beat and any pause; the close is its fixed length. */
export function estimateDuration(frame, voice, pause = 0) {
  if (frame.treatment === 'close') return CLOSE.duration;
  const n = voice.split(/\s+/).filter(Boolean).length;
  return n ? r2(Math.max(1.2, n / WORDS_PER_SECOND + 0.2) + pause) : 1.5;
}

/** SCRIPT.md: one voice block per voiced frame. */
export function scriptMarkdown(draft, frames) {
  const lines = draftLines(draft);
  const out = [`# SCRIPT — ${one(draft?.title)}`, '', '**Voice:** HeyGen', `**Engine:** ${one(draft?.engine)}`, '', '---', ''];
  for (const f of frames) {
    const voice = frameVoice(f, lines);
    if (!voice) continue;
    const label = f.treatment === 'close' ? 'Closing question' : `${(f.line_ids ?? []).join(', ')} — ${one(f.name)}`;
    out.push(`## ${label} (Frame ${f.n})`, '');
    if (f.treatment !== 'close') {
      const facts = [...new Set((f.line_ids ?? []).flatMap((id) => lines.get(id)?.fact_ids ?? []))];
      out.push(`**Lines:** ${(f.line_ids ?? []).join(', ')}`);
      if (facts.length) out.push(`**Facts:** ${facts.join(', ')}`);
      out.push('');
    }
    out.push(`    ${voice}`, '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** A frame's `- shows:` (who appears and as what): "Name = V3 (tableau); …". */
export function frameShows(frame) {
  return (frame.shows ?? []).filter((s) => one(s?.person)).map((s) => `${one(s.person)} = ${one(s.asset_id)}${s.treatment ? ` (${one(s.treatment)})` : ''}`).join('; ');
}

/** A frame's `- shots:` (its picture beats in spoken order, MD-136): "“the words” = what shows [V3, W1] introduces Name; …". */
export function frameShots(frame) {
  return (frame.shots ?? []).filter((s) => one(s?.at)).map((s) => {
    const ids = (s.asset_ids ?? []).map(one).filter(Boolean);
    return `“${one(s.at)}” = ${one(s.shows)}${ids.length ? ` [${ids.join(', ')}]` : ''}${one(s.introduces) ? ` introduces ${one(s.introduces)}` : ''}`;
  }).join('; ');
}

/** A frame's `- makes:` (the made assets it uses and their briefs): "M2 = expression, seed worry, from V3: brief | …". */
export function frameMakes(frame, makes) {
  const byId = new Map((makes ?? []).map((m) => [m.id, m]));
  return (frame.asset_ids ?? []).map((id) => byId.get(id)).filter(Boolean)
    .map((m) => `${m.id} = ${m.kind}${m.seed ? `, seed ${m.seed}` : ''}${m.from_assets?.length ? `, from ${m.from_assets.join(' ')}` : ''}${m.people?.length ? `, of ${m.people.join(' and ')}` : ''}: ${one(m.brief)}`)
    .join(' | ');
}

/** STORYBOARD.md: front matter, then one block per frame in the kit's `- key: value` format. */
export function storyboardMarkdown(draft, frames, makes = []) {
  const lines = draftLines(draft);
  const total = frames.reduce((n, f) => n + estimateDuration(f, frameVoice(f, lines), framePause(f, lines)), 0);
  const head = [
    '---',
    'format: 1080x1920',
    `duration: ${Math.round(total)}s`,
    `message: "${one(draft?.title).replace(/"/g, '”')}"`,
    'arc: reel-ai-drama',
    'audience: viewers curious about how the AI world was built',
    'mode: autonomous',
    'music: none',
    `engine: ${one(draft?.engine)}`,
    '---',
    '',
    `Reel AI Drama: ${one(draft?.title)}. Written by the kit's project-files.mjs from the director's plan; pace.mjs rewrites each duration from the voice.`,
    '',
  ];
  const blocks = frames.map((f) => {
    const voice = frameVoice(f, lines);
    const pause = framePause(f, lines);
    const field = (k, v) => (one(v) ? [`- ${k}: ${one(v)}`] : []);
    return [
      `## Frame ${f.n} — ${one(f.name) || 'Frame'}`,
      '',
      `- duration: ${estimateDuration(f, voice, pause)}s`,
      '- transition_in: cut',
      '- status: animated',
      `- src: compositions/frames/${f.id}.html`,
      `- treatment: ${f.treatment}`,
      ...field('assets', (f.asset_ids ?? []).join(', ')),
      ...field('shows', frameShows(f)),
      ...field('makes', frameMakes(f, makes)),
      ...field('lines', (f.line_ids ?? []).join(', ')),
      ...field('shots', frameShots(f)),
      ...field('purpose', f.purpose),
      ...(f.blueprint
        ? blueprintFields(f.blueprint).flatMap(([k, v]) => field(k, v))
        : [...field('motion', f.motion), ...field('marks', f.marks), ...field('sound', f.sound)]),
      `- music: ${MUSIC_CUES.includes(f.music) ? f.music : 'hold'}`,
      ...field('on_screen', f.on_screen),
      ...field('labels', frameLabels(f, lines)),
      ...(pause > 0 ? [`- pause_after: ${pause}s`] : []),
      ...(voice ? [`- voiceover: "${voice}"`] : []),
      '',
    ].join('\n');
  });
  return `${head.join('\n')}\n${blocks.join('\n')}`;
}

/** Where an asset's file is: absolute, or relative to the first media root that has it. */
function locate(file, roots) {
  if (isAbsolute(file)) return existsSync(file) ? file : null;
  for (const r of roots) if (r && existsSync(join(r, file))) return join(r, file);
  return null;
}

/** The sidecars of `src` (siblings named <stem>.<something>), e.g. V3.boxes.json, V7.plain.png. */
function sidecars(src) {
  const dir = dirname(src);
  const stem = basename(src, extname(src));
  return readdirSync(dir).filter((n) => n !== basename(src) && n.startsWith(`${stem}.`));
}

/** Measured boxes scaled to the image's own pixel size (a sidecar measured at another size is rescaled). */
export function normalizeBoxes(sidecar, width) {
  const boxes = Array.isArray(sidecar) ? sidecar : sidecar?.boxes ?? [];
  const k = sidecar?.width > 0 && width > 0 ? width / sidecar.width : 1;
  return boxes
    .filter((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0)
    .map((b) => ({ text: String(b.text ?? ''), x: r2(b.x * k), y: r2(b.y * k), w: r2(b.w * k), h: r2(b.h * k) }));
}

const okRegion = (b) => b && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
/**
 * The iteration-4 box sidecar (`<file>.boxes.json`, written by the harvest): { faces, words: [{ text, box }],
 * photos, lift, lift_from (the page region the lift was cut from) }, boxes 0–1 of the image. Null for the older pixel `boxes` format. Bad boxes are dropped.
 */
export function sidecarRegions(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !['faces', 'words', 'photos', 'lift'].some((k) => k in json)) return null;
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    faces: list(json.faces).filter(okRegion),
    words: list(json.words).filter((w) => okRegion(w?.box)).map((w) => ({ text: String(w.text ?? ''), box: w.box })),
    photos: list(json.photos).filter(okRegion),
    lift: typeof json.lift === 'string' && json.lift ? json.lift : null,
    lift_from: okRegion(json.lift_from) ? json.lift_from : null,
  };
}

/** What a frame worker reads of a record: the measured grids are for code, and only cost tokens to read. */
const forReading = (a) => (a.regions?.shape || a.regions?.tone ? { ...a, regions: { ...a.regions, shape: undefined, tone: undefined } } : a);

/** The sections of `## Treatments` every frame may need, whatever its treatment. */
/** The inventory records a frame's storyboard entry names, so its worker needn't load the whole inventory. */
export function frameAssets(frame, assets) {
  const named = new Set(JSON.stringify(frame).match(/[A-Za-z0-9_]+/g) ?? []);
  return assets.filter((a) => named.has(a.id));
}

/**
 * Write SCRIPT.md, STORYBOARD.md, assets/media/ and assets/inventory.json into `projectDir`.
 * `mediaRoot`: where the inventory's relative files live (default: the job folder, tried as the project's
 * parent and grandparent). Returns { frames, media, missing, problems }; never throws on bad ids (they
 * are problems), only on IO.
 */
export function writeProjectFiles(projectDir, { draft, plan, inventory, mediaRoot = null }) {
  const frames = planFrames(plan, draft);
  const problems = projectProblems(draft, frames, inventory);
  writeFileSync(join(projectDir, 'SCRIPT.md'), scriptMarkdown(draft, frames));
  writeFileSync(join(projectDir, 'STORYBOARD.md'), storyboardMarkdown(draft, frames, plan?.makes ?? []));
  mkdirSync(join(projectDir, 'assets'), { recursive: true });
  // The plan as it was compiled from, so a reel can be replayed for free without the database.
  writeFileSync(join(projectDir, 'assets', 'plan.json'), `${JSON.stringify(plan, null, 1)}\n`);
  const byLine = draftLines(draft);
  writeFileSync(join(projectDir, 'assets', 'lines.json'), `${JSON.stringify(Object.fromEntries(frames.map((f) => [f.id, frameLines(f, byLine)])), null, 1)}\n`);

  const mediaDir = join(projectDir, 'assets', 'media');
  mkdirSync(mediaDir, { recursive: true });
  const roots = [mediaRoot, dirname(projectDir), dirname(dirname(projectDir))];
  const assets = [];
  const missing = [];
  for (const a of inventory?.assets ?? []) {
    const src = a.file ? locate(a.file, roots) : null;
    if (!src) {
      missing.push(a.id);
      continue;
    }
    const rel = (name) => `assets/media/${name}`;
    copyFileSync(src, join(mediaDir, basename(src)));
    const entry = { ...a, file: rel(basename(src)) };
    // B2 also names the boxes sidecar in a flag (`boxes:media/V7.boxes.json`); a sibling with the same stem is found below.
    const flagged = (a.flags ?? []).map((f) => /^boxes:(.+)$/.exec(String(f))?.[1]).find(Boolean);
    const flaggedSrc = flagged ? locate(flagged, roots) : null;
    if (flaggedSrc && dirname(flaggedSrc) !== dirname(src) || flaggedSrc && !basename(flaggedSrc).startsWith(`${basename(src, extname(src))}.`)) {
      try {
        const box = JSON.parse(readFileSync(flaggedSrc, 'utf8'));
        const regions = sidecarRegions(box);
        if (regions) entry.regions = { ...entry.regions, ...regions, lift: regions.lift ? rel(basename(regions.lift)) : null };
        else entry.boxes = normalizeBoxes(box, a.width);
        copyFileSync(flaggedSrc, join(mediaDir, basename(flaggedSrc)));
      } catch {
        problems.push(`${a.id}: the boxes sidecar ${flagged} is not valid JSON`);
      }
    }
    for (const side of sidecars(src)) {
      copyFileSync(join(dirname(src), side), join(mediaDir, side));
      const kind = side.slice(basename(src, extname(src)).length + 1);
      try {
        if (kind === 'boxes.json' || kind === `${extname(src).slice(1)}.boxes.json`) {
          const box = JSON.parse(readFileSync(join(dirname(src), side), 'utf8'));
          const regions = sidecarRegions(box);
          if (regions) {
            // What was measured from the pixels (visible, shape, tone, chip) stays beside what the harvest found.
            entry.regions = { ...entry.regions, ...regions, lift: regions.lift ? rel(basename(regions.lift)) : null };
            if (!entry.boxes?.length && regions.words.length) entry.boxes = regions.words.map((w) => ({ text: w.text, x: r2(w.box.x * a.width), y: r2(w.box.y * a.height), w: r2(w.box.w * a.width), h: r2(w.box.h * a.height) }));
          } else entry.boxes = normalizeBoxes(box, a.width);
        }
        else if (kind === 'map.json') {
          const m = JSON.parse(readFileSync(join(dirname(src), side), 'utf8'));
          entry.map = { ...m, ...(m.plain ? { plain: rel(m.plain) } : {}) };
        } else if (kind === 'fg.png') entry.cutout = { ...(entry.cutout ?? {}), fg: rel(side) };
        else if (kind.startsWith('plate.')) entry.cutout = { ...(entry.cutout ?? {}), plate: rel(side) };
      } catch {
        problems.push(`${a.id}: the sidecar ${side} is not valid JSON`);
      }
    }
    assets.push(entry);
  }
  for (const id of missing) problems.push(`asset ${id}: its file is missing`);
  writeFileSync(join(projectDir, 'assets', 'inventory.json'), `${JSON.stringify({ ...inventory, assets }, null, 1)}\n`);
  mkdirSync(join(projectDir, 'assets', 'frame-assets'), { recursive: true });
  for (const f of frames) writeFileSync(join(projectDir, 'assets', 'frame-assets', `${f.id}.json`), `${JSON.stringify({ assets: frameAssets(f, assets).map(forReading) }, null, 1)}\n`);
  return { frames: frames.map((f) => ({ n: f.n, id: f.id, treatment: f.treatment })), media: assets.map((a) => a.id), missing, problems };
}
