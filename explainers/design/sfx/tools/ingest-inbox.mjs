// Drop-in sound folders → the central Helios sound library (explainers/design/sfx, read by every
// content type through library.mjs). Offline: ffmpeg and arithmetic, no model.
//
//   node explainers/design/sfx/tools/ingest-inbox.mjs              ingest everything new in inbox/
//   node explainers/design/sfx/tools/ingest-inbox.mjs --dry-run    measure and report, write nothing
//   node explainers/design/sfx/tools/ingest-inbox.mjs ~/Downloads/*.zip   zips (or folders) anywhere,
//                                                                   read in place, never unpacked into the repo
//     --store <dir>   keep the converted MP3s outside the repo (dropins/ becomes a link to <dir>)
//     --limit <n>     an even sample of n files per zip or folder (a trial run; zips stay un-cached)
//     --jobs <n>      worker count (default: every core)
//   node explainers/design/sfx/tools/ingest-inbox.mjs --library    (re)measure the whole bank into
//                                                                   acoustics.json
//
// Built for thousands of files: one directory walk; .zip files in the inbox are unpacked beside
// themselves first; a content-hash cache (.ingest-cache.json) makes a re-run skip every file it has
// seen, added or rejected, without decoding it (a byte-identical copy is a duplicate before any
// ffmpeg run); a worker thread per CPU core runs ffmpeg concurrently; each file is decoded once,
// measured from that PCM, and the same PCM is piped to the MP3 encoder; progress with an ETA every 50 files; the catalog and the cache are
// written every few seconds, so a crash keeps the finished work; one bad file is rejected with a
// reason and never stops the run.
//
// Every audio file under inbox/<any folders>/ is decoded, measured (measure.mjs: length, peak and
// RMS level, onset, attack, decay, brightness, body), rejected when it is broken, silent, too
// quiet, too short or too long, deduplicated against itself and the catalogs, trimmed of leading
// silence, peak-normalized to -1 dBFS and written as 48 kHz stereo MP3 to dropins/<folder>/. Its
// name, tags and kind come from the folder and file names; its acoustic tags (short, long,
// sustain, sharp, soft-attack, bright, dark) and a plain description from the measurements. The
// entries go to catalog-inbox.json, which library.mjs loads beside catalog.json for every format;
// catalog.json itself is never changed. Originals stay in inbox/.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, Worker } from 'node:worker_threads';

import { KIND_TAGS } from '../library.mjs';

export const SFX = join(dirname(fileURLToPath(import.meta.url)), '..');
export const INBOX = 'inbox';
export const OUT_DIR = 'dropins';
export const INBOX_CATALOG = 'catalog-inbox.json';
export const ACOUSTICS = 'acoustics.json';
export const CACHE = '.ingest-cache.json';
export const AUDIO = new Set(['.wav', '.mp3', '.ogg', '.flac', '.aif', '.aiff', '.m4a', '.aac', '.opus', '.wma', '.caf']);

/** Limits a drop-in must meet. */
export const LIMITS = { minDur: 0.04, maxDur: 60, minPeakDb: -50, minMeanDb: -70, targetPeakDb: -1, maxGainDb: 30 };

/** Words in names that never describe a sound. */
const JUNK = new Set(['sfx', 'fx', 'sound', 'sounds', 'audio', 'wav', 'mp3', 'ogg', 'flac', 'final', 'copy', 'mix', 'stereo', 'mono', 'master', 'edit', 'new', 'old', 'take', 'version', 'ver', 'pack', 'free', 'the', 'a', 'an', 'of', 'and', 'with', 'for', 'in', 'on', 'to', 'by', 'at', 'from', 'k', 'khz', 'bit', 'hz', 'db', 'ms', 'sec', 'x', 'v']);

