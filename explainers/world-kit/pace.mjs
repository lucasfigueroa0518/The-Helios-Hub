// The pacing engine (Explainers 3.1, EX3-60; tight pauses in 3.2, EX3-79; real silence only in
// 3.3, EX3-89). Deterministic, no model.
//
// Run right after `audio.mjs sync-durations`. Two passes:
//   1. Tighten each voice line, cutting ONLY silence measured in the waveform (ffmpeg's silence
//      detector at SILENCE_DB, -40 dB): the TTS word timestamps are coarse and run ~0.1s off, and cutting
//      by them clipped word onsets ("returns" → "turns", 3.2). A silence longer than its cap is
//      cut down to it (SENTENCE_GAP after a word that ends a sentence, INNER_GAP otherwise), the
//      kept part split evenly on both sides so every word keeps its natural start and decay; the
//      silence after the line's last sound is cut to TAIL. The WAV is cut with 5 ms fades, then
//      scanned again: its speech runs must match the original's one for one, or that line keeps
//      its untightened voice (a `fallback`). Word times shift with the cuts and snap to the real
//      onset (or end) where a timestamp fell inside a silence. The original WAV and words are
//      kept (assets/voice/orig/, `words_orig`), so a re-run starts from them.
//      The opener (frame 1, EX3-99) also loses its lead-in silence, so the first word lands on
//      frame 0, and is sped up OPENER_TEMPO× with its pitch kept.
//   2. Each frame's `duration` becomes its tightened voice plus its hold (TAIL + hold = 0.2s of
//      silence between lines, Lucas's maximum), and its `voice_end` is written beside it. The
//      close (frame 8, EX3-95) has no voice: it is CLOSE_DURATION. assets/timing/<frame id>.json
//      gets the frame's word times, so titles, the definition fill-in, labels and sound events
//      land on exact words.
// Idempotent: it always computes from the original voice, never from what is already there.
//
//   node assets/kit/pace.mjs
//
// Prints JSON { ok, errors[], total, frames[], tightened } and exits 1 on any error.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CLOSE } from './close-timing.js';
import { CLOSE_FRAME, isClose, isHandoff, parseFrames, seconds, writeClose, writeHandoff, writeOpener } from './frames.mjs';
import { openerByKey } from './openers/bank.js';
import { ensureOpener } from './openers/sound.mjs';

export { CLOSE_FRAME, isClose };

/** Longest silence kept between two words inside a line (EX3-79; Lucas found 0.12s a little
 *  rushed, 2026-10-13). A sentence end keeps up to SENTENCE_GAP, his 0.2s maximum. */
export const INNER_GAP = 0.15;
export const SENTENCE_GAP = 0.2;
/** Silence kept after a line's last sound, inside its WAV. */
export const TAIL = 0.05;
/** The pause after each line: with TAIL, 0.2s of silence between lines (EX3-79). */
export const HOLD = 0.15;
/** A legacy voiced end card stays on screen this long after its line. */
export const END_HOLD = 1.0;
/** The close: the last frame, voiceless, a fixed length (EX3-95). */
export const CLOSE_DURATION = CLOSE.duration;
/** What counts as silence (EX3-89): quieter than SILENCE_DB for at least SILENCE_MIN seconds,
 *  what a listener hears as a pause (a breath under it is part of the pause). Every cut keeps
 *  half its cap (75–100 ms) of that quiet beside each word, so soft onsets and decays stay. */
export const SILENCE_DB = -40;
export const SILENCE_MIN = 0.05;
/** The opener (EX3-99, Lucas: "start RIGHT at the first frame… a little faster"; he picked 20%
 *  faster, read as written): its lead-in silence is cut to OPENER_LEAD so the first word lands on
 *  frame 0, and the line is sped up OPENER_TEMPO× with its pitch kept (ffmpeg atempo; the HeyGen
 *  voice ignores its speed setting). */
export const OPENER_FRAME = 1;
export const OPENER_TEMPO = 1.2;
export const OPENER_LEAD = 0.02;
/** A timestamp this close inside a silence snaps to its edge. */
const SNAP = 0.25;
/** Sound shorter than this between two silences is a click, not speech. */
const BLIP = 0.02;

