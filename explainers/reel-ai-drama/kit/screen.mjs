// The screen check for Reel AI Drama frames (MD-58): what the viewer actually sees, measured in a real
// browser every STEP seconds of every frame, through the camera. Deterministic, no model. Where
// bounds.mjs measures text against its paper, this measures the picture as a whole. It reports:
//
//   [empty_frame]     nothing to look at: loaded pictures and readable text cover less than EMPTY_COVER
//                     of the screen for EMPTY_SECONDS or longer (Lucas: "the viewer just gets confused")
//   [image_unloaded]  a visible <img> with no picture (an empty src, a missing file, a failed decode)
//   [off_frame]       a picture or text block parked partly off the edge: between OFF_MIN and OFF_MAX of
//                     it inside the frame and not moving for PARKED_SECONDS, or mostly outside (under
//                     MOSTLY_OFF) for MOSTLY_OFF_SECONDS even while moving (a full-bleed picture is fine)
//   [early_visible]   the same, at the start of a frame, for something that later moves in: it shows
//                     before its entrance instead of starting fully outside
//   [low_contrast]    readable text whose contrast with what is behind it is under MIN_CONTRAST (white
//                     on the whiteboard, white over a light page)
//   [text_over_text]  readable text over a busy picture (a page, an article, a post) with no plate under it
//   [mark_on_nothing] a mark (ring, underline, arrow, cross, highlight: kit strokes carry data-ink) with no
//                     target element, or whose target shows nothing for MARK_SECONDS: no words, no drawn
//                     strokes, no picture detail under it (a ring around blank paper). An orange stroke the
//                     frame drew itself, outside the kit's marks, has no target either.
//
// Iteration 4 (fail open: one fix round, then a flag):
//   [caption_contrast]   the captions, in the tone the skin gives them (measure.mjs TONES), read under
//                        MIN_CONTRAST against the band under them for CAPTION_SECONDS
//   [mark_off_target]    a finished mark that misses its target (its centre off the target's, sized far
//                        from it, an underline not under it), runs off the frame, marks words whose line
//                        the frame cuts (a push past the page's edge), or first shows in the frame's last
//                        MARK_TAIL seconds (too late to be seen whole)
//   [text_over_face]     readable words or a graphic ([data-graphic]: a stat's disc, bar, figure) over a
//                        measured face, or a face under the caption band
//   [duplicate_person]   one person's face on two pictures at once (a lifted cut-out and its page excepted)
//   [white_box]          a made drawing showing its white paper as a box on the ground
//   [empty_frame]        also: the frame opens on an empty screen, or a plate shows with none of its words
//   [subject_off_centre] the main face's centre outside the centre column (x 270–810, y 700–1240) for
//                        OFF_CENTRE_SECONDS (the subject line is y ≈ 800–1100)
//
// Iteration 8 (each names the element and the time, for the fix step):
//   [opening_unformed]   at frame 1's first instant (t ≈ 0.05s) the main picture is missing, still arriving,
//                        partly out of frame or not composed in the middle of the screen
//   [mark_drift]         a drawn mark that slides off its target while the target moves, or one stroke across
//                        several lines of words (it runs through them instead of under them)
//   [mark_offscreen]     any part of a mark outside the frame, expression marks included
//   [mark_unseen]        ink that doesn't read on the real pixels behind it
//   [label_on_face]      a label over a measured face, over the people of a picture with no measured faces, or
//                        over what the frame marks
//   [edge_gap]           the ground stops short of a frame edge while it moves (2 samples or more)
//   [same_image_recut]   nk.cuts re-enters the picture of the shot before at about the same size, instead of working
//                        with it (nk.tour) or going to a true close-up (RECUT_CLOSE_UP)
//   [subject_low]        the main picture's centre outside y 620–1180 or its bottom below y 1500 for
//                        SUBJECT_SECONDS. A cutout, a full-bleed picture, a backdrop and anything faint (a burst,
//                        a ground) are not the main picture; a page too tall to fit is judged by what it marks.
//
// Iteration 9 (composition, against the measured pictures, on silhouette, every STEP):
//   [keep_covered]       more than KEEP_COVERED of a keep (a head and upper shoulders; a logo's or thing's whole visible
//                        box; a card's words) is under another piece or a label, for COVER_SECONDS
//   [label_off_owner]    a label is nearer something else than its owner (its `for`, or the name it says), or far from it
//   [label_before_owner] a label is up while its owner isn't on screen yet
//   [mark_off_head]      marks of an inner state that have left the top of the head they belong to
//   [mixed_style]        a cut person beside an uncut person shown as a bare rectangle
//   [stage_tight]        nk.stage had no room at any size: it placed everything as well as it could
//   [head_size]          a head beyond the on-screen maximum under the camera (I13)
//   [over_sharp]         a picture shown wider than it stays sharp (I15)
//   [open_edge]          a cut edge shows, off nothing, not behind a piece or the ledge (I7)
//   [plate_on_head]      a speech plate on a head, face or chin (I18); [plate_off_frame] outside the frame
//   [label_on_body]      a name on a chest or tie (I17)
//   [credits_stacked]    more than one credit line at once (I19)
//   [void]               a small card on an empty stage (I14)
//
// Scene dressing ([data-set]) and the source credit ([data-credit]) are not readable text; anything
// inside [data-bleed] may run off the edges on purpose. The close is code's and is not checked.
//
//   node assets/kit/screen.mjs [all | <id>]
//
// Prints JSON { ok, errors[], checked, skipped? } and exits 1 on any error. Without a browser it prints
// { ok: true, skipped } and exits 0: a guard, never a blocker of the build.

import { LIMITS, preparePiece } from './stage-layout.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { frameTreatment, isClose, LIGHT_TREATMENTS, objectStrokes, projectFrames, projectMedia } from './frames.mjs';
import { open, W, H } from './browser.mjs';
import { captionContrast, sampleBand } from './measure.mjs';

export const STEP = 0.2;
/** A keep counts as covered above this share (the solver's limit is 5%, this samples a moving frame). */
export const KEEP_COVERED = 0.1;
export const COVER_SECONDS = 0.6;
/** A label this far from its owner's keep, px, has left it; another keep this much nearer has taken it. */
export const OWNER_GAP = 300;
export const OWNER_MARGIN = 40;
export const OWNER_SECONDS = 0.4;
/** Share of the screen pictures and readable text must cover for a moment to count as "something to look at". */
export const EMPTY_COVER = 0.12;
export const EMPTY_SECONDS = 0.4;
/** A plate shown with none of its words for this long is an empty box. */
export const EMPTY_BOX_SECONDS = 0.4;
/** Captions under MIN_CONTRAST for this long are reported. */
export const CAPTION_SECONDS = 0.4;
/** Words over a face, or one person twice, for this long. */
export const FACE_SECONDS = 0.4;
/** The main face outside the centre column for this long. */
export const OFF_CENTRE_SECONDS = 1;
/** Where the main face's centre may sit (the subject line y ≈ 800–1100 and the centre column, with slack). */
export const CENTRE = { x0: 270, x1: 810, y0: 700, y1: 1240 };
/** A face counts as the subject from this share of the screen up. */
/** A stage guarantee measured on the render has to hold this long to count. */
export const STAGE_SECONDS = 0.4;
export const SUBJECT_AREA = 0.01;
/** A finished mark's box against its target's: area ratio bounds and centre offset (share of the target's size). */
export const MARK_AREA = [0.5, 4.5];
export const MARK_OFFSET = 0.3;
/** A mark that first shows this close to its frame's end is too late. */
export const MARK_TAIL = 0.4;
/** Share of an element inside the frame that counts as "parked on the edge". */
export const OFF_MIN = 0.05;
export const OFF_MAX = 0.85;
export const PARKED_SECONDS = 0.4;
/** Mostly outside (under MOSTLY_OFF inside) for this long counts as off the edge even while it moves (a push). */
export const MOSTLY_OFF = 0.5;
export const MOSTLY_OFF_SECONDS = 1;
/** WCAG contrast for large text. */
export const MIN_CONTRAST = 3;
/** Luminance spread (0–1 std dev) of the picture under a text box above which the picture is busy. */
export const BUSY_SPREAD = 0.16;

/** Luminance spread under a mark's target below which the picture there is blank (paper, sky, a wall). */
export const BLANK_SPREAD = 0.035;
/** A mark over nothing this long is reported (a mark landing as its target arrives is not). */
export const MARK_SECONDS = 0.4;

/** The main picture's safe band (burnt captions above, platform captions below), and how long it may leave it. */
export const SUBJECT_BAND = { top: 620, bottom: 1180, maxBottom: 1500 };
export const SUBJECT_SECONDS = 1;
/** A picture taller than this can't fit the band: it is a page that runs on, judged by what it marks. */
export const TALL_PICTURE = 880;
/** Such a page starting below this leaves the middle of the screen empty. */
export const TALL_TOP = 900;
/** How far a drawn mark may move against its target (px, and share of the target's smaller side). */
export const DRIFT_PX = 10;
export const DRIFT_SHARE = 0.25;
/** A mark past the frame by more than this (px) is off screen. */
export const OFFSCREEN_SLACK = 4;
/** Ink unseen: under this contrast and this close in colour to what is behind it. */
export const UNSEEN_CONTRAST = 1.6;
export const UNSEEN_DISTANCE = 110;
/** The first instant of frame 1, and the moment it is compared with to tell if the main picture is still arriving. */
export const OPENING_AT = 0.05;
export const OPENING_SETTLED_AT = 0.6;
/** Frame 1 opens composed: centre column and the band, at least this much of the screen covered, moved at most this far. */
export const OPENING_X = { x0: 270, x1: 810 };
export const OPENING_COVER = 0.25;
export const OPENING_MOVE_PX = 40;
export const OPENING_GROW = 1.6;

/** Is this frame the reel's first? (mount.mjs and browser.mjs mark its host the same way.) */
export const isFirstFrame = (id) => /^0*1(-|$)/.test(String(id ?? ''));

const r1 = (n) => Math.round(n * 10) / 10;

/** Runs of consecutive moments (STEP apart) for which `test` holds: [{ first, last, item }]. */
export function runs(moments, key, test) {
  const out = [];
  let open = null;
  for (const m of moments) {
    const hit = test(m);
    if (hit) {
      if (open && m.t - open.last <= STEP * 1.5) open.last = m.t;
      else {
        open = { first: m.t, last: m.t, item: hit === true ? null : hit, key };
        out.push(open);
      }
    } else open = null;
  }
  return out;
}

/**
 * Turn the per-moment measurements of one frame into problem lines.
 * moments: [{ t, cover, imgs: [{ label, src, loaded, inside, rect, bleed }], texts: [{ label, contrast, busy, plated }],
 *   marks?: [{ label, target, content }] }]
 */