/** Name words → the event kind a sound serves (first match wins, in this order). */
export const KIND_WORDS = [
  ['whoosh', ['whoosh', 'woosh', 'swoosh', 'swish', 'swoop', 'swipe', 'whip', 'pass', 'passby', 'flyby', 'fly', 'swing', 'air', 'transition']],
  ['sting', ['sting', 'stinger', 'jingle', 'chime', 'ding', 'bell', 'success', 'win', 'reward', 'notification', 'sparkle', 'shimmer', 'magic', 'reveal', 'accent']],
  ['impact', ['impact', 'hit', 'thud', 'thump', 'slam', 'boom', 'punch', 'bang', 'smash', 'crash', 'knock', 'stomp', 'drum', 'kick', 'bass', 'braam', 'land', 'landing']],
  ['pop', ['pop', 'bubble', 'blip', 'bloop', 'plop', 'boop', 'appear', 'spawn', 'pluck']],
  ['click', ['click', 'switch', 'toggle', 'button', 'press', 'lock', 'latch', 'snap', 'mouse', 'key']],
  ['tick', ['tick', 'tock', 'tap', 'count', 'step', 'select', 'cursor', 'beep']],
];

const r3 = (n) => Math.round(n * 1000) / 1000;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sound';
const singular = (w) => (w.length > 4 && /(sh|ch|x|ss)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Words from a path's folders and file name ('Impacts/Big_Hit03 (wet).wav' → impacts, impact, big, hit, wet). */
export function nameWords(rel) {
  const words = rel
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[\\/]/)
    .flatMap((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z]+/))
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 1 && !JUNK.has(w));
  return [...new Set(words.flatMap((w) => [w, singular(w)]))];
}

/** The event kind a sound's words point to; a sound no kind word names is foley. */
export function inferKind(words) {
  for (const [kind, list] of KIND_WORDS) if (words.some((w) => list.includes(w))) return kind;
  return 'foley';
}

/** Tags the measurements earn. */
export function acousticTags(m) {
  const t = [];
  if (m.duration < 0.35) t.push('short');
  if (m.duration > 2.5) t.push('long');
  if (m.duration >= 2 && m.body >= 0.5) t.push('sustain');
  if (m.attack <= 15) t.push('sharp');
  else if (m.attack >= 80) t.push('soft-attack');
  if (m.centroid >= 3500) t.push('bright');
  else if (m.centroid > 0 && m.centroid <= 1200) t.push('dark');
  return t;
}

/** A one-line plain description. */
export function describe(words, kind, m) {
  const bits = [`${m.duration}s`];
  if (m.attack <= 15) bits.push('sharp attack');
  else if (m.attack >= 80) bits.push('slow attack');
  if (m.centroid >= 3500) bits.push('bright');
  else if (m.centroid > 0 && m.centroid <= 1200) bits.push('dark');
  bits.push(m.body >= 0.5 ? 'continuous' : `decays in ${m.decay}s`);
  return `${words.filter((w, i, a) => !a.includes(`${w}s`)).join(' ')} (${kind}): ${bits.join(', ')}`;
}

/** Why a measured sound is rejected, or null. */
export function rejectReason(m) {
  if (!m) return 'ffmpeg cannot decode it';
  if (m.duration < LIMITS.minDur) return `too short (${m.duration}s)`;
  if (m.duration > LIMITS.maxDur) return `too long (${m.duration}s; trim it under ${LIMITS.maxDur}s)`;
  if (m.peakDb < LIMITS.minPeakDb || m.meanDb < LIMITS.minMeanDb) return `silent or too quiet (peak ${m.peakDb} dBFS)`;
  return null;
}

/** Every audio file under `dir`, relative to it (sorted; hidden files and __MACOSX skipped). */
export function audioFiles(dir) {
  return walk(dir).audio;
}

/** One walk of `dir`: its audio files and its zip files, relative to it. */
export function walk(dir) {
  const audio = [];
  const zips = [];
  if (!existsSync(dir)) return { audio, zips };
  const go = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (ent.name.startsWith('.') || ent.name === '__MACOSX') continue;
      const p = join(d, ent.name);
      const dirLike = ent.isDirectory() || (ent.isSymbolicLink() && statSync(p, { throwIfNoEntry: false })?.isDirectory());
      if (dirLike) go(p);
      else if (AUDIO.has(extname(ent.name).toLowerCase())) audio.push(relative(dir, p));
      else if (extname(ent.name).toLowerCase() === '.zip') zips.push(relative(dir, p));
    }
  };
  go(dir);
  return { audio, zips };
}

