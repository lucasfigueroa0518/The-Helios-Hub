// A compiled frame: the director's blueprint (plus any accepted touches) resolved against the frame's voice and pictures,
// then handed to `nk.stage`, the only way onto the screen. render/compile.ts writes one module per frame that holds no
// logic, only `compiledFrame({ ... })`. Every time in a blueprint is the exact spoken words; a word that can't be found falls
// back to the line's start and is reported, never thrown. Nothing here is placed: position and size are the solver's.

const wordKey = (w) => String(w ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const plain = (v) => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const known = (id) => ['charcoal', 'kraft', 'whiteboard'].includes(id);

/** Whether the voice says every word of `phrase` in a row (`cueAt` also lands on its longest opening). Pure. */
function saysWhole(words, phrase) {
  const want = String(phrase ?? '').split(/\s+/).map(wordKey).filter(Boolean);
  const said = (words ?? []).map((w) => wordKey(w.text));
  for (let i = 0; i + want.length <= said.length; i++) if (want.every((x, k) => said[i + k] === x)) return true;
  return want.length === 0;
}

/**
 * Seconds for a `Words`: '' is the frame's start; a phrase is when the voice starts saying it; anything else falls back to
 * the line's start and goes on `report`. `cues` keeps every phrase's answer, for the plan check. Pure but for those two.
 */
/** Whether a piece's treatment lacks what it draws: its number, its bars or its name. Pure. */
export function treatmentSaysNothing(p) {
  const o = p?.opts ?? {};
  const blank = (v) => v === undefined || v === null || String(v).trim() === '';
  if (p?.treatment === 'stat') return o.kind === 'bar' || o.kind === 'scale' ? !(o.items?.length > 0) : blank(o.value);
  if (p?.treatment === 'number') return blank(o.value);
  if (p?.treatment === 'lower_third') return blank(o.name);
  return false;
}

/** @param {{ words?: any[], lines?: any[], cueAt: any, report?: (r: string) => void, cues?: Record<string, number> }} input */
export function wordsAt({ words = [], lines = [], cueAt, report = () => {}, cues = {} }) {
  const lineStart = lines.find((l) => Number.isFinite(l?.start))?.start ?? 0;
  return (phrase, what = 'something') => {
    const want = String(phrase ?? '').trim();
    if (!want) return 0;
    const at = cueAt(words, want);
    if (at == null) {
      report(`word_missing: ${what}: "${want}" is not in this frame's voice; it lands on the line's start`);
      cues[want] = lineStart;
      return lineStart;
    }
    if (!saysWhole(words, want)) report(`word_partial: ${what}: the voice says only the start of "${want}"`);
    cues[want] = at;
    return at;
  };
}

/** A blueprint with the frame's accepted touches added. A touch only adds; nothing planned changes. Pure. */
export function withTouches(blueprint, touches = []) {
  const b = { ...blueprint, labels: [...(blueprint.labels ?? [])], marks: [...(blueprint.marks ?? [])], ground_tone: [...(blueprint.ground_tone ?? [])], camera: { ...(blueprint.camera ?? { move: 'hold', stops: [] }) } };
  const inTurn = [];
  let closer = false;
  for (const t of touches) {
    if (t.type === 'extra_line') b.labels.push({ text: t.text, ...(t.for ? { for: t.for } : {}), on: t.on });
    else if (t.type === 'mark') b.marks.push({ kind: t.kind, on_piece: t.on_piece, ...(t.target ? { target: t.target } : {}), on: t.on });
    else if (t.type === 'ground_tone') b.ground_tone.push({ on: t.on, to: t.to });
    else if (t.type === 'in_turn') inTurn.push({ ids: t.piece_ids, from: t.from, to: t.to });
    else if (t.type === 'closer_cuts') {
      closer = true;
      b.camera = { move: 'tour', stops: [...(b.camera.stops ?? []), ...(t.on ?? []).map((on) => ({ on, aim: t.aim }))] };
    }
  }
  return { blueprint: b, inTurn, closer };
}

/** The least a planned thing stays on screen before the frame cuts, seconds: under this it can't be read. */
const MIN_HOLD = 1;
/** A stop this near the start is at the start, seconds. */
const START_SLACK = 0.05;

/** The stage holds its first pose until the first stop: a camera that reaches its aim on a later word starts on the whole frame. Pure. */
function cameraStops(stops) {
  return stops.length && Math.min(...stops.map((s) => s.at)) > START_SLACK ? [{ at: 0, aim: 'whole' }, ...stops] : stops;
}

const dateToken = (w) => String(w ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(\d+)(st|nd|rd|th)$/, '$1');
/** A date label's life: what is said in it is on the captions. */
const DATE_LIFE = 3.2;
/** Whether most of a date's words are spoken while it would be up: the caption is already saying it. Pure. */
export function repeatsSpoken(text, words = [], from = 0) {
  const want = String(text ?? '').split(/\s+/).map(dateToken).filter(Boolean);
  if (want.length < 2) return false;
  const start = Number.isFinite(from) ? from : 0;
  const spoken = new Set(words.filter((w) => (w.start ?? w.t ?? 0) >= start - 0.3 && (w.start ?? w.t ?? 0) < start + DATE_LIFE).map((w) => dateToken(w.word ?? w.text)));
  return want.filter((w) => spoken.has(w)).length / want.length >= 2 / 3;
}

/** The labels a frame's lines bring (nk.lineLabel's words, kind and time), for the solver to place. Pure. */
function lineLabels(lines, blueprint, at, words = [], report = () => {}) {
  const said = new Set([...(blueprint.labels ?? []).map((l) => l.text), ...(blueprint.pieces ?? []).map((p) => p.label), blueprint.hook?.text].filter(Boolean).map(plain));
  const repeats = (l) => {
    if (l.label_kind !== 'date' || !repeatsSpoken(l.label, words, l.start)) return false;
    report(`date_repeats_caption: "${l.label}" is spoken as it would show; the caption says it`);
    return true;
  };
  return (lines ?? []).filter((l) => l?.label && !said.has(plain(l.label)) && !repeats(l)).map((l) => ({ text: l.label, kind: l.label_kind ?? undefined, at: Number.isFinite(l.start) ? l.start : at('') }));
}

/**
 * The stage's options from a compiled frame's spec, plain data only: { treatment, blueprint, touches?, custom?, known_names?,
 * seed? } with the frame's voice and pictures. Returns { options, reports, cues, inTurn }. Pure.
 */
export function compiledOptions(spec, { media = {}, words = [], lines = [], duration = 6, cueAt, customModules = {}, ctx = null }) {
  const reports = [];
  const cues = {};
  const word = wordsAt({ words, lines, cueAt, report: (r) => reports.push(r), cues });
  // A thing that lands too near the cut to be read comes in early enough to hold (the plan check reads the same cue).
  const lastLanding = Math.max(0, duration - MIN_HOLD);
  const at = (on, what) => {
    const t = word(on, what);
    if (t <= lastLanding) return t;
    reports.push(`beat_held: ${what} on "${on}" would hold ${(duration - t).toFixed(1)}s before the cut, so it lands ${MIN_HOLD}s before it`);
    if (String(on ?? '').trim()) cues[String(on).trim()] = lastLanding;
    return lastLanding;
  };
  const { blueprint: b, inTurn, closer } = withTouches(spec.blueprint ?? {}, spec.touches ?? []);
  const record = (id, what) => {
    const m = media[id];
    if (!m) reports.push(`asset_missing: ${what}: no picture "${id}" in the inventory`);
    return m ?? null;
  };
  let ground = b.ground ?? (b.style === 'paper' ? 'kraft' : 'charcoal');
  if (!known(ground)) ground = record(ground, 'the ground') ?? 'charcoal';
  const pieces = (b.pieces ?? []).flatMap((p) => {
    const { asset, on, until, opts, ...rest } = p;
    const m = asset ? record(asset, `piece ${p.id}`) : null;
    if (asset && !m) return [];
    // A treatment that has nothing to draw would leave an empty space: the piece shows its picture, or isn't there.
    if (treatmentSaysNothing(p)) {
      reports.push(`treatment_empty: piece ${p.id}'s ${p.treatment} has nothing to show${m ? ', so it shows its picture' : ''}`);
      if (!m) return [];
      delete rest.treatment;
      return [{ ...rest, media: m, at: at(on, `piece ${p.id}`), ...(until && at(until, `piece ${p.id} leaving`) > at(on, `piece ${p.id}`) ? { until: at(until, `piece ${p.id} leaving`) } : {}) }];
    }
    const arrives = at(on, `piece ${p.id}`);
    const leaves = until ? at(until, `piece ${p.id} leaving`) : null;
    if (leaves !== null && leaves <= arrives) reports.push(`until_before_on: piece ${p.id} would leave on "${until}" before it arrives, so it stays`);
    return [{ ...rest, ...(opts ? { opts } : {}), ...(m ? { media: m } : {}), at: arrives, ...(leaves !== null && leaves > arrives ? { until: leaves } : {}) }];
  });
  for (const c of spec.custom ?? []) {
    pieces.push({ id: c.id, custom: { file: `${c.id}.js`, aspect: c.aspect, min_width: c.min_width, module: customModules[`${c.id}.js`] ?? null }, at: at(c.on, `custom piece ${c.id}`), ...(c.until ? { until: at(c.until, `custom piece ${c.id} leaving`) } : {}) });
  }
  const options = {
    ground,
    style: b.style ?? 'cutouts',
    arrangement: b.arrangement,
    pieces,
    labels: [
      ...(b.labels ?? []).map(({ on, ...l }) => ({ ...l, at: at(on, `label "${l.text}"`) })),
      ...lineLabels(lines, b, at, words, (r) => reports.push(r)),
    ],
    marks: (b.marks ?? []).map(({ on_piece, on, ...m }) => ({ ...m, on: on_piece, at: at(on, `${m.kind} mark on ${on_piece}`) })),
    arrows: (b.arrows ?? []).map(({ on, ...a }) => ({ ...a, at: at(on, `arrow ${a.from} to ${a.to}`) })),
    speech: (b.speech ?? []).map(({ on_piece, on, until, ...s }) => ({ ...s, on: on_piece, at: at(on, `speech on ${on_piece}`), ...(until ? { until: at(until, `speech on ${on_piece} ending`) } : {}) })),
    ...(b.hook ? { hook: { text: b.hook.text, at: at(b.hook.on, 'the hook') } } : {}),
    ...(b.peak ? { peak: true } : {}),
    camera: { move: b.camera?.move ?? 'hold', stops: cameraStops((b.camera?.stops ?? []).map((s) => ({ aim: s.aim, ...(s.zoom != null ? { zoom: s.zoom } : {}), at: word(s.on, `camera stop on ${s.aim}`) }))) },
    ...(b.ground_tone?.length ? { ground_tone: b.ground_tone.map((g) => ({ to: g.to, at: at(g.on, 'the ground tone') })) } : {}),
    ...(inTurn.length ? { in_turn: inTurn.map((r) => ({ ids: r.ids, from: at(r.from, 'words in turn'), to: at(r.to, 'words in turn') })) } : {}),
    known_names: spec.known_names ?? [],
    mediaIndex: media,
    duration,
    treatment: spec.treatment,
    ...(spec.seed != null ? { seed: spec.seed } : {}),
    customModules,
    ctx,
  };
  return { options, reports, cues, inTurn, closer };
}

/** A frame that couldn't be built as planned: its first picture on its ground, held, nothing else. The reel still ships. Pure. */
export function plainOptions(options) {
  const first = (options.pieces ?? []).find((p) => p.media && !p.custom);
  const ground = typeof options.ground === 'string' ? options.ground : 'charcoal';
  return { ground, style: options.style ?? 'cutouts', arrangement: 'solo', pieces: first ? [{ id: first.id, media: first.media, at: 0 }] : [], camera: { move: 'hold', stops: [] }, known_names: options.known_names ?? [], mediaIndex: options.mediaIndex, duration: options.duration, treatment: options.treatment };
}

/**
 * The module's one call: `export default compiledFrame({ treatment, blueprint, touches, custom, known_names, seed, plain? },
 * customModules)`. Records what it did on `document.__compiled[id]`: the stage's manifest, the words it couldn't find and
 * whether it fell back to a plain frame, for the plan check (kit/compiled-read.mjs).
 */
export function compiledFrame(spec, customModules = {}) {
  let made = null;
  return {
    treatment: spec.treatment,
    build(root, ctx) {
      const doc = root.ownerDocument;
      const { nk } = ctx;
      doc.__stageNotes = [];
      doc.__stageReports = [];
      const built = compiledOptions(spec, { media: ctx.media ?? {}, words: ctx.timing?.words ?? [], lines: ctx.timing?.lines ?? [], duration: ctx.duration, cueAt: nk.cueAt, customModules, ctx });
      const reports = [...built.reports];
      let plainFrame = Boolean(spec.plain);
      const attempt = (o) => nk.stage(doc, o);
      try {
        made = attempt(plainFrame ? plainOptions(built.options) : built.options);
      } catch (err) {
        reports.push(`stage_failed: ${err?.message ?? err}; this frame shows its first picture, plain`);
        plainFrame = true;
        try {
          made = attempt(plainOptions(built.options));
        } catch (err2) {
          reports.push(`plain_failed: ${err2?.message ?? err2}`);
          made = attempt({ ground: 'charcoal', pieces: [], duration: ctx.duration, treatment: spec.treatment });
        }
      }
      root.append(made.el);
      const asked = [...built.options.labels.map((l) => l.text), ...built.options.pieces.flatMap((p) => (p.label ? [p.label] : []))];
      const kept = nk.stageSpec({ ...built.options, ground: 'charcoal' }).labels.map((l) => l.text);
      (doc.__compiled ??= {})[ctx.id] = {
        manifest: made.manifest(),
        reports,
        plain: plainFrame,
        cues: built.cues,
        names_held_back: asked.filter((t) => !kept.includes(t)),
        in_turn: built.inTurn.flatMap((r) => r.ids),
        closer_cuts: built.closer,
        known_names: built.options.known_names,
        custom: (spec.custom ?? []).map((c) => c.id),
      };
    },
    render(t) {
      made.render(t);
    },
  };
}