export function screenProblems(moments, { duration }) {
  const out = [];
  const span = (a, b) => `${r1(a)}s${b > a ? `–${r1(b)}s` : ''}`;
  const long = (r, secs) => r.last - r.first + STEP >= secs - 1e-6;
  for (const r of runs(moments, 'empty', (m) => m.cover < EMPTY_COVER)) {
    // A board is not an empty screen: its first item draws in (strokes aren't pictures), except on the reel's first frame.
    if (r.first < STEP / 2 && moments[0]?.onBoard) continue;
    if (long(r, EMPTY_SECONDS)) out.push(`[empty_frame] almost nothing on screen (${span(r.first, r.last)})`);
    else if (r.first < STEP / 2 && !moments[0]?.onBoard) out.push(`[empty_frame] the frame opens on an empty screen (${span(r.first, r.last)}); show its main image from t = 0`);
  }
  const boxes = new Set(moments.flatMap((m) => m.emptyBoxes ?? []));
  for (const label of boxes) {
    const r = runs(moments, 'box', (m) => (m.emptyBoxes ?? []).includes(label)).find((x) => long(x, EMPTY_BOX_SECONDS));
    if (r) out.push(`[empty_frame] "${label}" shows its plate with none of its words (${span(r.first, r.last)}); a plate appears with its words, never before`);
  }
  for (const r of runs(moments, 'caption', (m) => m.caption && m.caption.contrast !== null && m.caption.contrast < MIN_CONTRAST)) {
    if (!long(r, CAPTION_SECONDS)) continue;
    const m = moments.find((x) => x.t === r.first);
    out.push(`[caption_contrast] the captions (${m.caption.tone}) read at ${m.caption.contrast.toFixed(1)}:1 on what is under them (${span(r.first, r.last)}); keep the band clear of light or busy picture, or the skin's tone is wrong there`);
  }
  const each = (key, fmt, secs) => {
    const labels = new Set(moments.flatMap((m) => (m[key] ?? []).map((x) => (typeof x === 'string' ? x : x.label))));
    for (const label of labels) {
      const r = runs(moments, key, (m) => (m[key] ?? []).some((x) => (typeof x === 'string' ? x : x.label) === label)).find((x) => long(x, secs));
      if (r) out.push(fmt(label, span(r.first, r.last)));
    }
  };
  each('overFace', (label, when) => `[text_over_face] ${label} (${when}); labels go beside a face, never on it, and faces stay out of the caption band`, FACE_SECONDS);
  each('dupes', (label, when) => `[duplicate_person] ${label} is on screen twice at once (${when}); show each person once in a moment (a lift leaves its page, nothing else repeats them)`, FACE_SECONDS);
  each('whiteBoxes', (label, when) => `[white_box] "${label}" shows its white paper as a box on the ground (${when}); a drawing is transparent around its ink`, STEP);
  for (const r of runs(moments, 'centre', (m) => (m.subject && (m.subject.x < CENTRE.x0 || m.subject.x > CENTRE.x1 || m.subject.y < CENTRE.y0 || m.subject.y > CENTRE.y1) ? m.subject.label : false))) {
    if (!long(r, OFF_CENTRE_SECONDS)) continue;
    const m = moments.find((x) => x.t === r.first);
    out.push(`[subject_off_centre] the main face (${r.item}) sits at x ${Math.round(m.subject.x)}, y ${Math.round(m.subject.y)} (${span(r.first, r.last)}); centre the subject in the centre column at y 800–1100`);
  }
  const unloaded = new Map();
  for (const m of moments) for (const i of m.imgs) if (!i.loaded) unloaded.set(i.label, unloaded.get(i.label) ?? m.t);
  for (const [label, t] of unloaded) out.push(`[image_unloaded] "${label}" is visible with no picture (from ${r1(t)}s)`);

  // Parked on the edge: the same element, partly inside, not moving, for PARKED_SECONDS.
  const byLabel = new Map();
  for (const m of moments) {
    for (const i of [...m.imgs, ...(m.blocks ?? [])]) {
      if (i.bleed || !i.loaded && i.loaded !== undefined) continue;
      const list = byLabel.get(i.label) ?? [];
      list.push({ t: m.t, inside: i.inside, rect: i.rect });
      byLabel.set(i.label, list);
    }
  }
  for (const [label, seen] of byLabel) {
    // Mostly outside for a second or more, moving or not (a camera push that leaves the subject off the edge).
    for (const r of runs(seen.map((x) => ({ ...x })), 'mostly', (x) => x.inside >= OFF_MIN && x.inside < MOSTLY_OFF)) {
      if (r.last - r.first + STEP >= MOSTLY_OFF_SECONDS) out.push(`[off_frame] "${label}" is mostly off the edge (${span(r.first, r.last)})`);
    }
    const movesLater = (t) => seen.some((s) => s.t > t && s.inside > OFF_MAX);
    let start = null;
    for (let k = 0; k < seen.length; k++) {
      const s = seen[k];
      const prev = seen[k - 1];
      const parked = s.inside >= OFF_MIN && s.inside <= OFF_MAX && prev && prev.t >= s.t - STEP * 1.5 && prev.inside >= OFF_MIN && prev.inside <= OFF_MAX && s.rect.every((v, j) => Math.abs(v - prev.rect[j]) < 2);
      if (parked) start ??= prev.t;
      const end = !parked || k === seen.length - 1;
      if (start !== null && end) {
        const last = parked ? s.t : prev.t;
        if (last - start + STEP >= PARKED_SECONDS) {
          const id = start < STEP && movesLater(last) ? 'early_visible' : 'off_frame';
          const why = id === 'early_visible' ? 'shows partly on screen before its entrance' : 'is parked partly off the edge';
          out.push(`[${id}] "${label}" ${why} (${span(start, last)})`);
        }
        start = null;
      }
    }
  }

  const texts = new Map();
  for (const m of moments) {
    for (const x of m.texts) {
      const prior = texts.get(x.label);
      if (x.contrast !== null && x.contrast < MIN_CONTRAST) texts.set(x.label, { ...(prior ?? {}), low: prior?.low ?? m.t, contrast: Math.min(prior?.contrast ?? 99, x.contrast) });
      if (x.busy && !x.plated) texts.set(x.label, { ...(texts.get(x.label) ?? {}), busy: texts.get(x.label)?.busy ?? m.t });
    }
  }
  for (const [label, v] of texts) {
    if (v.low !== undefined) out.push(`[low_contrast] "${label}" reads at contrast ${v.contrast.toFixed(1)}:1 against what is behind it (from ${r1(v.low)}s); give it a plate or a contrasting colour`);
    if (v.busy !== undefined) out.push(`[text_over_text] "${label}" sits on a busy picture with no plate under it (from ${r1(v.busy)}s)`);
  }

  each('keepCovered', (label, when) => `[keep_covered] ${label} (${when}); build the shot with nk.stage: it works out who stands in front and who slides over`, COVER_SECONDS);
  each('labelOffOwner', (label, when) => `[label_off_owner] ${label} (${when}); give the label \`for:\` its owner, and leave the spot to the kit`, OWNER_SECONDS);
  each('labelBeforeOwner', (label, when) => `[label_before_owner] ${label} (${when}); a label lands with or after what it names`, STEP);
  each('markOffHead', (label, when) => `[mark_off_head] ${label} (${when}); marks of an inner state go around the top of the head: use nk.stage or give them the right \`on\``, OWNER_SECONDS);
  each('mixedStyle', (label, when) => `[mixed_style] ${label} (${when}); on a stage every person is a cutout, or a framed print: nk.stage does this from the measured picture`, OWNER_SECONDS);
  each('headSize', (label, when) => `[head_size] ${label} (${when}); the stage's camera limits a head on screen: aim it with spec.camera, not by hand`, STAGE_SECONDS);
  each('overSharp', (label, when) => `[over_sharp] ${label} (${when}); never enlarge a picture past what stays sharp`, STAGE_SECONDS);
  each('openEdge', (label, when) => `[open_edge] ${label} (${when}); a cut body runs off the frame or behind the ledge, never stops in mid-air`, STAGE_SECONDS);
  each('plateOnHead', (label, when) => `[plate_on_head] ${label} (${when}); use spec.speech: the stage keeps plates off heads, faces and chins`, STAGE_SECONDS);
  each('plateOff', (label, when) => `[plate_off_frame] ${label} (${when}); use spec.speech: the stage keeps plates inside the frame`, STAGE_SECONDS);
  each('labelOnBody', (label, when) => `[label_on_body] ${label} (${when}); names go in clear space beside their owner or at the body's outer edge`, STAGE_SECONDS);
  each('creditsStacked', (label, when) => `[credits_stacked] ${label} (${when}); one credit line at a time, under the stage`, STAGE_SECONDS);
  // A frame may open close on its first piece; what it settles on is what has to fill the area.
  const settled = moments.at(-1)?.t ?? 0;
  for (const r of runs(moments, 'void', (m) => m.voidFrame?.length > 0)) {
    if (r.last >= settled - 1e-6 && long(r, STAGE_SECONDS)) out.push(`[void] ${moments.find((m) => m.t === r.last).voidFrame[0].label} (${span(r.first, r.last)}); the usable area is filled: a piece grows, or the camera comes in`);
  }
  each('labelOnFace', (label, when) => `[label_on_face] ${label} (${when}); nk.label and nk.lineLabel pick a free spot themselves: drop the x and y, or stage the picture so there is one`, STEP);
  each('offscreen', (label, when) => `[mark_offscreen] ${label} (${when}); a mark stays wholly inside the frame: move what it marks in, or pull the camera back`, STEP);
  each('unseen', (label, when) => `[mark_unseen] ${label} (${when}); let the kit pick the ink (drop \`color\`), or mark on a clearer part of the picture`, STEP);
  each('drift', (label, when) => `[mark_drift] ${label} (${when}); draw it with nk.mark or the marker functions on the words themselves, and render what it marks before the mark`, STEP);
  for (const r of runs(moments, 'edge', (m) => m.edgeGap?.label ?? false)) {
    if (!long(r, STEP * 2)) continue;
    const m = moments.find((x) => x.t === r.first);
    out.push(`[edge_gap] ${m.edgeGap.label} stops ${m.edgeGap.px}px short of the frame's ${m.edgeGap.edges.join(' and ')} edge (${span(r.first, r.last)}); make the moving world bigger than the frame, or hold it so it always covers the frame`);
  }
  for (const r of runs(moments, 'low', (m) => lowSubject(m.main)?.label ?? false)) {
    if (!long(r, SUBJECT_SECONDS)) continue;
    const m = moments.find((x) => x.t === r.first);
    out.push(`[subject_low] ${lowSubject(m.main).why} (${span(r.first, r.last)}); bring it to the middle of the screen: centre between y ${SUBJECT_BAND.top} and ${SUBJECT_BAND.bottom}, nothing that matters below y ${SUBJECT_BAND.maxBottom}`);
  }
  // A drawn mark that moves against its target.
  for (const label of new Set(moments.flatMap((m) => (m.marks ?? []).filter((k) => k.track).map((k) => k.label)))) {
    const seen = moments.map((m) => ({ t: m.t, k: (m.marks ?? []).find((x) => x.label === label) })).filter((x) => x.k?.track);
    const base = seen[0]?.k.track;
    const offBy = (x) => Math.hypot((x.k.track.dx - base.dx) * x.k.track.tw, (x.k.track.dy - base.dy) * x.k.track.th);
    const away = (x) => offBy(x) > Math.max(DRIFT_PX, DRIFT_SHARE * Math.min(x.k.track.tw, x.k.track.th));
    const r = runs(seen, 'drift', away).find((v) => long(v, STEP * 2));
    if (r) out.push(`[mark_drift] "${label}" slides ${Math.round(Math.max(...seen.filter((x) => x.t >= r.first && x.t <= r.last).map(offBy)))}px off its target as the target moves (${span(r.first, r.last)}); a mark is drawn on its target's picture so it moves with it, and renders after it`);
  }
  // Marks: no target at any moment, or a target with nothing in it for MARK_SECONDS.
  const markLabels = new Set();
  for (const m of moments) for (const k of m.marks ?? []) markLabels.add(k.label);
  for (const label of markLabels) {
    const seen = moments.map((m) => ({ t: m.t, k: (m.marks ?? []).find((x) => x.label === label) }));
    const untargeted = seen.find((x) => x.k && !x.k.target);
    if (untargeted) {
      out.push(`[mark_on_nothing] "${label}" has no target element (from ${r1(untargeted.t)}s); draw it with the kit's mark functions on the word, face, figure or item it marks`);
      continue;
    }
    const empty = runs(seen, 'blank', (x) => Boolean(x.k && !x.k.content)).find((r) => r.last - r.first + STEP >= MARK_SECONDS);
    if (empty) out.push(`[mark_on_nothing] "${label}" marks nothing visible: no words, drawing or picture detail under it (${span(empty.first, empty.last)}); mark the element the line is about`);
    const off = seen.find((x) => x.k?.geo?.off);
    if (off) out.push(`[mark_off_target] "${label}" ${off.k.geo.off} (from ${r1(off.t)}s); draw it with nk.mark on the face, words or element it marks`);
    const first = seen.find((x) => x.k && x.k.target);
    if (first && duration > 1 && first.t > duration - MARK_TAIL - 1e-6 && first.t > 0) out.push(`[mark_off_target] "${label}" first shows at ${r1(first.t)}s, in the frame's last ${MARK_TAIL}s: too late to be seen whole; land it on its cue word earlier`);
  }
  return out;
}