/** The id a new drop-in at inbox path `rel` gets (unique against `taken`). */
export function idFor(rel, taken = new Set()) {
  const parts = rel.split(sep).join('/').split('/');
  const folder = parts.length > 1 ? slug(parts[0]) : 'loose';
  const base = slug(parts.at(-1).replace(/\.[a-z0-9]+$/i, ''));
  let id = `inbox/${folder}/${base}`;
  for (let i = 2; taken.has(id); i++) id = `inbox/${folder}/${base}-${i}`;
  return id;
}

/** The leading silence to cut and the gain that brings the peak to the target. */
export function trimFor(m) {
  const gainDb = Math.min(LIMITS.maxGainDb, LIMITS.targetPeakDb - m.peakDb);
  return { lead: r3(Math.max(0, m.onset - 0.005)), gainDb: Math.round(gainDb * 10) / 10 };
}

/** A catalog entry for inbox file `rel` with measurements `m` (before trimming and gain); `id` defaults to idFor(rel, taken). */
export function entryFor(rel, m, taken = new Set(), id = idFor(rel, taken)) {
  const parts = rel.split(sep).join('/').split('/');
  const words = nameWords(rel);
  const kind = inferKind(words);
  const trim = trimFor(m);
  const after = { ...m, duration: r3(Math.max(0.01, m.duration - trim.lead)), onset: 0, peakDb: Math.round((m.peakDb + trim.gainDb) * 10) / 10, meanDb: Math.round((m.meanDb + trim.gainDb) * 10) / 10 };
  const tags = [...new Set([...words, ...acousticTags(after), ...(KIND_TAGS[kind] ?? [kind]), 'inbox'])];
  return {
    id,
    file: `${OUT_DIR}/${id.slice('inbox/'.length)}.mp3`,
    pack: 'inbox',
    group: id.replace(/-?\d+$/, '') || id,
    kind,
    tags,
    duration: after.duration,
    peakDb: after.peakDb,
    meanDb: after.meanDb,
    attack: m.attack,
    decay: m.decay,
    centroid: m.centroid,
    body: m.body,
    description: describe(words, kind, after),
    source: `${INBOX}/${parts.join('/')}`,
    fp: m.fp,
  };
}

/** The ffmpeg arguments that encode a drop-in from trimmed 48 kHz stereo f32 PCM on stdin: peak-normalized MP3. */
export function encodeArgs(out, trim) {
  return ['-nostdin', '-v', 'error', '-y', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0', '-af', `volume=${trim.gainDb}dB,alimiter=limit=0.95:level=false`, '-c:a', 'libmp3lame', '-q:a', '2', out];
}

/** The ffmpeg arguments that write a drop-in straight from a file: trimmed, peak-normalized, 48 kHz stereo MP3. */
export function convertArgs(src, out, trim) {
  return ['-nostdin', '-v', 'error', '-y', '-ss', String(trim.lead), '-i', src, '-vn', '-af', `volume=${trim.gainDb}dB,aformat=sample_rates=48000:channel_layouts=stereo,alimiter=limit=0.95:level=false`, '-c:a', 'libmp3lame', '-q:a', '2', out];
}

const readJson = (file, fallback) => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
};

/** Write `file` whole or not at all (a crash mid-write never leaves half a catalog). */
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const hashFile = (p) => createHash('sha1').update(readFileSync(p)).digest('hex');

const zipAudio = (name) => !/(^|\/)(__MACOSX|\.)/.test(name) && !name.split('/').some((p) => p.startsWith('.')) && AUDIO.has(extname(name).toLowerCase());

/** The audio entries of a zip (paths inside it), skipping __MACOSX and hidden files; null when unreadable. */
export function zipEntries(zip) {
  const r = spawnSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  return r.stdout.split('\n').filter(zipAudio);
}

/** `n` entries spread evenly over `list` (a sample that spans every folder of a pack). */
export const spread = (list, n) => (n >= list.length ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]));