const r3 = (n) => Math.round(n * 1000) / 1000;
const ENDS_SENTENCE = /[.!?]["')\]]*$/;

/** The pause after frame `number`'s voice: at most HOLD (a legacy voiced close keeps END_HOLD). */
export function holdFor(number, planned) {
  if (number === CLOSE_FRAME) return END_HOLD;
  const hold = Number.isFinite(planned) && planned >= 0 ? Math.min(planned, HOLD) : HOLD;
  return r3(hold);
}

/** Silences from ffmpeg silencedetect's log: [[start, end]] in order, the last one closed at
 *  `duration` when the file ends silent. Two silences split by a blip shorter than BLIP (a
 *  click, not speech) are one. */
export function parseSilences(log, duration) {
  const out = [];
  let open = null;
  for (const line of String(log).split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) open = Math.max(0, Number(s[1]));
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && open != null) {
      out.push([r3(open), r3(Math.min(Number(e[1]), duration))]);
      open = null;
    }
  }
  if (open != null && open < duration) out.push([r3(open), r3(duration)]);
  const merged = [];
  for (const [a, b] of out) {
    const last = merged[merged.length - 1];
    if (last && a - last[1] < BLIP) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/** The silences in a WAV, measured. */
export function detectSilences(file, duration) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_MIN}`, '-f', 'null', '-'], { encoding: 'utf8' });
  return parseSilences(r.stderr, duration);
}

/** The stretches of sound between the silences: [[start, end]]. */
export function speechRuns(silences, duration) {
  const runs = [];
  let at = 0;
  for (const [s, e] of silences) {
    if (s - at >= BLIP) runs.push([r3(at), r3(s)]);
    at = Math.max(at, e);
  }
  if (duration - at >= BLIP) runs.push([r3(at), r3(duration)]);
  return runs;
}

/** Whether the word boundary nearest the middle of silence [s, e] ends a sentence. With no
 *  boundary to read, it is treated as one (the longer cap). */
function endsSentenceAt(words, s, e) {
  if (words.length < 2) return true;
  const mid = (s + e) / 2;
  let best = 0;
  let gap = Infinity;
  for (let i = 0; i < words.length - 1; i++) {
    const d = Math.abs((words[i].end + words[i + 1].start) / 2 - mid);
    if (d < gap) {
      gap = d;
      best = i;
    }
  }
  return ENDS_SENTENCE.test(String(words[best].text ?? '').trim());
}

/**
 * The cuts that tighten one line: [from, to) spans to remove, in the WAV's seconds, every one
 * inside a measured silence (`silences`, from detectSilences). The words only say which cap a
 * silence gets (a sentence end or not); they never place a cut.
 */
export function silenceCuts(words, duration, silences = [], { lead = null } = {}) {
  const ws = (words ?? []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)).sort((a, b) => a.start - b.start);
  const cuts = [];
  for (const [s, e] of silences) {
    if (s <= 0.001) {
      // The lead-in stays as recorded, except where `lead` trims it (the opener, EX3-99).
      if (lead != null && e - lead > 0.005 && e < duration - 0.001) cuts.push([0, r3(e - lead)]);
      continue;
    }
    if (e >= duration - 0.001) {
      if (e - s > TAIL + 0.005) cuts.push([r3(s + TAIL), r3(duration)]);
      continue;
    }
    const cap = endsSentenceAt(ws, s, e) ? SENTENCE_GAP : INNER_GAP;
    if (e - s > cap + 0.005) cuts.push([r3(s + cap / 2), r3(e - cap / 2)]);
  }
  return cuts;
}

/** A time in the original voice, on the tightened voice's clock. */
function shifted(x, cuts) {
  let out = x;
  for (const [from, to] of cuts) {
    if (to <= x + 1e-6) out -= to - from;
    else if (from < x) out -= x - from;
  }
  return out;
}

/**
 * Word times after the cuts. A start that fell inside a silence snaps to the silence's end (the
 * real onset) and an end inside one to its start, when within SNAP; then both move earlier by the
 * silence cut before them.
 */
export function shiftWords(words, cuts, silences = []) {
  return (words ?? []).map((w) => {
    let { start, end } = w;
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const inStart = silences.find(([s, e]) => start > s && start < e && e - start <= SNAP);
      if (inStart) start = inStart[1];
      const inEnd = silences.find(([s, e]) => end > s && end < e && end - s <= SNAP);
      if (inEnd) end = inEnd[0];
      if (end < start) end = start;
    }
    return { ...w, start: r3(shifted(start, cuts)), end: r3(shifted(end, cuts)) };
  });
}

/** The ffmpeg filter that keeps everything but the cuts, with 5 ms fades at each seam. */
export function keepFilter(cuts, duration) {
  const keep = [];
  let at = 0;
  for (const [from, to] of cuts) {
    if (from > at) keep.push([at, from]);
    at = to;
  }
  if (duration > at + 0.001) keep.push([at, duration]);
  const chains = keep.map(([a, b], i) => {
    const len = b - a;
    const f = Math.min(0.005, len / 4);
    return `[0:a]atrim=start=${a.toFixed(4)}:end=${b.toFixed(4)},asetpts=PTS-STARTPTS,afade=t=in:d=${f.toFixed(4)},afade=t=out:st=${(len - f).toFixed(4)}:d=${f.toFixed(4)}[k${i}]`;
  });
  return { filter: `${chains.join(';')};${keep.map((_, i) => `[k${i}]`).join('')}concat=n=${keep.length}:v=0:a=1[out]`, kept: r3(keep.reduce((n, [a, b]) => n + (b - a), 0)) };
}

/**
 * Why a tightened voice lost sound, or null when it kept it all: its speech runs must match the
 * original's one for one, each the same length (the seams' fades aside; the last may gain up to
 * TAIL where the kept tail is too short to measure as silence).
 */
export function lostSound(before, after) {
  if (before.length !== after.length) return `${before.length} stretches of speech became ${after.length}`;
  for (let i = 0; i < before.length; i++) {
    const a = before[i][1] - before[i][0];
    const b = after[i][1] - after[i][0];
    // The ends may gain a kept tail or lead-in too short to measure as silence.
    const slack = i === before.length - 1 || i === 0 ? TAIL + 0.02 : 0.02;
    if (Math.abs(a - b) > slack) return `speech ${i + 1} ran ${a.toFixed(3)}s and now ${b.toFixed(3)}s`;
  }
  return null;
}

function probeDuration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = Number(String(r.stdout).trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * Put `lead` seconds of silence before a voice file (the opener's wait before its line, EX3-102),
 * shifting its words; records it as `lead_s`. A voice already led is left alone.
 */
export function leadVoice(root, v, lead) {
  if (!(lead > 0) || Number(v.lead_s) > 0) return null;
  const wav = join(root, v.path);
  const tmp = `${wav}.lead.wav`;
  const ms = Math.round(lead * 1000);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-af', `adelay=${ms}:all=1`, tmp], { encoding: 'utf8' });
  if (r.status !== 0) return `frame ${v.frame}: the opener's lead failed: ${String(r.stderr).trim().slice(0, 200)}`;
  renameSync(tmp, wav);
  Object.assign(v, {
    lead_s: r3(lead),
    duration_s: r3(v.duration_s + lead),
    words: (v.words ?? []).map((w) => ({ ...w, start: r3(w.start + lead), end: r3(w.end + lead) })),
  });
  return null;
}

