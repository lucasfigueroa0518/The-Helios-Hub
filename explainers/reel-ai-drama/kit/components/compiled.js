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

/** The least anything planned stays on screen, seconds: under this it can't be read. */
const MIN_HOLD = 1.2;
/** A stop this near the start is at the start, seconds. */
const START_SLACK = 0.05;

/** The stage holds its first pose until the first stop: a camera that reaches its aim on a later word starts on the whole frame. Pure. */
function cameraStops(stops) {
  return stops.length && Math.min(...stops.map((s) => s.at)) > START_SLACK ? [{ at: 0, aim: 'whole' }, ...stops] : stops;
}

/** What a label names, and the rest of it: "Ada Lovelace, analyst" is the name and the role. Pure. */
export function labelParts(text) {
  const t = String(text ?? '').trim();
  const at = t.search(/\s*[,:(–—]\s*/);
  if (at <= 0) return { head: t, role: null };
  return { head: t.slice(0, at).trim(), role: t.slice(at).replace(/^\s*[,:(–—]\s*/, '').replace(/\)\s*$/, '').trim() || null };
}

const tokens = (v) => plain(v).split(' ').filter(Boolean);
/** When the voice says a name: the whole of it, else its last word (the voice says "Lovelace" later on), possessive or not; null when it doesn't. Pure. */
export function nameSaidAt(words, name) {
  const want = tokens(name).map(wordKey);
  if (!want.length) return null;
  const said = (words ?? []).map((w) => wordKey(w.text ?? w.word));
  const start = (i) => (words[i].start ?? words[i].t ?? 0);
  for (let i = 0; i + want.length <= said.length; i++) if (want.every((x, k) => said[i + k] === x)) return start(i);
  const last = want[want.length - 1];
  if (last.length < 3) return null;
  const i = said.findIndex((w) => w === last || w === `${last}s`);
  return i >= 0 ? start(i) : null;
}

/** Whether a picture is of the named person: the harvest's people, or a named word for word in what it shows. Pure. */
export function pictureNames(media, name) {
  const want = plain(name);
  if (!media || !want) return null;
  const hit = (media.people ?? []).find((p) => { const x = plain(p); return x === want || x.endsWith(` ${want}`) || want.endsWith(` ${x}`); });
  if (hit) return hit;
  return PHOTO_KINDS.has(media.kind) && want.includes(' ') && plain(media.shows).includes(want) ? name : null;
}

/** An identity the look couldn't confirm stays unsaid on the picture: a caption only claims it. Pure. */
export const identityConfirmed = (media) => !/not confirmed/i.test(String(media?.shows ?? ''));

/** The photographs a label can date or place. A screenshot or a document carries its capture date, and made pictures have none. */
const PHOTO_KINDS = new Set(['person_photo', 'event_photo', 'place_photo']);
/** Where a date can come from for it to be the picture's: not a capture, not the article it ran in. */
const PHOTO_DATE_BASIS = new Set(['commons', 'exif', 'caption']);
/** A photo this many years old, or older, is dated on screen. */
export const OLD_PHOTO_YEARS = 2;
/** How an old photo's date reads on screen (Lucas, 2026-11-08): marked as a file photo with its year, so it never reads as the date of the events the voice tells. */
const FILE_PHOTO = 'File photo';

/** A photo's year, when the data backs one (an exact or approximate date). Pure. */
export function photoDate(media) {
  if (!media || !PHOTO_KINDS.has(media.kind) || media.made) return null;
  const basis = (media.flags ?? []).find((f) => String(f).startsWith('date_basis:'))?.slice('date_basis:'.length) ?? null;
  if (!PHOTO_DATE_BASIS.has(basis)) return null;
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(String(media.date_taken ?? ''));
  if (!m) return null;
  return media.date_confidence === 'exact' || media.date_confidence === 'approximate' ? m[1] : null;
}

/**
 * The words on a full-screen photo, from its own data or not at all: a place photo's place; one at least OLD_PHOTO_YEARS old its
 * date and place, and who is in it when nothing else says and the identity is confirmed. Only on the reel's first showing of it
 * (`media.first_frame`, when it's known). Null when none of it holds. Pure.
 */
export function photoLabel(media, { fullScreen = false, frame = null, clearWho = false } = {}) {
  if (!media || !PHOTO_KINDS.has(media.kind) || media.made || (media.flags ?? []).includes('cutout')) return null;
  if (Number.isFinite(media.first_frame) && Number.isFinite(frame) && media.first_frame !== frame) return null;
  const year = fullScreen && media.age_years >= OLD_PHOTO_YEARS ? photoDate(media) : null;
  const date = year ? `${FILE_PHOTO} · ${year}` : null;
  const place = String(media.place ?? '').trim() || null;
  const placed = fullScreen && (media.kind === 'place_photo' || date) ? place : null;
  const who = date && !clearWho && identityConfirmed(media) && (media.people ?? []).length === 1 ? media.people[0] : null;
  const parts = [who, placed, date].filter(Boolean);
  if (!parts.length || (!date && !placed)) return null;
  return { text: parts[0], ...(parts.length > 1 ? { sub: parts.slice(1).join(' · ') } : {}) };
}

/** How long a name has to be up, with its owner, to be read. */
const NAME_ROOM = 0.8;

/**
 * A frame's labels, every one tied to something real (ALIGN §5, §7). A person's name and role show when the voice says the name,
 * with the person on screen, and only the first time; a photo's place, date or who come from its data and live with it. Anything
 * else anyone asked for (a date the voice says, a fact on top, a word on a piece) goes, and goes on `report`. A number is a piece of
 * the frame's picture, not a label, so it stays. `at` resolves a blueprint word. Pure.
 */
export function frameLabels({ blueprint: b = {}, pieces = [], ground = null, lines = [], words = [], at = () => 0, known = [], frame = null, report = () => {} }) {
  const knownNames = new Set((known ?? []).map(plain));
  const cut = (text, why) => report(`label_cut: "${text}" ${why}`);
  const kept = (b.labels ?? []).filter((l) => l.kind === 'number').map(({ on, ...l }) => ({ ...l, at: at(on, `label "${l.text}"`) }));
  const asks = [
    ...(lines ?? []).filter((l) => l?.label).map((l) => ({ text: l.label, kind: l.label_kind ?? null })),
    ...(b.labels ?? []).filter((l) => l.kind !== 'number').map((l) => ({ text: l.text, sub: l.sub ?? null, kind: l.kind ?? null, for: l.for ?? null })),
    ...pieces.filter((p) => p.label != null).map((p) => ({ text: typeof p.label === 'string' ? p.label : p.label.text, sub: typeof p.label === 'string' ? null : p.label.sub ?? null, for: p.id })),
  ];
  // A person is named once a frame, with the fullest words anyone gave.
  const people = new Map();
  for (const ask of asks) {
    const { head, role } = labelParts(ask.text);
    const sub = ask.sub ?? role;
    const on = pieces.filter((p) => (!ask.for || p.id === ask.for) && pictureNames(p.media, head));
    if (ask.kind === 'date' || !on.length) { cut(ask.text, ask.kind === 'date' ? 'is a date: the voice and the captions carry it, or it is not said' : 'names nobody on screen'); continue; }
    const key = plain(pictureNames(on[0].media, head));
    const had = people.get(key);
    people.set(key, { head: had?.head ?? head, sub: had?.sub ?? sub, on: had?.on ?? on, text: ask.text });
  }
  // Whoever the voice names on screen for the first time gets the name, asked for or not.
  for (const p of pieces) {
    for (const name of p.media?.people ?? []) {
      const key = plain(name);
      if (people.has(key) || p.media?.named_in?.[name] !== frame || !Number.isFinite(frame)) continue;
      people.set(key, { head: name, sub: null, on: [p], text: name });
    }
  }
  const named = [];
  for (const [key, who] of people) {
    const first = who.on[0].media?.named_in?.[pictureNames(who.on[0].media, who.head)];
    if (knownNames.has(key) || knownNames.has(plain(who.head)) || (first != null && first !== frame)) { cut(who.text, 'was named earlier in the reel'); continue; }
    const said = nameSaidAt(words, who.head);
    if (said == null) { cut(who.text, 'is a name the voice does not say here'); continue; }
    const owner = who.on.find((p) => (p.until ?? Infinity) - Math.max(p.at ?? 0, said) >= NAME_ROOM);
    if (!owner) { cut(who.text, 'would show without the person on screen'); continue; }
    named.push({ text: who.head, ...(who.sub ? { sub: who.sub } : {}), for: owner.id, at: said });
  }
  // A photo's own label: full-screen is a picture ground, a fill, or the only thing up while it is.
  const clearWho = (p) => named.some((l) => l.for === p.id) || (p.media?.people ?? []).some((n) => nameSaidAt(words, n) != null);
  const alone = (p) => !pieces.some((q) => q !== p && (q.at ?? 0) < (p.until ?? Infinity) && (p.at ?? 0) < (q.until ?? Infinity));
  const photos = [
    ...(ground ? [{ id: 'ground', media: ground, at: 0, full: true }] : []),
    ...pieces.filter((p) => p.media && !p.treatment && p.media !== ground).map((p) => ({ ...p, full: Boolean(p.fill) || p.role === 'lead' && p.media.kind === 'place_photo' || (!ground && alone(p)) })),
  ];
  for (const p of photos) {
    const said = photoLabel(p.media, { fullScreen: p.full, frame, clearWho: clearWho(p) });
    if (said) kept.push({ ...said, kind: 'photo', for: p.id, at: p.at ?? 0 });
  }
  return [...kept, ...named];
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
  // Anything shown stays long enough to be read: a leaving word this soon after it landed waits.
  const held = (id, arrives, leaves) => {
    if (leaves - arrives >= MIN_HOLD) return { until: leaves };
    const until = arrives + MIN_HOLD;
    reports.push(`piece_held: ${id} would show ${(leaves - arrives).toFixed(1)}s, so it stays ${MIN_HOLD}s`);
    return until < duration ? { until } : {};
  };
  const pieces = (b.pieces ?? []).flatMap((p) => {
    const { asset, on, until, opts, ...rest } = p;
    const m = asset ? record(asset, `piece ${p.id}`) : null;
    if (asset && !m) return [];
    // A treatment that has nothing to draw would leave an empty space: the piece shows its picture, or isn't there.
    if (treatmentSaysNothing(p)) {
      reports.push(`treatment_empty: piece ${p.id}'s ${p.treatment} has nothing to show${m ? ', so it shows its picture' : ''}`);
      if (!m) return [];
      delete rest.treatment;
      return [{ ...rest, media: m, at: at(on, `piece ${p.id}`), ...(until && at(until, `piece ${p.id} leaving`) > at(on, `piece ${p.id}`) ? held(p.id, at(on, `piece ${p.id}`), at(until, `piece ${p.id} leaving`)) : {}) }];
    }
    const arrives = at(on, `piece ${p.id}`);
    const leaves = until ? at(until, `piece ${p.id} leaving`) : null;
    if (leaves !== null && leaves <= arrives) reports.push(`until_before_on: piece ${p.id} would leave on "${until}" before it arrives, so it stays`);
    return [{ ...rest, ...(opts ? { opts } : {}), ...(m ? { media: m } : {}), at: arrives, ...(leaves !== null && leaves > arrives ? held(p.id, arrives, leaves) : {}) }];
  });
  for (const c of spec.custom ?? []) {
    pieces.push({ id: c.id, custom: { file: `${c.id}.js`, aspect: c.aspect, min_width: c.min_width, module: customModules[`${c.id}.js`] ?? null }, at: at(c.on, `custom piece ${c.id}`), ...(c.until ? { until: at(c.until, `custom piece ${c.id} leaving`) } : {}) });
  }
  const frame = Number.parseInt(String(ctx?.id ?? ''), 10);
  // Not reports: a label the rule drops is the system working, not something to flag on delivery.
  const labelCuts = [];
  const labels = frameLabels({ blueprint: b, pieces, ground: typeof ground === 'object' ? ground : null, lines, words, at, known: spec.known_names, frame: Number.isFinite(frame) ? frame : null, report: (r) => labelCuts.push(r) });
  const options = {
    ground,
    style: b.style ?? 'cutouts',
    arrangement: b.arrangement,
    pieces: pieces.map(({ label: _named, ...p }) => p),
    labels,
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
  return { options, reports, labelCuts, cues, inTurn, closer };
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
      const asked = built.options.labels.map((l) => l.text);
      const kept = nk.stageSpec({ ...built.options, ground: 'charcoal' }).labels.map((l) => l.text);
      // What a blueprint asked to label isn't the plan's to keep: code decides those words and when they land (frameLabels), so the plan check doesn't hold it to them.
      const { blueprint: planned } = withTouches(spec.blueprint ?? {}, spec.touches ?? []);
      const codeOwned = [...(planned.labels ?? []).filter((l) => l.kind !== 'number').map((l) => l.text), ...(planned.pieces ?? []).flatMap((p) => (p.label ? [typeof p.label === 'string' ? p.label : p.label.text] : []))];
      (doc.__compiled ??= {})[ctx.id] = {
        manifest: made.manifest(),
        reports,
        plain: plainFrame,
        cues: built.cues,
        names_held_back: [...asked.filter((t) => !kept.includes(t)), ...codeOwned],
        labels_cut: built.labelCuts,
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