/** Extract `entries` of `zip` into `dest` (only audio; never the whole archive). */
function extractEntries(zip, entries, dest) {
  mkdirSync(dest, { recursive: true });
  // unzip takes the names as wildcards: escape them, and pass them in chunks (argument limits)
  const esc = (e) => e.replace(/[[\]*?\\]/g, '\\$&');
  for (let i = 0; i < entries.length; i += 200) {
    const r = spawnSync('unzip', ['-qo', zip, ...entries.slice(i, i + 200).map(esc), '-d', dest], { encoding: 'utf8', timeout: 900_000, maxBuffer: 16 * 1024 * 1024 });
    if (r.error || r.status > 1) return String(r.error?.message ?? r.stderr).trim().slice(0, 200) || `unzip exited ${r.status}`;
  }
  return null;
}

/** A pool of `n` ingest workers; run(task) resolves with the worker's reply; a crashed worker is replaced. */
function workerPool(n) {
  const url = new URL('./ingest-worker.mjs', import.meta.url);
  const idle = [];
  const waiting = [];
  const live = new Set();
  const spawn = () => {
    const w = new Worker(url);
    live.add(w);
    return w;
  };
  for (let i = 0; i < n; i++) idle.push(spawn());
  const runOn = (w, task, resolve) => {
    const done = (msg) => {
      w.off('message', done);
      w.off('error', fail);
      resolve(msg);
      const next = waiting.shift();
      if (next) runOn(w, next.task, next.resolve);
      else idle.push(w);
    };
    const fail = (e) => {
      w.off('message', done);
      w.off('error', fail);
      live.delete(w);
      resolve({ key: task.key, m: null, why: `worker crashed: ${String(e?.message ?? e).slice(0, 200)}` });
      const fresh = spawn();
      const next = waiting.shift();
      if (next) runOn(fresh, next.task, next.resolve);
      else idle.push(fresh);
    };
    w.on('message', done);
    w.on('error', fail);
    w.postMessage(task);
  };
  return {
    run: (task) =>
      new Promise((resolve) => {
        const w = idle.pop();
        if (w) runOn(w, task, resolve);
        else waiting.push({ task, resolve });
      }),
    close: () => Promise.all([...live].map((w) => w.terminate())),
  };
}