/** Tighten every voice in audio_meta.json in place; returns the per-frame seconds removed. */
export function tightenVoices(root, meta, { detect = detectSilences, lead = 0 } = {}) {
  const removed = [];
  const errors = [];
  for (const v of meta.voices ?? []) {
    if (!v.path || !Array.isArray(v.words) || !v.words.length) continue;
    const wav = join(root, v.path);
    const orig = join(root, dirname(v.path), 'orig', v.path.split('/').pop());
    if (!existsSync(orig)) {
      if (!existsSync(wav)) {
        errors.push(`frame ${v.frame}: ${v.path} is missing`);
        continue;
      }
      mkdirSync(dirname(orig), { recursive: true });
      copyFileSync(wav, orig);
    }
    const words = v.words_orig ?? v.words;
    const duration = v.duration_orig ?? probeDuration(orig) ?? v.duration_s;
    const silences = detect(orig, duration);
    const opener = Number(v.frame) === OPENER_FRAME;
    const cuts = silenceCuts(words, duration, silences, { lead: opener ? OPENER_LEAD : null });
    const untightened = (fallback) => {
      copyFileSync(orig, wav);
      Object.assign(v, { words_orig: words, duration_orig: r3(duration), words: shiftWords(words, [], silences), duration_s: r3(duration), lead_s: 0 });
      removed.push({ frame: v.frame, removed: 0, cuts: 0, ...(fallback ? { fallback } : {}) });
    };
    if (!cuts.length && !opener) {
      untightened(null);
      continue;
    }
    const { filter, kept } = keepFilter(cuts, duration);
    const tmp = `${wav}.tight.wav`;
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', orig, '-filter_complex', filter, '-map', '[out]', tmp], { encoding: 'utf8' });
    if (r.status !== 0) {
      errors.push(`frame ${v.frame}: ffmpeg failed: ${String(r.stderr).trim().slice(0, 300)}`);
      continue;
    }
    const after = probeDuration(tmp) ?? kept;
    const lost = lostSound(speechRuns(silences, duration), speechRuns(detect(tmp, after), after));
    if (lost) {
      untightened(`kept untightened: ${lost}`);
      continue;
    }
    let tightWords = shiftWords(words, cuts, silences);
    let final = after;
    if (opener && OPENER_TEMPO !== 1) {
      // Faster, pitch kept (EX3-99); the word times scale with it.
      const fast = `${wav}.fast.wav`;
      const t = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-af', `atempo=${OPENER_TEMPO}`, fast], { encoding: 'utf8' });
      if (t.status === 0) {
        renameSync(fast, tmp);
        final = probeDuration(tmp) ?? after / OPENER_TEMPO;
        tightWords = tightWords.map((w) => ({ ...w, start: r3(w.start / OPENER_TEMPO), end: r3(w.end / OPENER_TEMPO) }));
      } else errors.push(`frame ${v.frame}: the opener speed-up failed: ${String(t.stderr).trim().slice(0, 200)}`);
    }
    renameSync(tmp, wav);
    Object.assign(v, { words_orig: words, duration_orig: r3(duration), words: tightWords, duration_s: r3(final), lead_s: 0 });
    removed.push({ frame: v.frame, removed: r3(duration - v.duration_s), cuts: cuts.length, ...(opener ? { tempo: OPENER_TEMPO } : {}) });
  }
  // The opener waits `lead` before its line (EX3-102): silence in front of frame 1's voice, so
  // frame 1's length and every later frame's start take it in.
  for (const v of meta.voices ?? []) {
    if (Number(v.frame) !== OPENER_FRAME || !v.path || !existsSync(join(root, v.path))) continue;
    const err = leadVoice(root, v, lead);
    if (err) errors.push(err);
  }
  return { removed, errors };
}