/**
 * The main picture's fault against the safe band, or null. `main`: { label, rect: [l, t, r, b], bleed, cutout,
 * focus?: { label, rect } }. Full-bleed pictures and cutouts have none (a figure runs off the bottom by design; the
 * face has its own check). A page too tall to fit is judged by what it marks: that must not sit under the platform captions. Pure.
 */
export function lowSubject(main) {
  if (!main || main.bleed || main.cutout) return null;
  const [, top, , bottom] = main.rect;
  if (bottom - top > TALL_PICTURE) {
    if (top > TALL_TOP) return { label: main.label, why: `"${main.label}" starts low, at y ${Math.round(top)}, leaving the middle of the screen empty` };
    if (!main.focus || main.focus.rect[3] <= SUBJECT_BAND.maxBottom) return null;
    return { label: main.label, why: `what the page marks (${main.focus.label}) runs to y ${Math.round(main.focus.rect[3])}, under the platform captions` };
  }
  const cy = (top + bottom) / 2;
  // The hook's words hold the middle band; the subject stands under them.
  if (cy > SUBJECT_BAND.bottom && !main.underHook) return { label: main.label, why: `"${main.label}" sits low: its centre is at y ${Math.round(cy)}` };
  if (cy < SUBJECT_BAND.top) return { label: main.label, why: `"${main.label}" sits high: its centre is at y ${Math.round(cy)}, in the captions` };
  if (bottom > SUBJECT_BAND.maxBottom) return { label: main.label, why: `"${main.label}" runs to y ${Math.round(bottom)}, under the platform captions` };
  return null;
}

/**
 * Frame 1's first instant against its settled moment: problem lines. `first`, `later`: measureScreen moments
 * ({ cover, main }). A later picture can arrive; the main one may not. Pure.
 */
export function openingProblems(first, later) {
  const at = `t = ${OPENING_AT}s`;
  const main = first?.main;
  if (!main) {
    if ((first?.cover ?? 0) >= OPENING_COVER) return [];
    return [`[opening_unformed] frame 1 opens on almost nothing (${at}): show its main picture, fully on, from the first instant`];
  }
  const area = ([l, t, r, b]) => Math.max(0, r - l) * Math.max(0, b - t);
  const out = [];
  if (later?.main && later.main.label !== main.label && area(later.main.rect) >= OPENING_GROW * area(main.rect)) {
    out.push(`[opening_unformed] frame 1 opens on "${main.label}" and its main picture "${later.main.label}" only arrives later (${at}): put the main picture on from the first instant; smaller things can still arrive`);
  }
  if (main.opacity < 0.9) out.push(`[opening_unformed] "${main.label}" is still fading in at the first instant (${at}, opacity ${main.opacity.toFixed(2)}): put it on from the first instant`);
  if (!main.bleed && main.inside < 0.85) out.push(`[opening_unformed] only ${Math.round(main.inside * 100)}% of "${main.label}" is in the frame at the first instant (${at}): start it wholly in frame`);
  const c = ([l, t, r, b]) => [(l + r) / 2, (t + b) / 2];
  if (later?.main?.label === main.label && !main.bleed) {
    const [x0, y0] = c(main.rect), [x1, y1] = c(later.main.rect);
    if (Math.hypot(x1 - x0, y1 - y0) > OPENING_MOVE_PX || area(later.main.rect) > 1.25 * area(main.rect)) out.push(`[opening_unformed] "${main.label}" is still arriving at the first instant (${at}): it moves ${Math.round(Math.hypot(x1 - x0, y1 - y0))}px by ${OPENING_SETTLED_AT}s; start it at rest`);
  }
  if (!main.bleed) {
    const [cx, cy] = c(main.rect);
    const place = [];
    if (cx < OPENING_X.x0 || cx > OPENING_X.x1) place.push(`x ${Math.round(cx)}`);
    if (cy < SUBJECT_BAND.top || (cy > SUBJECT_BAND.bottom && !main.underHook)) place.push(`y ${Math.round(cy)}`);
    if (place.length) out.push(`[opening_unformed] "${main.label}" opens off-centre at ${place.join(', ')} (${at}): compose frame 1 around it, centred between y ${SUBJECT_BAND.top} and ${SUBJECT_BAND.bottom}, so the first instant is a formed picture`);
  }
  return out;
}

const channels = (c) => {
  const v = String(c ?? '').match(/[\d.]+/g)?.map(Number);
  return v && v.length >= 3 ? v.slice(0, 3) : null;
};
const lumOf = ([r, g, b]) => {
  const k = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * k(r) + 0.7152 * k(g) + 0.0722 * k(b);
};
/** Whether ink of `colour` ('rgb(…)') is lost on what is behind it ({ rgb: [r, g, b] }, its mean). Pure. */
export function inkUnseen(colour, behind) {
  const c = channels(colour);
  if (!c || !behind?.rgb) return false;
  const a = lumOf(c), b = lumOf(behind.rgb);
  const contrastRatio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const distance = Math.hypot(c[0] - behind.rgb[0], c[1] - behind.rgb[1], c[2] - behind.rgb[2]);
  return contrastRatio < UNSEEN_CONTRAST && distance < UNSEEN_DISTANCE;
}

/** The mean colour of a PNG (runs in the browser). */
async function meanColour(b64) {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 24; c.height = 24;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, 24, 24);
  const d = g.getImageData(0, 0, 24, 24).data;
  const rgb = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) { rgb[0] += d[i]; rgb[1] += d[i + 1]; rgb[2] += d[i + 2]; }
  return { rgb: rgb.map((v) => v / 576) };
}

/** What is behind a mark on screen: a shot of its box with all ink hidden. Null when it can't be read. */
async function behindInk(page, rect) {
  const clip = { x: Math.max(0, rect[0]), y: Math.max(0, rect[1]), width: Math.min(W, rect[2]) - Math.max(0, rect[0]), height: Math.min(H, rect[3]) - Math.max(0, rect[1]) };
  if (!(clip.width >= 2 && clip.height >= 2)) return null;
  const toggle = (hide) => { for (const e of document.querySelectorAll('#w [data-ink], #w [data-expression]')) e.style.visibility = hide ? 'hidden' : ''; };
  await page.evaluate(toggle, true);
  try {
    const shot = await page.screenshot({ clip, type: 'png' });
    return await page.evaluate(meanColour, typeof shot === 'string' ? shot : Buffer.from(shot).toString('base64'));
  } finally {
    await page.evaluate(toggle, false);
  }
}

