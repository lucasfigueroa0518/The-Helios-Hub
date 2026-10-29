// Pronunciation for Reel AI Drama (iteration 2, W4): the writer's `pronounce: { word, say }[]` respells
// names the voice would get wrong, in the TTS input only. Captions keep the original spelling.
//
// The least invasive path through the faceless-explainer scripts (read-only here): audio.mjs reads the
// spoken text from SCRIPT.md's indented blocks and captions.mjs builds every caption from the words in
// audio_meta.json (caption-overrides.json is only an empty shim). So:
//   1. prepareTts(root, pronounce) writes SCRIPT.tts.md, a copy of SCRIPT.md whose spoken lines say the
//      respellings, and keeps the list in assets/voice/pronounce.json. audio.mjs runs with
//      `--script ./SCRIPT.tts.md` (the path it returns).
//   2. restoreSpelling(root), right after audio.mjs (before sync-durations and pace), puts the original
//      spelling back on the voiced words in audio_meta.json (a respelling the TTS split into several
//      words becomes one word again, from the first's start to the last's end), so the captions, the
//      line spans and every check see the writer's spelling.
// Respelling, not SSML: HeyGen's TTS takes plain text.
//
//   node assets/kit/pronounce.mjs restore      (from the project root; prints JSON { ok, restored })

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TTS_SCRIPT = 'SCRIPT.tts.md';
export const PRONOUNCE_FILE = 'assets/voice/pronounce.json';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Letters and digits only, lowercased: how two spellings of a word are compared. */
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The usable entries: both sides non-empty and different. */
export function pronounceList(pronounce) {
  return (Array.isArray(pronounce) ? pronounce : [])
    .map((p) => ({ word: String(p?.word ?? '').trim(), say: String(p?.say ?? '').trim() }))
    .filter((p) => p.word && p.say && p.word !== p.say);
}

/** `text` with every whole-word `word` (any case) replaced by its `say`. Longer words go first. */
export function ttsText(text, pronounce) {
  let out = String(text);
  for (const p of [...pronounceList(pronounce)].sort((a, b) => b.word.length - a.word.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(p.word)}(?![\\p{L}\\p{N}])`, 'giu'), p.say);
  }
  return out;
}

/** SCRIPT.md with only its spoken (indented) lines respelled; headings and metadata untouched. */
export function ttsScript(md, pronounce) {
  return String(md)
    .split(/\r?\n/)
    .map((line) => {
      const m = /^( {4,}|\t)(.+)$/.exec(line);
      return m ? `${m[1]}${ttsText(m[2], pronounce)}` : line;
    })
    .join('\n');
}

/**
 * Voiced words with the original spelling back: wherever 1–n consecutive words spell a `say`, they
 * become one word carrying `word` (with the first word's leading and the last word's trailing
 * punctuation or possessive). Returns { words, restored }.
 */
export function restoreWords(words, pronounce) {
  const list = pronounceList(pronounce).map((p) => ({ ...p, key: norm(p.say), parts: p.say.split(/\s+/).length }));
  const ws = Array.isArray(words) ? words : [];
  const out = [];
  let restored = 0;
  for (let i = 0; i < ws.length; ) {
    let hit = null;
    for (const p of list) {
      for (let k = Math.min(ws.length - i, p.parts + 2); k >= 1 && !hit; k--) {
        const span = ws.slice(i, i + k);
        const joined = norm(span.map((w) => w.text).join(''));
        const rest = joined.startsWith(p.key) ? joined.slice(p.key.length) : null;
        // The respelling, plus at most a possessive ("'s" leaves an "s").
        if (rest === '' || rest === 's') hit = { p, k, span };
      }
      if (hit) break;
    }
    if (!hit) {
      out.push(ws[i]);
      i += 1;
      continue;
    }
    const first = String(hit.span[0].text ?? '');
    const last = String(hit.span[hit.span.length - 1].text ?? '');
    const lead = /^[^\p{L}\p{N}]*/u.exec(first)[0];
    const tail = /(['’]s)?[^\p{L}\p{N}]*$/u.exec(last)[0];
    const end = hit.span[hit.span.length - 1].end;
    out.push({ ...hit.span[0], text: `${lead}${hit.p.word}${tail}`, end: Number.isFinite(end) ? end : hit.span[0].end });
    restored += 1;
    i += hit.k;
  }
  return { words: out, restored };
}

/**
 * Write the TTS copy of SCRIPT.md and keep the list for restoreSpelling. Returns the script path for
 * audio.mjs's `--script` (./SCRIPT.md itself when nothing needs respelling) and how many lines changed.
 */
export function prepareTts(root, pronounce) {
  const list = pronounceList(pronounce);
  const file = join(root, PRONOUNCE_FILE);
  mkdirSync(join(root, 'assets', 'voice'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(list, null, 1)}\n`);
  const scriptFile = join(root, 'SCRIPT.md');
  if (!list.length || !existsSync(scriptFile)) return { script: './SCRIPT.md', changed: 0 };
  const md = readFileSync(scriptFile, 'utf8');
  const tts = ttsScript(md, list);
  const changed = md.split(/\r?\n/).filter((l, i) => l !== tts.split(/\r?\n/)[i]).length;
  if (!changed) return { script: './SCRIPT.md', changed: 0 };
  writeFileSync(join(root, TTS_SCRIPT), tts);
  return { script: `./${TTS_SCRIPT}`, changed };
}

/** Put the original spelling back on audio_meta.json's voiced words (and `words_orig`, if paced). */
export function restoreSpelling(root) {
  const listFile = join(root, PRONOUNCE_FILE);
  const metaFile = join(root, 'audio_meta.json');
  if (!existsSync(listFile) || !existsSync(metaFile)) return { ok: true, restored: 0 };
  const list = JSON.parse(readFileSync(listFile, 'utf8'));
  if (!pronounceList(list).length) return { ok: true, restored: 0 };
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  let restored = 0;
  for (const v of meta.voices ?? []) {
    for (const key of ['words', 'words_orig']) {
      if (!Array.isArray(v[key])) continue;
      const r = restoreWords(v[key], list);
      v[key] = r.words;
      if (key === 'words') restored += r.restored;
    }
  }
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  return { ok: true, restored };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cmd = process.argv[2];
  let result;
  try {
    result = cmd === 'restore' ? restoreSpelling(process.cwd()) : { ok: false, error: 'usage: pronounce.mjs restore' };
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  console.log(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}