/**
 * The storyboard with each voiced frame's `duration` = voice + hold and its `voice_end` set.
 * `voices`: audio_meta.json's voices ({ frame, duration_s }). The close (frame 8 with no
 * voiceover, EX3-95) becomes CLOSE_DURATION: all of it is hold.
 */
export function pacedStoryboard(storyboard, voices) {
  const voiceByFrame = new Map((voices ?? []).filter((v) => v.frame != null && v.duration_s > 0).map((v) => [Number(v.frame), v.duration_s]));
  const lines = String(storyboard).split(/\r?\n/);
  const out = [];
  const paced = [];
  let frame = null;
  let pendingVoiceEnd = null;
  const flush = () => {
    if (pendingVoiceEnd) out.push(pendingVoiceEnd);
    pendingVoiceEnd = null;
  };
  const frames = new Map(parseFrames(storyboard).map((f) => [f.number, f]));
  for (const line of lines) {
    const heading = /^##\s+Frame\s+(\d+)/i.exec(line);
    if (heading || /^##\s+/.test(line)) {
      flush();
      frame = heading ? Number(heading[1]) : null;
    }
    if (frame != null && voiceByFrame.has(frame)) {
      if (/^\s*-\s+voice_end\s*:/i.test(line)) continue; // rewritten below
      const m = /^(\s*-\s+duration\s*:\s*).*/i.exec(line);
      if (m) {
        const voice = voiceByFrame.get(frame);
        const hold = holdFor(frame, seconds(frames.get(frame)?.fields.hold));
        const duration = r3(voice + hold);
        out.push(`${m[1]}${duration}s`);
        pendingVoiceEnd = `- voice_end: ${r3(voice)}s`;
        paced.push({ frame, voice: r3(voice), hold, duration });
        flush();
        continue;
      }
    } else if (frame != null && isClose(frames.get(frame))) {
      if (/^\s*-\s+voice_end\s*:/i.test(line)) continue;
      const m = /^(\s*-\s+duration\s*:\s*).*/i.exec(line);
      if (m) {
        out.push(`${m[1]}${CLOSE_DURATION}s`);
        paced.push({ frame, voice: 0, hold: CLOSE_DURATION, duration: CLOSE_DURATION });
        continue;
      }
    }
    out.push(line);
  }
  flush();
  return { storyboard: out.join('\n'), paced };
}