/** Measure one moment (runs in the browser; self-contained, so page.evaluate can ship it). */
export async function measureScreen({ W, H, BLANK, drawnFiles = [], subjectArea = 0.01, markArea = [0.5, 4.5], markOffset = 0.3, slack = 4 }) {
  const host = document.getElementById('w');
  const hr = host.getBoundingClientRect();
  const screenArea = W * H;
  const visible = (el) => {
    let op = 1;
    for (let e = el; e && e !== host; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
      op *= Number(cs.opacity);
    }
    return op;
  };
  const clip = (r) => {
    const l = Math.max(0, r.left - hr.left), t = Math.max(0, r.top - hr.top);
    const rr = Math.min(W, r.right - hr.left), b = Math.min(H, r.bottom - hr.top);
    return rr > l && b > t ? (rr - l) * (b - t) : 0;
  };
  const labelOf = (el) => (el.getAttribute('src') || el.textContent || el.className || el.tagName).toString().split('/').pop().trim().replace(/\s+/g, ' ').slice(0, 40);
  // Coverage on a coarse grid, so overlapping pictures are not counted twice.
  const G = 24;
  const cell = new Uint8Array(G * G);
  const mark = (r) => {
    const x0 = Math.max(0, Math.floor(((r.left - hr.left) / W) * G)), x1 = Math.min(G, Math.ceil(((r.right - hr.left) / W) * G));
    const y0 = Math.max(0, Math.floor(((r.top - hr.top) / H) * G)), y1 = Math.min(G, Math.ceil(((r.bottom - hr.top) / H) * G));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cell[y * G + x] = 1;
  };

  const imgs = [];
  for (const img of host.querySelectorAll('img')) {
    const op = visible(img);
    if (op < 0.15) continue;
    const r = img.getBoundingClientRect();
    const area = r.width * r.height;
    if (area < 400) continue;
    const inside = clip(r) / area;
    if (inside <= 0) continue;
    const loaded = !!img.getAttribute('src') && img.complete && img.naturalWidth > 0;
    // A long page may run off the bottom on purpose: its sides and top are in frame.
    const runsOn = r.width >= W * 0.55 && r.height >= H * 0.5 && r.left >= hr.left - 4 && r.right <= hr.left + W + 4 && r.top >= hr.top && r.top < hr.top + H * 0.75 && r.bottom > hr.top + H;
    const bleed = !!img.closest('[data-bleed], [data-zoom], [data-piece][data-kind="person"]') || (r.width >= W * 0.95 && r.height >= H * 0.5) || (r.height >= H * 0.95 && r.width >= W * 0.5) || runsOn;
    if (loaded) mark(r);
    imgs.push({ label: labelOf(img), loaded, inside, bleed, rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
  }
  for (const el of host.querySelectorAll('svg path, svg line, svg polyline, canvas')) {
    if (visible(el) < 0.15) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height > 900) mark(r);
  }

  // Readable text: contrast with what is behind its centre, and whether that is a busy picture.
  const lum = ([r, g, b]) => {
    const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
  };
  const rgba = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const canvas = document.createElement('canvas');
  const ctx2d = canvas.getContext('2d', { willReadFrequently: true });
  const sampleImg = (img, r) => {
    const ir = img.getBoundingClientRect();
    if (!img.naturalWidth || ir.width < 1) return null;
    const sx = ((r.left - ir.left) / ir.width) * img.naturalWidth, sy = ((r.top - ir.top) / ir.height) * img.naturalHeight;
    const sw = (r.width / ir.width) * img.naturalWidth, sh = (r.height / ir.height) * img.naturalHeight;
    canvas.width = 32; canvas.height = 32;
    try {
      ctx2d.drawImage(img, sx, sy, Math.max(1, sw), Math.max(1, sh), 0, 0, 32, 32);
      const d = ctx2d.getImageData(0, 0, 32, 32).data;
      let sum = 0, sq = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { const l = lum([d[i], d[i + 1], d[i + 2]]); sum += l; sq += l * l; n++; }
      const mean = sum / n;
      return { mean, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
    } catch {
      return null;
    }
  };
  const texts = [];
  const blocks = [];
  const readable = [];
  const done = new Set();
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || done.has(el) || !n.textContent.trim()) continue;
    done.add(el);
    if (el.closest('[data-set]') || el.closest('[data-credit]') || el.closest('svg')) continue;
    if (visible(el) < 0.15) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    mark(r);
    const label = labelOf(el);
    const inside = clip(r) / (r.width * r.height);
    if (!el.closest('[data-bleed]')) blocks.push({ label, inside, rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
    if (inside >= 0.5) readable.push({ label, r, el });
    if (inside < 0.5) continue;
    const color = rgba(getComputedStyle(el).color);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let behind = null, busy = false, plated = false;
    // Its own plate first: while a label wipes in, the point may be outside its clip and a hit test would miss it.
    for (let e = el; e && e !== host; e = e.parentElement) {
      const bg = rgba(getComputedStyle(e).backgroundColor);
      if (bg.length >= 3 && (bg[3] ?? 1) >= 0.6) { behind = lum(bg); plated = true; break; }
    }
    if (!plated) for (const under of document.elementsFromPoint(cx, cy)) {
      if (under === el || el.contains(under)) continue;
      if (under.contains(el)) {
        const bg = rgba(getComputedStyle(under).backgroundColor);
        if (bg.length >= 3 && (bg[3] ?? 1) >= 0.6) { behind = lum(bg); plated = true; break; }
        continue;
      }
      if (under.tagName === 'IMG') {
        const s = sampleImg(under, r);
        if (s) { behind = s.mean; busy = s.spread > 0.16; }
        break;
      }
      const bg = rgba(getComputedStyle(under).backgroundColor);
      if (bg.length >= 3 && (bg[3] ?? 1) >= 0.6) { behind = lum(bg); break; }
      if (under === host) break;
    }
    texts.push({ label, contrast: behind === null || color.length < 3 ? null : Math.round(ratio(lum(color), behind) * 10) / 10, busy, plated });
  }
  // Marks and what they mark.
  const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const sampleRegion = (img, r) => {
    const ir = img.getBoundingClientRect();
    const x0 = Math.max(r.left, ir.left), y0 = Math.max(r.top, ir.top), x1 = Math.min(r.right, ir.right), y1 = Math.min(r.bottom, ir.bottom);
    if (!img.naturalWidth || x1 - x0 < 1 || y1 - y0 < 1) return null;
    const sx = ((x0 - ir.left) / ir.width) * img.naturalWidth, sy = ((y0 - ir.top) / ir.height) * img.naturalHeight;
    const sw = ((x1 - x0) / ir.width) * img.naturalWidth, sh = ((y1 - y0) / ir.height) * img.naturalHeight;
    canvas.width = 32; canvas.height = 32;
    try {
      ctx2d.clearRect(0, 0, 32, 32);
      ctx2d.drawImage(img, sx, sy, Math.max(1, sw), Math.max(1, sh), 0, 0, 32, 32);
      const d = ctx2d.getImageData(0, 0, 32, 32).data;
      let sum = 0, sq = 0, n = 0, touched = 0, clear = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] >= 16) touched++;
        else clear++;
        if (d[i + 3] < 128) continue;
        const l = lum([d[i], d[i + 1], d[i + 2]]); sum += l; sq += l * l; n++;
      }
      if (!n) return { opaque: 0, spread: 0, touched: touched / 1024, clear: clear / 1024 };
      const mean = sum / n;
      return { opaque: n / 1024, spread: Math.sqrt(Math.max(0, sq / n - mean * mean)), touched: touched / 1024, clear: clear / 1024 };
    } catch {
      return null;
    }
  };
  const isInk = (el) => el.closest('[data-ink]') || el.closest('[data-ink-region]');
  const hasContent = (r) => {
    if (r.width * r.height < 16) return false;
    const area = r.width * r.height;
    const tw = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const el = n.parentElement;
      if (!el || !n.textContent.trim() || el.closest('[data-credit]') || isInk(el) || visible(el) < 0.15) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const tr = range.getBoundingClientRect();
      const o = overlap(r, tr);
      if (o > 0 && o >= 0.25 * Math.min(area, tr.width * tr.height)) return true;
    }
    for (const img of host.querySelectorAll('img')) {
      if (visible(img) < 0.15 || !img.complete || !img.naturalWidth) continue;
      if (overlap(r, img.getBoundingClientRect()) < 0.25 * area) continue;
      const s = sampleRegion(img, r);
      if (s && s.opaque >= 0.15 && s.spread >= BLANK) return true;
      // Line art on transparency is all one colour: the lines themselves are the content.
      if (s && s.touched >= 0.03 && s.clear >= 0.02) return true;
    }
    // A keyed drawing shows on its canvas (its img is hidden).
    for (const c of host.querySelectorAll('canvas')) {
      if (visible(c) >= 0.15 && overlap(r, c.getBoundingClientRect()) >= 0.25 * area) return true;
    }
    for (const g of host.querySelectorAll('svg path, svg line, svg polyline, svg polygon, svg ellipse, svg circle, svg text')) {
      if (isInk(g) || g.closest('[data-bleed]') || visible(g) < 0.15) continue;
      const cs = getComputedStyle(g);
      if ((cs.stroke === 'none' || !cs.stroke) && (cs.fill === 'none' || !cs.fill)) continue;
      if (overlap(r, g.getBoundingClientRect()) > 0) return true;
    }
    return false;
  };
  const describe = (el) => {
    if (!el) return 'nothing';
    if (el.hasAttribute('data-ink-region')) {
      const holder = el.tagName.toLowerCase() === 'rect' ? el.closest('svg')?.parentElement : el.parentElement;
      const img = holder?.querySelector('img');
      return `a region of ${img ? labelOf(img) : 'the picture'}`;
    }
    const img = el.tagName === 'IMG' ? el : el.querySelector?.('img');
    if (img) return labelOf(img);
    return labelOf(el);
  };
  const marks = [];
  const drift = [];
  const seenInk = new Set();
  /** Every stroke's place and colour, for mark_offscreen and mark_unseen. */
  const offscreen = [];
  const inks = [];
  const noteInk = (label, kind, strokes, done) => {
    const shown = strokes.filter((x) => visible(x) >= 0.15);
    if (!shown.length) return;
    const pad = Math.max(...shown.map((x) => (parseFloat(getComputedStyle(x).strokeWidth) || 0) / 2));
    const rs = shown.map((x) => x.getBoundingClientRect());
    const box = [Math.min(...rs.map((r) => r.left)) - hr.left - pad, Math.min(...rs.map((r) => r.top)) - hr.top - pad, Math.max(...rs.map((r) => r.right)) - hr.left + pad, Math.max(...rs.map((r) => r.bottom)) - hr.top + pad];
    const edges = [box[0] < -slack && 'left', box[1] < -slack && 'top', box[2] > W + slack && 'right', box[3] > H + slack && 'bottom'].filter(Boolean);
    if (edges.length) offscreen.push({ label: `"${label}" runs off the frame's ${edges.join(' and ')} edge` });
    if (done && kind !== 'highlight') inks.push({ label, colour: getComputedStyle(shown[0]).stroke, rect: box });
  };
  const frameBox = { left: hr.left, top: hr.top, right: hr.left + W, bottom: hr.top + H };
  /** A text mark's line of words (the page's text keep-outs it touches) running off the frame: why, else null. */
  const lineCut = (target, tr) => {
    const textMark = (target.getAttribute('data-mark-target') ?? '').startsWith('text:') || (target.tagName.toLowerCase() === 'rect' && target.hasAttribute('data-ink-region'));
    if (!textMark || !(tr.width > 2 && tr.height > 2)) return null;
    const scope = target.closest('.rd-sheet') ?? target.parentElement;
    const lines = [...(scope?.querySelectorAll('[data-keepout="text"]') ?? [])].map((l) => l.getBoundingClientRect()).filter((r) => r.width > 0 && overlap(r, tr) > 0.3 * tr.width * tr.height);
    if (!lines.length) return null;
    const box = { left: Math.min(tr.left, ...lines.map((r) => r.left)), right: Math.max(tr.right, ...lines.map((r) => r.right)), top: Math.min(tr.top, ...lines.map((r) => r.top)), bottom: Math.max(tr.bottom, ...lines.map((r) => r.bottom)) };
    const edges = [box.left < frameBox.left - 2 && 'left', box.right > frameBox.right + 2 && 'right', box.top < frameBox.top - 2 && 'top', box.bottom > frameBox.bottom + 2 && 'bottom'].filter(Boolean);
    return edges.length ? `sits in a line of words cut by the frame's ${edges.join(' and ')} edge; keep the whole line in frame` : null;
  };
  /** One stroke across several lines of words runs through them: why, else null. The lines: the kit's count, else the page's text keep-outs. */
  const lineMiss = (kind, target, tr, strokeCount) => {
    if (kind !== 'underline' && kind !== 'highlight') return null;
    const declared = Number(target.getAttribute('data-mark-lines'));
    let lines = declared;
    if (!lines) {
      const textMark = (target.getAttribute('data-mark-target') ?? '').startsWith('text:') || (target.tagName.toLowerCase() === 'rect' && target.hasAttribute('data-ink-region'));
      if (!textMark) return null;
      const scope = target.closest('.rd-sheet') ?? target.parentElement;
      lines = [...(scope?.querySelectorAll('[data-keepout="text"]') ?? [])].map((l) => l.getBoundingClientRect()).filter((r) => r.width > 0 && overlap(r, tr) >= 0.4 * r.width * r.height).length;
    }
    return lines > 1 && strokeCount < lines ? `has ${strokeCount} stroke over ${lines} lines of words: it runs through them instead of under them` : null;
  };
  /** Where a finished mark sits against its target: null when on it, else why not. */
  const geometry = (kind, target, strokes) => {
    const shown = strokes.filter((x) => visible(x) >= 0.15);
    if (!shown.length) return { done: false, off: null };
    const doneDrawing = shown.every((x) => x.tagName.toLowerCase() !== 'path' || Math.abs(parseFloat(x.style.strokeDashoffset || '0')) < 1);
    if (!doneDrawing) return { done: false, off: null };
    const rs = shown.map((x) => x.getBoundingClientRect());
    const sb = { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) };
    const sw = sb.right - sb.left, sh = sb.bottom - sb.top;
    const tr = target.getBoundingClientRect();
    const track = tr.width > 2 && tr.height > 2 ? { dx: ((sb.left + sb.right) / 2 - (tr.left + tr.right) / 2) / tr.width, dy: ((sb.top + sb.bottom) / 2 - (tr.top + tr.bottom) / 2) / tr.height, tw: tr.width, th: tr.height } : null;
    const miss = lineMiss(kind, target, tr, strokes.length);
    if (miss) return { done: true, off: null, miss, track };
    // Words on a page: the whole line the marked words sit in stays in frame (a push must not cut it).
    const cut = lineCut(target, tr);
    if (cut) return { done: true, off: cut, track };
    const tw = tr.width, th = tr.height;
    if (!(tw > 2 && th > 2) || kind === 'arrow') return { done: true, off: null, track };
    if (kind === 'underline') {
      const overlapX = Math.max(0, Math.min(sb.right, tr.right) - Math.max(sb.left, tr.left));
      // An underline over several lines has a stroke per line: the last one is the one under the target's bottom.
      const lastTop = Math.max(...rs.map((r) => r.top));
      if (overlapX < 0.6 * tw || lastTop < tr.top + th * 0.5 || lastTop > tr.bottom + Math.max(24, th * 0.6)) return { done: true, off: 'is not under the words it marks', track };
      return { done: true, off: null, track };
    }
    // A highlight is a thick line: its height is its stroke's width.
    const thick = kind === 'highlight' ? Math.max(...shown.map((x) => parseFloat(getComputedStyle(x).strokeWidth) || 0)) : 0;
    const ratio = (sw * Math.max(sh, thick)) / (tw * th);
    const dx = Math.abs((sb.left + sb.right) / 2 - (tr.left + tr.right) / 2), dy = Math.abs((sb.top + sb.bottom) / 2 - (tr.top + tr.bottom) / 2);
    if (dx > markOffset * tw + 20 || dy > markOffset * th + 20) return { done: true, off: `is off its target's centre by ${Math.round(dx)}, ${Math.round(dy)} px`, track };
    if (ratio > markArea[1]) return { done: true, off: `is ${ratio.toFixed(1)}× its target's size (a ring is the target's size)`, track };
    if (ratio < markArea[0]) return { done: true, off: `is smaller than its target (${ratio.toFixed(2)}×)`, track };
    return { done: true, off: null, track };
  };
  for (const m of host.querySelectorAll('[data-ink]')) {
    if (visible(m) < 0.15) continue;
    const kind = m.getAttribute('data-ink');
    const forId = m.getAttribute('data-ink-for');
    // A drawn picture's ink look (nk.drawn: data-ink="ink" | "chalk") is not a mark.
    if (!forId && !m.closest('svg') && (kind === 'ink' || kind === 'chalk' || kind === 'dark')) continue;
    const target = forId ? host.querySelector(`[data-ink-target="${forId}"]`) : null;
    const spec = target?.getAttribute('data-mark-target');
    const label = `${kind} on ${forId ? (spec ? `${spec} (${describe(target)})` : describe(target)) : `nothing (${labelOf(m)})`}`;
    if (seenInk.has(label)) continue;
    seenInk.add(label);
    if (!target) { marks.push({ label, target: false, content: false }); continue; }
    const strokes = [...host.querySelectorAll(`[data-ink-for="${forId}"]`)].filter((x) => x.getAttribute('data-ink') === kind);
    const geo = geometry(kind, target, strokes);
    marks.push({ label, target: true, content: visible(target) >= 0.15 && hasContent(target.getBoundingClientRect()), geo, ...(geo.track ? { track: geo.track } : {}) });
    if (geo.miss) drift.push({ label: `"${label}" ${geo.miss}` });
    if (!m.closest('[data-bleed]')) noteInk(label, kind, strokes, geo.done);
  }
  // Marks of an inner state: drawn strokes with no target of their own.
  for (const svg of host.querySelectorAll('[data-expression]')) {
    const strokes = [...svg.querySelectorAll('path')];
    if (!strokes.some((p) => visible(p) >= 0.15)) continue;
    const person = svg.parentElement?.querySelector('[data-face][data-person]')?.getAttribute('data-person');
    const label = `${svg.getAttribute('data-expression')} marks${person ? ` around ${person}` : ''}`;
    noteInk(label, 'expression', strokes, strokes.every((p) => visible(p) >= 0.15));
  }
  // An orange stroke the frame drew by hand (not a kit mark, an expression mark or a setting) has no target.
  const ORANGE = new Set(['rgb(255, 94, 26)', 'rgb(232, 67, 26)']);
  let hand = 0;
  for (const svg of host.querySelectorAll('svg')) {
    if (svg.closest('[data-ink]') || svg.closest('[data-expression]') || svg.closest('[data-bleed]') || svg.closest('[data-setting]')) continue;
    const strokes = [...svg.querySelectorAll('path, line, polyline, ellipse, circle')].filter((g) => !g.closest('[data-ink]') && !g.closest('[data-expression]') && visible(g) >= 0.15 && ORANGE.has(getComputedStyle(g).stroke) && getComputedStyle(g).fill === 'none');
    if (strokes.length) { hand += 1; marks.push({ label: `hand-drawn orange stroke ${hand}`, target: false, content: false }); }
  }

  // Faces: the kit's measured face regions (anchor.js) on screen.
  const rectOf = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
  const LABELS = '[data-treatment="label"], [data-treatment="lower_third"], [data-label-kind]';
  const faces = [];
  for (const f of host.querySelectorAll('[data-face]')) {
    if (visible(f) < 0.15) continue;
    const r = f.getBoundingClientRect();
    const a = r.width * r.height;
    if (a < 100 || clip(r) / a < 0.5) continue;
    faces.push({ person: f.getAttribute('data-person') || '', asset: f.getAttribute('data-asset') || '', lifted: f.hasAttribute('data-lifted'), backdrop: Boolean(f.closest('[data-backdrop]')), anchor: f.parentElement, r: rectOf(r) });
  }
  const area = (r) => r.width * r.height;
  const named = (f) => f.person || 'a face';
  const overFace = [];
  const band = { left: hr.left + 96, top: hr.top + 292, right: hr.left + 940, bottom: hr.top + 542 };
  for (const f of faces) {
    for (const x of readable) {
      if (x.el.closest('[data-ink]') || x.el.closest(LABELS)) continue;
      const o = overlap(f.r, x.r);
      if (o >= 0.2 * area(f.r) || o >= 0.3 * area(x.r)) overFace.push({ label: `"${x.label}" covers ${named(f)}'s face` });
    }
    if (overlap(f.r, band) >= 0.3 * area(f.r)) overFace.push({ label: `the captions run over ${named(f)}'s face` });
    // A graphic (a stat's disc, bar or figure) covers a face as surely as words do.
    for (const g of host.querySelectorAll('[data-graphic]')) {
      if (visible(g) < 0.15) continue;
      const gr = g.getBoundingClientRect();
      if (gr.width * gr.height < 400) continue;
      const o = overlap(f.r, gr);
      if (o >= 0.2 * area(f.r) || o >= 0.3 * gr.width * gr.height) overFace.push({ label: `the ${g.getAttribute('data-graphic') || 'graphic'} covers ${named(f)}'s face` });
    }
  }
  // Labels over a face, over the people of a picture whose faces weren't measured, or over what the frame marks.
  const labelOnFace = [];
  for (const el of host.querySelectorAll(LABELS)) {
    if (visible(el) < 0.5) continue;
    const r = rectOf(el.getBoundingClientRect());
    if (area(r) < 400) continue;
    const name = (el.textContent || 'a label').trim().replace(/\s+/g, ' ').slice(0, 40);
    for (const f of faces) if (overlap(f.r, r) >= 0.08 * area(f.r)) labelOnFace.push({ label: `"${name}" covers ${named(f)}'s face` });
    for (const p of host.querySelectorAll('[data-people-unmeasured]')) {
      if (visible(p) < 0.15) continue;
      const q = p.getBoundingClientRect();
      if (q.width * q.height < 900) continue;
      const mid = { left: q.left + q.width * 0.12, right: q.right - q.width * 0.12, top: q.top + q.height * 0.12, bottom: q.bottom - q.height * 0.12 };
      if (overlap(mid, r) >= 0.25 * area(r)) labelOnFace.push({ label: `"${name}" covers the people in ${describe(p.previousElementSibling ?? p)}` });
    }
    for (const m of host.querySelectorAll('[data-ink]')) {
      if (visible(m) < 0.15) continue;
      const tg = host.querySelector(`[data-ink-target="${m.getAttribute('data-ink-for')}"]`);
      const tr = tg?.getBoundingClientRect();
      if (tr && tr.width * tr.height > 100 && overlap(tr, r) >= 0.25 * tr.width * tr.height) labelOnFace.push({ label: `"${name}" covers what the frame marks (${tg.getAttribute('data-mark-target') ?? describe(tg)})` });
    }
  }
  const norm = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const people = new Map();
  for (const f of faces) {
    if (!f.person || f.lifted) continue;
    const k = norm(f.person).split(' ').at(-1);
    const list = people.get(k) ?? [];
    list.push(f);
    people.set(k, list);
  }
  const dupes = [...people.values()].filter((list) => new Set(list.map((f) => f.anchor)).size > 1).map((list) => list[0].person);
  // The subject: the main face, or the middle of the faces about as big (two people meeting are centred together).
  const pool = faces.filter((f) => !f.backdrop && (!f.lifted || faces.every((g) => g.lifted)));
  const maxA = Math.max(0, ...pool.map((f) => area(f.r)));
  const big = pool.filter((f) => area(f.r) >= 0.5 * maxA);
  const subject = big.length && maxA >= subjectArea * W * H
    ? { x: big.reduce((n, f) => n + (f.r.left + f.r.right) / 2, 0) / big.length - hr.left, y: big.reduce((n, f) => n + (f.r.top + f.r.bottom) / 2, 0) / big.length - hr.top, label: big.map(named).join(' and ') }
    : null;

  // Made drawings showing their paper: an opaque, light border all round.
  const drawnSet = new Set(drawnFiles);
  const whiteBoxes = [];
  for (const img of host.querySelectorAll('img')) {
    const file = (img.getAttribute('src') || '').split('/').pop();
    if (!drawnSet.has(file) && !img.closest('[data-drawn]')) continue;
    if (visible(img) < 0.15 || !img.complete || !img.naturalWidth) continue;
    if (getComputedStyle(img).mixBlendMode === 'multiply') continue;
    try {
      canvas.width = 48; canvas.height = 48;
      ctx2d.clearRect(0, 0, 48, 48);
      ctx2d.drawImage(img, 0, 0, 48, 48);
      const d = ctx2d.getImageData(0, 0, 48, 48).data;
      let edge = 0, paper = 0;
      for (let i = 0; i < 48; i++) {
        for (const [x, y] of [[i, 0], [i, 47], [0, i], [47, i]]) {
          const k = (y * 48 + x) * 4;
          edge += 1;
          if (d[k + 3] > 200 && lum([d[k], d[k + 1], d[k + 2]]) > 0.6) paper += 1;
        }
      }
      if (paper / edge >= 0.75) whiteBoxes.push(labelOf(img));
    } catch {
      // unreadable pixels: not judged
    }
  }

  // Plates with none of their words showing (a wipe that shows the plate first, words hidden).
  const emptyBoxes = [];
  for (const p of host.querySelectorAll('[data-plate]')) {
    if (visible(p) < 0.15) continue;
    const r = p.getBoundingClientRect();
    if (r.width * r.height < 1500 || clip(r) / (r.width * r.height) < 0.5) continue;
    const hit = (x, y) => document.elementsFromPoint(x, y).some((e) => e === p || p.contains(e));
    const shows = [[r.left + 8, r.top + r.height / 2], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 8, r.top + r.height / 2]].some(([x, y]) => hit(x, y));
    if (!shows) continue;
    const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let any = false, words = false;
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!n.textContent.trim()) continue;
      words = true;
      const range = document.createRange();
      range.selectNodeContents(n);
      const tr = range.getBoundingClientRect();
      const el = n.parentElement;
      if (visible(el) < 0.15) continue;
      if (document.elementsFromPoint(tr.left + Math.min(12, tr.width / 2), tr.top + tr.height / 2).some((e) => e === el || el.contains(e))) { any = true; break; }
    }
    if (words && !any) emptyBoxes.push(labelOf(p));
  }

  // The main picture: the largest picture on screen that isn't faint, softened to a backdrop, or a ground.
  const NOT_MAIN = '[data-backdrop], [data-ground-layer], [data-burst], [data-setting], [data-set], [data-drawn]';
  let main = null;
  for (const img of host.querySelectorAll('img, canvas')) {
    if (img.closest(NOT_MAIN)) continue;
    const op = visible(img);
    if (op < 0.5) continue;
    if (img.tagName === 'IMG' && !(img.complete && img.naturalWidth)) continue;
    const f = getComputedStyle(img).filter || '';
    const blur = /blur\(([\d.]+)px\)/.exec(f);
    const dim = /brightness\(([\d.]+)\)/.exec(f);
    if ((blur && Number(blur[1]) >= 8) || (dim && Number(dim[1]) < 0.6)) continue;
    const r = img.getBoundingClientRect();
    const shown = clip(r);
    if (shown < 0.02 * screenArea || (main && shown <= main.shown)) continue;
    main = { el: img, shown, op, r };
  }
  const isCutout = (img) => {
    if (img.tagName !== 'IMG') return true; // a keyed drawing
    try {
      canvas.width = 16; canvas.height = 16;
      ctx2d.clearRect(0, 0, 16, 16);
      ctx2d.drawImage(img, 0, 0, 16, 16);
      const d = ctx2d.getImageData(0, 0, 16, 16).data;
      let clear = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 24) clear += 1;
      return clear > 12;
    } catch {
      return false;
    }
  };
  let mainOut = null;
  if (main) {
    const r = main.r;
    const area0 = Math.max(1, r.width * r.height);
    const rect = [r.left - hr.left, r.top - hr.top, r.right - hr.left, r.bottom - hr.top];
    // What the picture marks, if a mark on it shows.
    let focus = null;
    for (const k of host.querySelectorAll('[data-ink]')) {
      if (visible(k) < 0.15) continue;
      const tg = host.querySelector(`[data-ink-target="${k.getAttribute('data-ink-for')}"]`);
      const tr = tg?.getBoundingClientRect();
      if (!tr || !(tr.width > 2 && tr.height > 2) || overlap(tr, r) < 0.5 * tr.width * tr.height) continue;
      focus = { label: tg.getAttribute('data-mark-target') ?? describe(tg), rect: [tr.left - hr.left, tr.top - hr.top, tr.right - hr.left, tr.bottom - hr.top] };
      break;
    }
    mainOut = {
      label: labelOf(main.el), rect: rect.map(Math.round), opacity: Math.round(main.op * 100) / 100, inside: clip(r) / area0,
      underHook: !!main.el.ownerDocument.querySelector('[data-hook]'),
      bleed: !!main.el.closest('[data-bleed], [data-zoom]') || (r.width >= W * 0.95 && r.height >= H * 0.5) || (r.height >= H * 0.95 && r.width >= W * 0.5),
      cutout: isCutout(main.el),
      ...(focus ? { focus } : {}),
    };
  }

  // The ground: a frame-sized painted layer that no longer covers an edge. A frame with no such layer has no ground to run out.
  let edgeGap = null;
  const painted = [];
  for (const el of [host, ...host.querySelectorAll('*')]) {
    if (el !== host && el.closest('svg')) continue;
    const isPic = el.tagName === 'IMG' ? el.complete && el.naturalWidth > 0 : el.tagName === 'CANVAS';
    const cs = getComputedStyle(el);
    const bg = rgba(cs.backgroundColor);
    const solidColour = bg.length >= 3 && (bg[3] ?? 1) >= 0.5;
    const grad = /gradient/.test(cs.backgroundImage) && ![...cs.backgroundImage.matchAll(/rgba?\(([^)]+)\)/g)].some((c) => (c[1].split(',').map(Number)[3] ?? 1) < 0.5);
    if (!isPic && !solidColour && !grad) continue;
    if (visible(el) < 0.5) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const frameSized = (el.offsetWidth || r.width) >= W * 0.9 && (el.offsetHeight || r.height) >= H * 0.9;
    painted.push({ r, frameSized, el });
  }
  const grounds = painted.filter((p) => p.frameSized);
  if (grounds.length) {
    const POINTS = 7;
    const points = { left: [], right: [], top: [], bottom: [] };
    for (let i = 0; i < POINTS; i++) {
      const u = (i + 0.5) / POINTS;
      points.left.push([hr.left + 1, hr.top + u * H]);
      points.right.push([hr.left + W - 2, hr.top + u * H]);
      points.top.push([hr.left + u * W, hr.top + 1]);
      points.bottom.push([hr.left + u * W, hr.top + H - 2]);
    }
    const covered = ([x, y]) => painted.some(({ r }) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
    const open = Object.entries(points).filter(([, list]) => list.some((p) => !covered(p))).map(([k]) => k);
    const anyCovered = Object.values(points).some((list) => list.some(covered));
    if (open.length && open.length < 4 && anyCovered) {
      const g = grounds.reduce((a, b) => (b.r.width * b.r.height > a.r.width * a.r.height ? b : a));
      const px = Math.max(...open.map((k) => (k === 'left' ? g.r.left - hr.left : k === 'top' ? g.r.top - hr.top : k === 'right' ? hr.left + W - g.r.right : hr.top + H - g.r.bottom)));
      edgeGap = { label: `the ground (${labelOf(g.el)})`, edges: open, px: Math.max(1, Math.round(px)) };
    }
  }

  const cover = cell.reduce((a, b) => a + b, 0) / (G * G);
  void screenArea;
  return { cover, imgs, texts, blocks, marks, overFace, dupes, subject, whiteBoxes, emptyBoxes, labelOnFace, offscreen, inks, drift, main: mainOut, edgeGap };
}