const fmtSecs = (s) => (s >= 90 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`);

const zipLabel = (zip) => basename(zip, extname(zip));

/**
 * Ingest new sounds into the library at `root`: everything under inbox/ (folders and .zip files),
 * plus `from`: more folders or .zip files anywhere on disk (a zip is read where it is; its audio is
 * extracted one zip at a time to a temp folder that is deleted after, so the repo never holds the
 * originals). `limit` takes an even sample of that many files per zip or folder (a trial run).
 * `store`: a folder outside the repo for the converted MP3s; dropins/ becomes a link to it.
 * Resolves with a summary: { added, kinds, skipped, rejected, duplicates, total, seconds, filesPerSecond, ... }.
 * @param {string} [root]
 * @param {{ from?: string[], limit?: number, store?: string, tmp?: string, dryRun?: boolean, ffmpeg?: string, jobs?: number, progressEvery?: number, flushMs?: number, log?: (line: string) => void }} [opts]
 */
export async function ingest(root = SFX, { from = [], limit = 0, store = null, tmp = tmpdir(), dryRun = false, ffmpeg = 'ffmpeg', jobs = availableParallelism(), progressEvery = 50, flushMs = 3000, log = (l) => process.stderr.write(`${l}\n`) } = {}) {
  const t0 = Date.now();
  if (store && !dryRun) linkStore(root, store);
  const inboxCatalog = readJson(join(root, INBOX_CATALOG), []);
  const main = readJson(join(root, 'catalog.json'), []);
  const cache = readJson(join(root, CACHE), null) ?? {};
  cache.version = 1;
  cache.files ??= {};
  cache.hashes ??= {};
  cache.zips ??= {};
  const st = {
    known: new Set(inboxCatalog.map((s) => s.source)),
    fps: new Map(inboxCatalog.map((s) => [s.fp, s.id])),
    // the bank's sounds have no fingerprint: a re-import of one matches on length and levels
    levels: new Map(main.map((s) => [`${s.duration}|${s.peakDb}|${s.meanDb}`, s.id])),
    taken: new Set([...inboxCatalog, ...main].map((s) => s.id)),
    seenHash: new Map(),
    added: [],
    rejected: [],
    duplicates: [],
    skipped: 0,
    processed: 0,
    busy: 0,
  };
  let lastFlush = Date.now();
  const flush = () => {
    if (dryRun) return;
    writeAtomic(join(root, INBOX_CATALOG), `${JSON.stringify([...inboxCatalog, ...st.added], null, 1)}\n`);
    writeAtomic(join(root, CACHE), `${JSON.stringify(cache)}\n`);
    lastFlush = Date.now();
  };
  const record = (p, status, extra = {}) => {
    if (dryRun) return;
    cache.hashes[p.stamp.hash] = { status, ...extra };
    cache.files[p.source] = p.stamp;
  };

  /** Triage `items` ({ rel, source, src }) by path, size+mtime and content hash, then measure + convert the new ones on every core. */
  const run = async (items, label) => {
    const pending = [];
    let skipped = 0;
    let copies = 0;
    for (const it of items) {
      const stat = statSync(it.src, { throwIfNoEntry: false });
      if (!stat) continue;
      const prev = cache.files[it.source];
      if (prev && prev.size === stat.size && prev.mtime === stat.mtimeMs && cache.hashes[prev.hash]) {
        skipped++;
        continue;
      }
      if (st.known.has(it.source) && !prev) {
        skipped++;
        continue;
      }
      let hash;
      try {
        hash = hashFile(it.src);
      } catch (e) {
        st.rejected.push({ file: it.source, why: `unreadable: ${e?.message ?? e}` });
        continue;
      }
      const stamp = { size: stat.size, mtime: stat.mtimeMs, hash };
      if (cache.hashes[hash]) {
        if (!dryRun) cache.files[it.source] = stamp;
        skipped++;
        continue;
      }
      if (st.seenHash.has(hash)) {
        st.duplicates.push({ file: it.source, of: st.seenHash.get(hash) });
        if (!dryRun) cache.files[it.source] = stamp;
        copies++;
        continue;
      }
      st.seenHash.set(hash, it.source);
      const id = idFor(it.rel, st.taken);
      st.taken.add(id);
      pending.push({ ...it, id, stamp });
    }
    st.skipped += skipped;
    const total = pending.length;
    const n = Math.max(1, Math.min(jobs, total));
    log(`[ingest] ${label}: ${items.length} audio files, ${skipped} already in, ${copies} identical copies, ${total} to process on ${n} worker${n === 1 ? '' : 's'}${dryRun ? ' (dry run)' : ''}`);
    if (!total) return;
    st.busy = Math.max(st.busy, n);
    let done = 0;
    let transient = 0;
    const tStart = Date.now();
    const onResult = (p, res) => {
      const { m, why } = res;
      if (why) {
        st.rejected.push({ file: p.source, why });
        // a conversion that failed may succeed on a re-run (a full disk); a bad file will not change
        if (/^conversion failed|^worker crashed|^failed:/.test(why)) transient++;
        else record(p, 'rejected', { why });
        return;
      }
      const twin = st.fps.get(m.fp) ?? st.levels.get(`${m.duration}|${m.peakDb}|${m.meanDb}`);
      if (twin) {
        st.duplicates.push({ file: p.source, of: twin });
        if (res.converted) {
          try {
            unlinkSync(join(root, OUT_DIR, `${p.id.slice('inbox/'.length)}.mp3`));
          } catch {}
        }
        record(p, 'duplicate', { of: twin });
        return;
      }
      const entry = entryFor(p.rel, m, st.taken, p.id);
      entry.source = p.source;
      st.fps.set(m.fp, entry.id);
      st.added.push(entry);
      record(p, 'added', { id: entry.id });
    };
    const pool = workerPool(n);
    try {
      await Promise.all(
        pending.map((p) =>
          pool.run({ key: p.source, src: p.src, out: join(root, OUT_DIR, `${p.id.slice('inbox/'.length)}.mp3`), ffmpeg, dryRun }).then((res) => {
            onResult(p, res);
            done++;
            st.processed++;
            if (done % progressEvery === 0 || done === total) {
              const secs = (Date.now() - tStart) / 1000;
              const rate = done / Math.max(0.001, secs);
              log(`[ingest] ${label}: ${done}/${total} (${Math.round((done / total) * 100)}%) · ${rate.toFixed(1)} files/s · ETA ${fmtSecs((total - done) / rate)} · +${st.added.length} added, ${st.rejected.length} rejected, ${st.duplicates.length} duplicates`);
            }
            if (Date.now() - lastFlush > flushMs) flush();
          }),
        ),
      );
    } finally {
      await pool.close();
    }
    flush();
    return transient;
  };

  // 1. The inbox's folders, and the extra folders named in `from`.
  const inbox = join(root, INBOX);
  const { audio, zips: inboxZips } = walk(inbox);
  const pick = (list) => (limit > 0 ? spread(list, limit) : list);
  const zips = [...inboxZips.map((z) => join(inbox, z)), ...from.filter((f) => /\.zip$/i.test(f))];
  const dirs = from.filter((f) => !/\.zip$/i.test(f));
  const loose = pick(audio).map((rel) => ({ rel, source: `${INBOX}/${rel.split(sep).join('/')}`, src: join(inbox, rel) }));
  for (const d of dirs) {
    if (!statSync(d, { throwIfNoEntry: false })?.isDirectory()) {
      st.rejected.push({ file: d, why: 'not a folder or a .zip' });
      continue;
    }
    for (const rel of pick(walk(d).audio)) loose.push({ rel: join(basename(d), rel), source: `from/${basename(d)}/${rel.split(sep).join('/')}`, src: join(d, rel) });
  }
  if (loose.length || !zips.length) await run(loose, 'folders');

  // 2. Each zip in turn: skipped whole when it was fully ingested before (same size and date);
  //    otherwise only its audio is extracted to a temp folder, ingested, and the folder deleted.
  let zipsSkipped = 0;
  for (const zip of zips) {
    const label = zipLabel(zip);
    const zst = statSync(zip, { throwIfNoEntry: false });
    if (!zst) {
      st.rejected.push({ file: zip, why: 'no such file' });
      continue;
    }
    const seen = cache.zips[label];
    if (seen && seen.size === zst.size && seen.mtime === zst.mtimeMs) {
      st.skipped += seen.files;
      zipsSkipped++;
      log(`[ingest] ${label}: already ingested (${seen.files} files), skipped`);
      continue;
    }
    const entries = zipEntries(zip);
    if (!entries) {
      st.rejected.push({ file: zip, why: 'unzip cannot read it' });
      continue;
    }
    const chosen = pick(entries);
    const dest = mkdtempSync(join(tmp, 'helios-sfx-'));
    try {
      const x0 = Date.now();
      const failed = extractEntries(zip, chosen, dest);
      if (failed) {
        st.rejected.push({ file: zip, why: `unzip failed: ${failed}` });
        continue;
      }
      log(`[ingest] ${label}: extracted ${chosen.length} audio files in ${fmtSecs((Date.now() - x0) / 1000)}`);
      const items = chosen.map((e) => ({ rel: join(label, e), source: `zip/${label}/${e}`, src: join(dest, e) }));
      const transient = await run(items, label);
      if (!dryRun && !limit && !transient) {
        cache.zips[label] = { size: zst.size, mtime: zst.mtimeMs, files: chosen.length };
        flush();
      }
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  }

  const kinds = {};
  for (const s of st.added) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  return {
    ok: true,
    dryRun,
    added: st.added.length,
    kinds,
    skipped: st.skipped,
    rejected: st.rejected,
    duplicates: st.duplicates,
    zips: zips.length,
    zipsSkipped,
    workers: st.busy,
    processed: st.processed,
    seconds,
    filesPerSecond: st.processed ? Math.round((st.processed / Math.max(0.001, seconds)) * 10) / 10 : 0,
    total: inboxCatalog.length + (dryRun ? 0 : st.added.length),
    sample: st.added.slice(0, 5).map((s) => s.description),
  };
}

/**
 * Keep the converted MP3s in `store` (outside the repo: a thousand sounds is hundreds of MB, too
 * big for git): dropins/ becomes a link to it, so every path in the catalog still resolves.
 */
export function linkStore(root, store) {
  const link = join(root, OUT_DIR);
  mkdirSync(store, { recursive: true });
  const cur = lstatSync(link, { throwIfNoEntry: false });
  if (cur?.isSymbolicLink()) {
    if (realpathSync(link) === realpathSync(store)) return;
    throw new Error(`${link} already links to ${readlinkSync(link)}; move it by hand to use ${store}`);
  }
  if (cur) throw new Error(`${link} is a real folder; move its files into ${store} and delete it to use the store`);
  symlinkSync(store, link, 'dir');
}

/** Measure every bank sound into acoustics.json ({ file: { attack, decay, centroid, body } }), across every core. */
export async function measureLibrary(root = SFX, { ffmpeg = 'ffmpeg', jobs = availableParallelism() } = {}) {
  const catalog = readJson(join(root, 'catalog.json'), []);
  const out = {};
  const failed = [];
  const todo = catalog.filter((s) => {
    if (existsSync(join(root, s.file))) return true;
    failed.push(s.file);
    return false;
  });
  const pool = workerPool(Math.max(1, Math.min(jobs, todo.length)));
  try {
    await Promise.all(
      todo.map((s) =>
        pool.run({ key: s.file, src: join(root, s.file), mode: 'measure', ffmpeg }).then(({ m }) => {
          if (m) out[s.file] = { attack: m.attack, decay: m.decay, centroid: m.centroid, body: m.body };
          else failed.push(s.file);
        }),
      ),
    );
  } finally {
    await pool.close();
  }
  const sorted = Object.fromEntries(catalog.filter((s) => out[s.file]).map((s) => [s.file, out[s.file]]));
  writeAtomic(join(root, ACOUSTICS), `${JSON.stringify(sorted)}\n`);
  return { ok: failed.length === 0, measured: Object.keys(sorted).length, failed };
}

if (isMainThread && import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const jobs = opt('--jobs') ? Math.max(1, Number(opt('--jobs')) || 1) : availableParallelism();
  // every argument that is not a flag (or a flag's value) is a zip or folder to read from
  const valued = new Set(['--jobs', '--limit', '--store']);
  const from = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
  const opts = { from, jobs, dryRun: args.includes('--dry-run'), limit: Number(opt('--limit') ?? 0) || 0, store: opt('--store') };
  // (no top-level await: tsx loads this file for the tests)
  (args.includes('--library') ? measureLibrary(SFX, { jobs }) : ingest(SFX, opts)).then(async (result) => {
  // The voice screen (voice-screen.mjs): a new drop-in plays only once a Mac has screened it.
  if (!opts.dryRun && !args.includes('--library')) {
    try {
      const { screenSounds } = await import('./voice-screen.mjs');
      result = { ...result, voiceScreen: screenSounds() };
    } catch (e) {
      result = { ...result, voiceScreen: `not run (${e instanceof Error ? e.message : e}); new drop-ins stay out of reels until node explainers/design/sfx/tools/voice-screen.mjs runs on a Mac` };
    }
  }
  // thousands of rejections would bury the summary: counts, then the first 20 of each
  const brief = (list) => (Array.isArray(list) && list.length > 20 ? [...list.slice(0, 20), `… and ${list.length - 20} more`] : list);
  process.stdout.write(`${JSON.stringify({ ...result, ...(result.rejected ? { rejected: brief(result.rejected), rejectedCount: result.rejected.length } : {}), ...(result.duplicates ? { duplicates: brief(result.duplicates), duplicateCount: result.duplicates.length } : {}), ...(result.failed ? { failed: brief(result.failed) } : {}) }, null, 1)}\n`);
  });
}