/** Pace the project at `root`: tighten the voices, rewrite STORYBOARD.md, write assets/timing/*.json. */
export function pace(root, { tighten = true } = {}) {
  const errors = [];
  const sbFile = join(root, 'STORYBOARD.md');
  const metaFile = join(root, 'audio_meta.json');
  if (!existsSync(sbFile)) return { ok: false, errors: ['STORYBOARD.md is missing'], total: 0, frames: [], tightened: [] };
  if (!existsSync(metaFile)) return { ok: false, errors: ['audio_meta.json is missing (run audio.mjs first)'], total: 0, frames: [], tightened: [] };
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  let tightened = [];
  if (tighten) {
    const key = ensureOpener(root);
    const t = tightenVoices(root, meta, { lead: key ? openerByKey(key).voiceAt : 0 });
    tightened = t.removed;
    errors.push(...t.errors);
    writeFileSync(metaFile, `${JSON.stringify(meta, null, 1)}\n`);
  }
  const { storyboard, paced } = pacedStoryboard(readFileSync(sbFile, 'utf8'), meta.voices);
  writeFileSync(sbFile, storyboard);

  const frames = parseFrames(storyboard);
  for (const f of frames) if (!paced.some((p) => p.frame === f.number)) errors.push(`frame ${f.number} has no voice in audio_meta.json`);
  // The close is code's, not a worker's (EX3-95): its module and sounds exist from here on.
  for (const f of frames) if (isClose(f) && f.id) writeClose(root, f);
  // So is frame 1 when the job chose an opener (EX3-102): the bank's opener over the hook.
  for (const f of frames) if (f.number === OPENER_FRAME && f.id) writeOpener(root, f);
  mkdirSync(join(root, 'assets', 'timing'), { recursive: true });
  for (const f of frames) {
    const voice = (meta.voices ?? []).find((v) => Number(v.frame) === f.number);
    const p = paced.find((x) => x.frame === f.number);
    const words = (voice?.words ?? [])
      .filter((w) => String(w.text ?? '').trim() && Number.isFinite(w.start) && Number.isFinite(w.end))
      .map((w) => ({ text: String(w.text).trim(), start: r3(w.start), end: r3(w.end) }));
    const timing = { frame: f.number, id: f.id, duration: f.duration, voice_end: p?.voice ?? null, hold: p?.hold ?? null, words };
    if (f.id) writeFileSync(join(root, 'assets', 'timing', `${f.id}.json`), `${JSON.stringify(timing, null, 1)}\n`);
  }
  const total = r3(frames.reduce((n, f) => n + (f.duration > 0 ? f.duration : 0), 0));
  // Frame 3 is code's hand-off when the job chose one (4.3): written with its paced length.
  for (const f of frames) if (isHandoff(root, f)) writeHandoff(root, f);
  return { ok: errors.length === 0, errors, total, frames: paced, tightened };
}

/**
 * Rewrite only frame 3's hand-off module (4.3 fix), once the frames are built: its backdrop is
 * frame 4's first shot, which exists only after frame 4's builder wrote it. `node assets/kit/pace.mjs handoff`.
 */
export function rewriteHandoff(root) {
  const file = join(root, 'STORYBOARD.md');
  const frames = existsSync(file) ? parseFrames(readFileSync(file, 'utf8')) : [];
  const done = [];
  for (const f of frames) if (isHandoff(root, f) && writeHandoff(root, f) !== null) done.push(f.id);
  return { ok: true, errors: [], handoff: done };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = process.argv[2] === 'handoff' ? rewriteHandoff(process.cwd()) : pace(process.cwd());
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.ok ? 0 : 1);
}