/** What the composition checks need of a picture, measured (kit/stage-layout.js), keyed by file name. Pure. */
export function pictureRecords(media) {
  const out = {};
  for (const m of Object.values(media ?? {})) {
    if (!m?.file) continue;
    const p = preparePiece({ id: m.id, media: m });
    out[String(m.file).split('/').pop()] = {
      id: m.id, kind: p.kind, keep: p.crop ? p.crop : p.keep, vis: p.crop ?? p.vis, face: p.face, head: p.head,
      shape: p.kind === 'person' || p.kind === 'thing' ? m.regions?.shape ?? null : null,
      names: (m.people ?? []).filter(Boolean),
      logo: p.kind === 'logo' ? String(m.shows ?? '').split(/[,.(]/)[0].replace(/\s*(logo|wordmark)\b.*$/i, '').replace(/^(the|\d{4})\s+/i, '').trim().slice(0, 30) : null,
    };
  }
  return out;
}

/**
 * The composition checks, in the page (no closures: its data comes in `pictures`). Returns { keepCovered, labelOffOwner,
 * labelBeforeOwner, markOffHead, mixedStyle }, each a list of { label }.
 */
/**
 * Iteration 10's guarantees, measured on the render itself: a stage's heads on screen, sharpness, cut edges, plates, names,
 * credits and the usable area. Runs in the page; the stage leaves what it needs on its pieces. Quiet on what isn't a stage.
 */
export function measureStage({ W, H, limits, usable }) {
  const out = { headSize: [], overSharp: [], openEdge: [], plateOnHead: [], plateOff: [], labelOnBody: [], creditsStacked: [], voidFrame: [], onBoard: false };
  const host = document.getElementById('w');
  out.onBoard = Boolean(host.querySelector('.nk-wb'));
  if (!host.querySelector('[data-stage-pieces]')) return out;
  const hr = host.getBoundingClientRect();
  const k = hr.width / W;
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: (r.left - hr.left) / k, y: (r.top - hr.top) / k, w: r.width / k, h: r.height / k }; };
  const seen = (el) => {
    let op = 1;
    for (let e = el; e && e !== host; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
      op *= Number(cs.opacity);
    }
    return op;
  };
  const meet = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const pieces = [...host.querySelectorAll('[data-piece]')].filter((el) => seen(el) >= 0.5).map((el) => ({ el, id: el.dataset.piece, kind: el.dataset.kind, r: rectOf(el), z: Number(el.style.zIndex) || 0, head: el.dataset.head ? JSON.parse(el.dataset.head) : null, open: el.dataset.open ? JSON.parse(el.dataset.open) : null, maxw: Number(el.dataset.maxw) || null }));
  const ledgeEl = host.querySelector('[data-ledge]');
  const ledge = ledgeEl ? rectOf(ledgeEl).y : Infinity;
  const heads = [];
  for (const p of pieces) {
    if (p.head) {
      const b = { x: p.r.x + p.head.x * p.r.w, y: p.r.y + p.head.y * p.r.h, w: p.head.w * p.r.w, h: p.head.h * p.r.h };
      heads.push({ ...b, id: p.id, r: p.r });
      if (b.h > limits.headOnScreen + 2) out.headSize.push({ label: `${p.id}'s head is ${Math.round(b.h)}px on screen` });
    }
    // Its own width through the camera: a tilted picture's bounding box is wider than the picture.
    const shownW = p.el.offsetWidth ? p.el.offsetWidth * Number(p.el.closest('[data-zoom]')?.dataset.zoom ?? 1) : p.r.w;
    if (p.maxw && shownW > p.maxw * 1.03) out.overSharp.push({ label: `${p.id} shows ${Math.round(shownW)}px wide, sharp to ${p.maxw}` });
    if (p.open) {
      const shows = (u, v) => {
        const x = p.r.x + u * p.r.w, y = p.r.y + v * p.r.h;
        // The rect of a tilted piece runs a little wide: the margin keeps that from reading as a shown edge.
        if (x < 0 || x > W || y > H || y >= ledge - 30) return false;
        return !pieces.some((q) => q !== p && q.z > p.z && q.kind !== 'fill' && x >= q.r.x && x <= q.r.x + q.r.w && y >= q.r.y && y <= q.r.y + q.r.h);
      };
      let bad = 0;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        if (p.open.left && shows(0, p.open.left[0] + (p.open.left[1] - p.open.left[0]) * t)) bad += 1;
        if (p.open.right && shows(1, p.open.right[0] + (p.open.right[1] - p.open.right[0]) * t)) bad += 1;
        if (p.open.bottom && shows(p.open.bottom[0] + (p.open.bottom[1] - p.open.bottom[0]) * t, p.open.foot ?? 1)) bad += 1;
      }
      if (bad > 1) out.openEdge.push({ label: `${p.id}'s cut edge shows` });
    }
  }
  for (const el of host.querySelectorAll('[data-speech]')) {
    if (seen(el) < 0.5) continue;
    const r = rectOf(el);
    if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) out.plateOff.push({ label: 'a speech plate leaves the frame' });
    for (const hd of heads) if (meet(r, { ...hd, h: hd.h * 1.15 })) out.plateOnHead.push({ label: `a speech plate sits on ${hd.id}'s head` });
  }
  for (const el of host.querySelectorAll('[data-stage-labels] > .rd-words:not([data-hook])')) {
    if (seen(el) < 0.5) continue;
    const r = rectOf(el);
    if (r.y >= ledge) continue;
    for (const hd of heads) if (meet(r, { x: hd.x + hd.w * 0.12, y: hd.y + hd.h, w: hd.w * 0.76, h: hd.h * 1.5 })) out.labelOnBody.push({ label: `"${el.textContent.trim().slice(0, 28)}" sits on ${hd.id}'s chest` });
  }
  const credits = [...host.querySelectorAll('[data-credit]')].filter((el) => seen(el) >= 0.5);
  if (credits.length > 1) out.creditsStacked.push({ label: `${credits.length} credit lines at once` });
  // The usable area, sampled: what's on it, and how far it spans.
  if (!pieces.some((p) => p.kind === 'fill') && pieces.length) {
    const NX = 18, NY = 16;
    let hit = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const x = usable.x + (usable.w * (i + 0.5)) / NX, y = usable.y + (usable.h * (j + 0.5)) / NY;
        if (y >= ledge || pieces.some((p) => x >= p.r.x && x <= p.r.x + p.r.w && y >= p.r.y && y <= p.r.y + p.r.h)) { hit += 1; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
    }
    if (hit / (NX * NY) < limits.fillShare && Math.max((x1 - x0) / usable.w, (y1 - y0) / usable.h) < limits.fillSpan) out.voidFrame.push({ label: `the pieces cover ${Math.round((hit / (NX * NY)) * 100)}% of the usable area` });
  }
  return out;
}

export function measureKeeps({ W, H, pictures, keepCovered: LIMIT, ownerGap, ownerMargin }) {
  const host = document.getElementById('w');
  const hr = host.getBoundingClientRect();
  const k = hr.width / W;
  const seen = (el) => {
    let op = 1;
    for (let e = el; e && e !== host; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
      op *= Number(cs.opacity);
    }
    return op;
  };
  const cell = (g, u, v) => (g?.cells ? g.cells[Math.min(g.h - 1, Math.max(0, Math.floor(v * g.h))) * g.w + Math.min(g.w - 1, Math.max(0, Math.floor(u * g.w)))] === '1' : true);
  // A backdrop (a whole-frame picture, a ground) and pictures shown inside a lift or on a page are not pieces.
  const isPiece = (img, r) => !img.closest('[data-bleed], [data-lift], [data-treatment="cutout_lift"], .rd-lift') && getComputedStyle(img).objectFit !== 'cover' && !(r.width >= 972 * k && r.height >= 1400 * k);
  const all = [...host.querySelectorAll('img')].map((img) => {
    const rec = pictures[String(img.getAttribute('src') ?? '').split('/').pop()];
    if (!rec) return null;
    const r = img.getBoundingClientRect();
    return { img, rec, r, on: seen(img) >= 0.5 && r.width > 2, piece: isPiece(img, r) };
  }).filter(Boolean);
  const inFrame = (x) => {
    const a = Math.max(x.r.left, hr.left), b = Math.min(x.r.right, hr.right), c = Math.max(x.r.top, hr.top), d = Math.min(x.r.bottom, hr.bottom);
    return Math.max(0, b - a) * Math.max(0, d - c) / Math.max(1, x.r.width * x.r.height);
  };
  const pieces = all.filter((x) => x.on && x.piece && inFrame(x) > 0.25);
  const boxOf = (x, b) => ({ left: (x.r.left + b.x * x.r.width - hr.left) / k, top: (x.r.top + b.y * x.r.height - hr.top) / k, width: (b.w * x.r.width) / k, height: (b.h * x.r.height) / k });
  const opaqueAt = (x, X, Y) => {
    const u = (X - x.r.left) / x.r.width, v = (Y - x.r.top) / x.r.height;
    const vis = x.rec.vis;
    if (vis && (u < vis.x || u > vis.x + vis.w || v < vis.y || v > vis.y + vis.h)) return false;
    return cell(x.rec.shape, u, v);
  };
  const nameOf = (x) => x.rec.names[0] ?? x.rec.logo ?? x.rec.id;
  const byImg = new Map(all.map((x) => [x.img, x]));
  const out = { keepCovered: [], labelOffOwner: [], labelBeforeOwner: [], markOffHead: [], mixedStyle: [] };
  const LABELS = '[data-treatment="label"], [data-treatment="lower_third"], [data-treatment="number"], [data-tour-label]';
  for (const x of pieces) {
    if (x.rec.kind === 'print' && !x.rec.names.length && !x.rec.face) continue;
    const keep = x.rec.keep;
    if (!keep) continue;
    let hits = 0, n = 0;
    const by = new Map();
    for (let j = 0; j < 7; j++) {
      for (let i = 0; i < 7; i++) {
        const u = keep.x + (keep.w * (i + 0.5)) / 7, v = keep.y + (keep.h * (j + 0.5)) / 7;
        if (!cell(x.rec.shape, u, v)) continue;
        const X = x.r.left + u * x.r.width, Y = x.r.top + v * x.r.height;
        if (X < hr.left || X > hr.right || Y < hr.top || Y > hr.bottom) continue;
        n += 1;
        for (const el of document.elementsFromPoint(X, Y)) {
          // Its own holder or chip on top is still itself.
          if (el === x.img || el === host || el.contains?.(x.img)) break;
          const words = el.closest?.(LABELS);
          const other = byImg.get(el);
          const who = words ? `the label "${words.textContent.trim().slice(0, 40)}"` : other && other.piece && opaqueAt(other, X, Y) ? nameOf(other) : null;
          if (who && x.rec.kind !== 'card') {
            hits += 1;
            by.set(who, (by.get(who) ?? 0) + 1);
            break;
          }
        }
      }
    }
    // A small logo or thing is all keep: half the room a figure's body gets.
    if (n >= 4 && hits / n > (x.rec.kind === 'person' ? LIMIT : LIMIT / 2)) {
      const worst = [...by.entries()].sort((a, b) => b[1] - a[1])[0][0];
      out.keepCovered.push({ label: `${nameOf(x)} is covered by ${worst}` });
    }
  }
  // Labels and their owners.
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
  const surname = (s) => norm(s).split(/\s+/).pop();
  const ownerOf = (el) => {
    const f = el.getAttribute('data-for');
    if (f) {
      const holder = host.querySelector(`[data-piece="${f}"]`);
      const img = holder?.querySelector('img');
      return all.find((x) => x.img === img) ?? all.find((x) => x.rec.id === f) ?? null;
    }
    const line = el.querySelector?.('.rd-tag-t, .rd-l3-name, .rd-date-t');
    if (el.getAttribute('data-label-kind') === 'date') return null;
    const text = String((line ?? el).textContent ?? '').trim();
    const head = norm(text.split(',')[0]);
    if (!head || /['’]s\b/.test(text.split(',')[0])) return null;
    return all.find((x) => x.rec.names.some((n) => norm(n) === head || (head.split(' ').length === 1 && surname(n) === head))) ?? all.find((x) => x.rec.logo && norm(x.rec.logo) === head) ?? null;
  };
  const gap = (a, b) => Math.hypot(Math.max(0, Math.max(a.left, b.left) - Math.min(a.left + a.width, b.left + b.width)), Math.max(0, Math.max(a.top, b.top) - Math.min(a.top + a.height, b.top + b.height)));
  for (const el of host.querySelectorAll(LABELS)) {
    if (seen(el) < 0.5 || el.getAttribute('data-treatment') === 'number') continue;
    const owner = ownerOf(el);
    if (!owner) continue;
    const text = el.textContent.trim().slice(0, 40);
    if (!owner.on || inFrame(owner) < 0.5) {
      out.labelBeforeOwner.push({ label: `"${text}" is up before ${nameOf(owner)}` });
      continue;
    }
    const rr = el.getBoundingClientRect();
    const box = { left: (rr.left - hr.left) / k, top: (rr.top - hr.top) / k, width: rr.width / k, height: rr.height / k };
    // A framed print's name stands on its frame's edge, however far its face is from there.
    const framed = owner.img.closest('[data-framed]');
    const mine = Math.min(gap(box, boxOf(owner, owner.rec.keep)), framed ? gap(box, boxOf(owner, { x: 0, y: 0, w: 1, h: 1 })) : Infinity);
    const nearer = pieces.filter((x) => x !== owner && x.rec.keep && !x.rec.names.some((n) => owner.rec.names.includes(n))).find((x) => gap(box, boxOf(x, x.rec.keep)) + ownerMargin < mine);
    if (mine > ownerGap) out.labelOffOwner.push({ label: `"${text}" is far from ${nameOf(owner)}` });
    else if (nearer) out.labelOffOwner.push({ label: `"${text}" is nearer ${nameOf(nearer)} than ${nameOf(owner)}` });
  }
  // Marks of an inner state stay on their head.
  for (const svg of host.querySelectorAll('[data-expression]')) {
    const paths = [...svg.querySelectorAll('path')].filter((p) => p.style.opacity === '1');
    if (!paths.length || seen(svg) < 0.5) continue;
    const anchor = svg.parentElement;
    const face = anchor?.querySelector?.('[data-face]');
    if (!face) continue;
    const f = face.getBoundingClientRect();
    if (!(f.width > 1)) continue;
    const rs = paths.map((p) => p.getBoundingClientRect());
    const x0 = Math.min(...rs.map((r) => r.left)), y0 = Math.min(...rs.map((r) => r.top)), x1 = Math.max(...rs.map((r) => r.right)), y1 = Math.max(...rs.map((r) => r.bottom));
    const head = { x: f.left - f.width * 0.12, y: f.top - f.height * 0.45, w: f.width * 1.24, h: f.height * 1.45 };
    const gapX = Math.max(0, head.x - x1, x0 - (head.x + head.w)), gapY = Math.max(0, head.y - y1, y0 - (head.y + head.h));
    if (y1 > head.y + head.h * 0.72 || gapX > head.w * 0.6 || gapY > head.h * 0.6) out.markOffHead.push({ label: `${svg.getAttribute('data-expression')} marks` });
  }
  // A cutout beside a bare rectangle of a person.
  const cutPerson = pieces.find((x) => x.rec.kind === 'person');
  const barePerson = pieces.find((x) => x.rec.kind === 'print' && x.rec.names.length && !x.img.closest('[data-framed], .nk-polaroid, .nk-cutout-print'));
  if (cutPerson && barePerson) out.mixedStyle.push({ label: `${nameOf(barePerson)} is an uncut photo beside the cutout of ${nameOf(cutPerson)}` });
  return out;
}

/** The skin's caption tones (measure.mjs TONES), or [] when none were sampled. */
export function captionTones(root) {
  try {
    const html = readFileSync(join(root, '.hyperframes', 'caption-skin.html'), 'utf8');
    const m = /var TONES = (\[[\s\S]*?\]);/.exec(html);
    return m ? JSON.parse(m[1]) : [];
  } catch {
    return [];
  }
}

/** The captions' tone at reel time t: the sampled tones, else the treatment's (ink on the whiteboard). */
export function toneAt(tones, t, light = false) {
  const hit = tones.find(([a, b]) => t >= a && t < b);
  return hit ? hit[2] : light ? 'light' : 'dark';
}

export async function checkScreen(root, only = null) {
  const b = await open(root).catch((e) => ({ skipped: `the check could not run: ${e?.message ?? e}` }));
  if (!b?.page) return { ok: true, errors: [], checked: 0, skipped: b?.skipped ?? 'no browser' };
  const errors = [];
  let checked = 0;
  const strokes = objectStrokes(root);
  const media = projectMedia(root);
  const pictures = pictureRecords(media);
  const drawnFiles = Object.values(media).filter((m) => ['sketch', 'drawing', 'expression'].includes(m.made_kind)).map((m) => String(m.file ?? '').split('/').pop());
  const all = projectFrames(root);
  const starts = new Map();
  let at = 0;
  for (const f of all) { starts.set(f.id, at); at += f.duration > 0 ? f.duration : 0; }
  const tones = captionTones(root);
  try {
    for (const f of all.filter((x) => (!only || x.id === only) && !isClose(x))) {
      if (!f.id || !existsSync(join(root, 'assets', 'frames', `${f.id}.js`)) || !(f.duration > 0)) continue;
      const timingFile = join(root, 'assets', 'timing', `${f.id}.json`);
      const timing = existsSync(timingFile) ? JSON.parse(readFileSync(timingFile, 'utf8')) : { words: [] };
      try {
        await b.page.evaluate((args) => window.__load(args.id, args.ctx), { id: f.id, ctx: { id: f.id, duration: f.duration, treatment: frameTreatment(f), timing, media, objects: strokes } });
      } catch (e) {
        const msg = String(e?.message ?? e);
        // Marks skip themselves (marks.js skipMark); expression marks may still throw.
        if (/\[mark_on_nothing\]/.test(msg)) errors.push(`[mark_on_nothing] ${f.id}: ${msg.replace(/^.*\[mark_on_nothing\]\s*/, '')}`);
        else errors.push(`[empty_frame] ${f.id}: failed to build: ${msg}`);
        continue;
      }
      const recuts = await b.page.evaluate(() => [...document.querySelectorAll('#w [data-move="cuts"]')].flatMap((n) => n.__recuts?.() ?? []));
      errors.push(...recuts.map((where) => `[same_image_recut] ${f.id}: ${where} re-enters the picture of the shot before at about the same size: move across it with nk.tour, or make the later shot a true close-up of one detail (1.6x or more)`));
      const moments = [];
      const inked = new Set();
      const keepArgs = { W, H, pictures, keepCovered: KEEP_COVERED, ownerGap: OWNER_GAP, ownerMargin: OWNER_MARGIN };
      const args = { W, H, BLANK: BLANK_SPREAD, drawnFiles, subjectArea: SUBJECT_AREA, markArea: MARK_AREA, markOffset: MARK_OFFSET, slack: OFFSCREEN_SLACK };
      const stageArgs = { W, H, limits: { headOnScreen: LIMITS.headOnScreen, fillShare: LIMITS.fillShare, fillSpan: LIMITS.fillSpan }, usable: { x: 30, y: 600, w: W - 60, h: 900 } };
      let opening = null;
      if (isFirstFrame(f.id)) {
        await b.page.evaluate((x) => window.__render(x), OPENING_AT);
        opening = await b.page.evaluate(measureScreen, args);
      }
      for (let i = 0; i * STEP < f.duration; i++) {
        const t = Math.min(i * STEP, f.duration - 1 / 30);
        await b.page.evaluate((x) => window.__render(x), t);
        const m = { t, ...(await b.page.evaluate(measureScreen, args)), ...(await b.page.evaluate(measureKeeps, keepArgs)), ...(await b.page.evaluate(measureStage, stageArgs)) };
        // Ink against the real pixels behind it: once per mark, when it is first drawn.
        m.unseen = [];
        for (const k of m.inks ?? []) {
          if (inked.has(k.label)) continue;
          inked.add(k.label);
          const behind = await behindInk(b.page, k.rect).catch(() => null);
          if (inkUnseen(k.colour, behind)) m.unseen.push({ label: `"${k.label}" is lost on what is behind it (${k.colour} on rgb(${behind.rgb.map(Math.round).join(', ')}))` });
        }
        const tone = toneAt(tones, (starts.get(f.id) ?? 0) + t, LIGHT_TREATMENTS.has(frameTreatment(f)));
        const band = await sampleBand(b.page, t).catch(() => null);
        m.caption = { tone, contrast: band ? Math.round(captionContrast(tone, band) * 10) / 10 : null };
        moments.push(m);
        checked += 1;
      }
      // Read after playing: marks of an inner state find they have no room as they start to draw.
      const skipped = await b.page.evaluate(() => document.__markSkips ?? []);
      errors.push(...skipped.map((why) => `[mark_on_nothing] ${f.id}: ${why}`));
      const tight = await b.page.evaluate(() => document.__stageReports ?? []);
      errors.push(...[...new Set(tight)].map((why) => `[stage_tight] ${f.id}: ${why.replace(/^stage_tight:\s*/, '')}`));
      if (opening) {
        const later = moments.reduce((a, m) => (Math.abs(m.t - OPENING_SETTLED_AT) < Math.abs(a.t - OPENING_SETTLED_AT) ? m : a), moments[0]);
        errors.push(...openingProblems(opening, later).map((e) => e.replace(/^\[(\w+)\] /, `[$1] ${f.id}: `)));
      }
      errors.push(...screenProblems(moments, { duration: f.duration }).map((e) => e.replace(/^\[(\w+)\] /, `[$1] ${f.id}: `)));
    }
  } finally {
    await b.close();
  }
  return { ok: errors.length === 0, errors, checked };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
  checkScreen(process.cwd(), only)
    .catch((e) => ({ ok: true, errors: [], checked: 0, skipped: `the check could not run: ${e instanceof Error ? e.message : String(e)}` }))
    .then((result) => {
      console.log(JSON.stringify(result, null, 1));
      process.exit(result.ok ? 0 : 1);
    });
}
