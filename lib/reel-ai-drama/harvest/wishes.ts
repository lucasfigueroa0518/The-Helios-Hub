import fs from 'node:fs';
import path from 'node:path';

import { loadCutouts } from '@/lib/real-case/bank';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { jsonlLog } from '@/lib/reel-ai-drama/reporting/llm';
import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Asset, FactSheet, Mode, Pitch, ShotWish, VisualKind } from '@/lib/reel-ai-drama/types';

import { trustedCutouts } from './bank-verdicts';
import { writeSidecars } from './boxes';
import { faceCount, isGarbled, isVerified, PORTRAIT_KINDS } from './cast';
import { wantsCutout } from './cutouts';
import { phash } from './filters';
import { offerToBank } from './photo-bank';
import { makePipeline, saveAsset, type Cand } from './pipeline';
import { contentWords } from './plan';
import type { HarvestDeps, SourceName, Want } from './types';
import { assetKey } from './harvest';

/**
 * The targeted search (MD-68): the director plans the shots it wants first; for each `ShotWish` the
 * inventory lacks, this searches for that exact picture (the person and what they are doing), screens it
 * through the harvest's own pipeline (filters, look, identity, 20-day rule, size) and keeps the best one
 * that the look says fits the wish. Found pictures are numbered after the inventory's last V id, saved into
 * the job media and recorded like harvest assets. Bounded: at most MAX_WISHES wishes, WISH_QUERIES queries
 * each, WISH_CAP_USD. Fails open: a wish with nothing found keeps its fallback; an error costs only that wish.
 * A wish with `cut_out` (MD-127) is found here like any other; its find is cut out afterwards by the
 * cutout step (`wishCutoutRequests` → `makeCutouts`, cutouts.ts), and a failed cutout keeps this photo.
 */

export const MAX_WISHES = 12;
export const WISH_QUERIES = 3;
/** Candidates kept per query: the look is the cost, and a targeted query's best hits come first. */
export const WISH_PER_SOURCE = 6;
/** A wish keeping several pictures (`count`) looks at more of each query, up to this. */
export const WISH_PER_SOURCE_MAX = 16;
export const WISH_COUNT_MAX = 10;
export const WISH_CAP_USD = 0.5;

export type WishSearchInput = {
  wishes: ShotWish[];
  pitch: Pitch;
  facts: FactSheet | null;
  jobDir: string;
  jobId: string | null;
  mode: Mode;
  settings: ReelAiDramaSettings;
};

export type WishSearchResult = { found: { wish_id: string; asset: Asset }[]; problems: string[]; usd: number };

const PLACE = /\b(headquarters|office|offices|building|campus|street|city|hotel|restaurant|room|hall|courthouse|capitol|lab|laboratory|factory|exterior|skyline)\b/i;
/** A year, never the first half of an arXiv id (1902.00098). */
const YEAR = /\b(19|20)\d{2}\b(?!\.\d)/;
const year = (text: string) => YEAR.exec(text)?.[0] ?? '';

/**
 * Words that direct the shot (how the picture should look) rather than name what is in it. Iteration 4:
 * queries built from them ("Sam Altman photo alone 2014", Commons "exterior photo") found nothing.
 */
const SHOT_WORDS = new Set(
  'photo photos photograph picture pictures image images shot shots clear clearly alone solo around while during circa mid late early era time real actual original exterior interior outside inside view close wide head shoulders shoulder face faces camera full half figure length portrait candid showing shows shown show visible sign signs logo clearly listing including such either recognisable recognizable plain neutral expression looking facing e.g eg like screenshot screenshots screen capture page passage section quote quoted stating saying says said published publish print printed version copy readable legible'.split(' '),
);
const MONTHS = new Set('january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'.split(' '));
/** How an object is seen (MD-127: "a dinner table seen from above"): directions for the shot, not the thing. */
const VIEW_WORDS = new Set('seen above below overhead angle angled top down side front back background foreground isolated set against centre center middle'.split(' '));
/** Capitalised words that open a sentence or describe a shot, never a name. */
const NOT_NAMES = new Set('a an the this that these those his her their its photo picture image screenshot exterior interior close wide head one two three arxiv'.split(' '));
/** A quoted title: opened after a space or bracket and closed before punctuation (never an apostrophe). */
const QUOTED = /(?:^|[\s(])['‘"“]([^'’"”]{3,80})['’"”](?=[\s.,;:)!?]|$)/g;

/** The names a wish mentions: runs of capitalised (or mixed-case: OpenAI, arXiv, ConvAI2) words, possessives trimmed. */
export function wishNames(text: string): string[] {
  const out: string[] = [];
  const quoted = [...text.matchAll(QUOTED)].map((m) => m[1].trim()).filter((q) => /[A-Za-z]/.test(q) && q.split(/\s+/).length >= 2);
  const scrubbed = text.replace(/https?:\/\/\S+/g, ' ').replace(QUOTED, ' , ');
  const tokens = scrubbed.split(/(\s+|[,;:()–—.!?](?:\s|$))/);
  let run: string[] = [];
  const flush = () => {
    while (run.length && /^(of|for|and|in|at|on|the|de|von|van)$/i.test(run[run.length - 1])) run.pop();
    if (run.length) out.push(run.join(' '));
    run = [];
  };
  for (const raw of tokens) {
    if (!raw || !raw.trim()) continue;
    if (/^[,;:()–—.!?]/.test(raw.trim())) {
      flush();
      continue;
    }
    const w = raw.replace(/(?:['’]s|['’])$/, '').replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (!w) continue;
    const lower = w.toLowerCase();
    const capital = /^[A-Z]/.test(w) || /[a-z][A-Z]/.test(w);
    if (capital && !NOT_NAMES.has(lower) && !MONTHS.has(lower)) run.push(w);
    else if (run.length && /^(of|for|and|in|de|von|van)$/.test(w)) run.push(w);
    else flush();
  }
  flush();
  return [...new Set([...quoted.map((q) => `"${q}"`), ...out])];
}

/** The wish's subject words: what the picture is of, without names, years, months or shot directions. */
function subjectWords(text: string, names: readonly string[]): string[] {
  const nameWords = new Set(names.flatMap((n) => contentWords(n)));
  return contentWords(text.replace(/https?:\/\/\S+/g, ' ')).filter((w) => !nameWords.has(w) && !SHOT_WORDS.has(w) && !MONTHS.has(w) && !/\d/.test(w));
}

/**
 * What the wish is a picture of, grammatically: the last plain word before the first clause break, skipping
 * clauses that only direct the shot. It always goes into the search, so a run of adjectives can't crowd it out.
 */
export function headNoun(text: string, names: readonly string[] = []): string | null {
  const nameWords = new Set(names.flatMap((n) => contentWords(n)));
  const clauses = text.replace(/https?:\/\/\S+/g, ' ').split(/[,;:()–—]|\b(?:with|of|in|on|at|from|for|by|near|under|over|behind|beside|against|seen|showing|shown|where|that|which|while|during|around)\b/i);
  for (const clause of clauses) {
    const words = contentWords(clause ?? '').filter((w) => !nameWords.has(w) && !SHOT_WORDS.has(w) && !VIEW_WORDS.has(w) && !MONTHS.has(w) && !/\d/.test(w));
    if (words.length) return words[words.length - 1];
  }
  return null;
}

/** The first `n` words, the head noun always among them. */
function withHead(words: readonly string[], head: string | null, n: number): string[] {
  const first = words.slice(0, n);
  return !head || first.includes(head) ? first : [...words.slice(0, Math.max(0, n - 1)), head];
}

/** A query's retry: a wider one (the names and its last word, or its last two words), or a narrower one when it is already short. */
export function queryRetry(query: string, label = 'photo'): string {
  const words = query.split(/\s+/);
  if (words.length <= 2) return `${query} ${label}`;
  const caps = words.filter((w) => /^[A-Z]|[a-z][A-Z]/.test(w));
  const last = words[words.length - 1];
  return caps.length && caps.length < words.length ? [...new Set([...caps, last])].join(' ') : words.slice(-2).join(' ');
}

const AS_KIND = { logo: 'logo', product: 'product', object: 'object', place: 'place_photo' } as const;
const RETRY_LABEL: Partial<Record<VisualKind, string>> = { product: 'product', place_photo: 'exterior' };

/** Pictures a wish keeps (MD-139): 1 unless it asks for more. */
export const wishCount = (wish: Pick<ShotWish, 'count'>): number => Math.max(1, Math.min(WISH_COUNT_MAX, Math.round(Number(wish.count) || 1)));

/** Pages a wish names: a URL or a bare site path, and arXiv ids (captured as pages, never searched). */
export function wishPages(text: string): { url: string; paper: boolean }[] {
  const out = new Map<string, boolean>();
  for (const m of text.matchAll(/\barxiv(?:\.org\/abs\/|[:\s]+)(\d{4}\.\d{4,5})/gi)) out.set(`https://arxiv.org/abs/${m[1]}`, true);
  for (const m of text.matchAll(/\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|edu|gov|co|dev|blog)(?:\/[^\s)'"”,;]*)?)/gi)) {
    const raw = m[1].replace(/[.)]+$/, '');
    if (/arxiv\.org/i.test(raw) || /^(?:e\.g|i\.e)$/i.test(raw)) continue;
    out.set(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`, false);
  }
  return [...out].map(([url, paper]) => ({ url, paper }));
}

/** Words to measure on a captured page: quoted titles, figures (16.28, $20,000) and names the wish quotes. */
function wishPhrases(text: string): string[] {
  const quoted = [...text.matchAll(QUOTED)].map((m) => m[1].trim());
  const figures = [...text.replace(/\b\d{4}\.\d{4,5}\b/g, ' ').matchAll(/\$?\d[\d,]*\.\d+|\$\d[\d,]*/g)].map((m) => m[0]);
  return [...new Set([...quoted, ...figures])].slice(0, 6);
}

/** The organisation in a cast role ("Hugging Face co-founder" → "Hugging Face"), to steer a person search. */
function roleOrg(role: string | undefined): string {
  if (!role) return '';
  return wishNames(role).filter((n) => !n.startsWith('"'))[0] ?? '';
}

/**
 * The searches for one wish, at most WISH_QUERIES, built from the names the wish mentions (iteration 4: the
 * prose words of the wish found nothing). A person wish: Serper with the person, the wish's names and the
 * year; Serper with the person and the first name or their role's organisation (no year: wider); Commons
 * with the person and the year (Commons ANDs every word, so names only). A place or event wish: Serper with
 * its names and subject words, Serper with fewer, Commons with the names alone. A page the wish names (a
 * URL, an arXiv id) is captured as well, with the wish's quoted words and figures measured on it; that
 * capture costs no search. A person wish is a person photo (the caption must name them); otherwise a place,
 * an object (MD-127: a cut-out wish, or one naming a kind of thing with no name or year) or an event photo.
 * A wish with a `query` (MD-139) searches it first, as written, then a narrower or wider retry; words from
 * `want` serve only old plans, and they always keep the wish's head noun. `as` picks the kind and route: a
 * logo goes to the logo source (which falls back to Google Images); a product, object or place carries no
 * event-date filter.
 */
export function wishWants(wish: ShotWish, ctx: { context?: string; qid?: string | null } = {}): Want[] {
  const person = wish.person?.trim() || null;
  const personWords = new Set(person ? contentWords(person) : []);
  const names = wishNames(wish.want).filter((n) => {
    const words = contentWords(n);
    return !person || !words.length || !words.every((w) => personWords.has(w));
  });
  const subject = subjectWords(wish.want, [...names, person ?? '']);
  const y = year(wish.want);
  // MD-127: a wish may name a kind of thing (a table, plates, a lamp): a cut-out wish that is not a person or
  // a place, or a wish with no name and no year, is an object photo (no event date filter on it).
  const query = wish.query?.replace(/\s+/g, ' ').trim() || null;
  const as = wish.as && wish.as !== 'photo' ? AS_KIND[wish.as] : null;
  const head = headNoun(wish.want, [...names, person ?? '']);
  const kind: VisualKind = wish.as === 'logo' ? 'logo' : person ? 'person_photo' : as ?? (PLACE.test(wish.want) ? 'place_photo' : wantsCutout(wish) || (!names.length && !y) ? 'object' : 'event_photo');
  const base = {
    kind,
    what: wish.want,
    people: person ? [person] : [],
    qids: ctx.qid ? [ctx.qid] : [],
    playerId: null,
    key_moment: false,
    context: ctx.context,
  } as const;
  const id = `wish:${wish.id}`;
  if (kind === 'logo') return [{ ...base, id: `${id}:1`, terms: query ?? names[0]?.replace(/"/g, '') ?? (subject.join(' ') || wish.want), sources: ['logo'] }];
  const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  let terms: string[];
  if (person) {
    const org = names[0] ?? roleOrg(ctx.context);
    terms = [join(person, ...names.slice(0, 2), ...(names.length ? [] : subject.slice(0, 2)), y), join(person, org || subject[0]), join(person, y)];
  } else if (kind === 'object') {
    // Real photos of that kind of thing: what it is (its names and subject words, never how it is seen) on
    // Serper; Commons with the thing's first two words (it ANDs every word); Serper again, narrower.
    const thing = subject.filter((w) => !VIEW_WORDS.has(w));
    terms = [join(...names.slice(0, 2), ...withHead(thing, head, 3)), join(...(names.length ? names.slice(0, 2) : withHead(thing, head, 2))), join(...names.slice(0, 1), ...withHead(thing, head, 2))];
  } else {
    const place = kind === 'place_photo';
    terms = [join(...names.slice(0, 3), ...withHead(subject, head, 2), place ? '' : y), join(...names.slice(0, 2), head ?? subject[0]), join(...(names.length ? names.slice(0, 2) : withHead(subject, head, 2)))];
  }
  if (query) {
    const retry = queryRetry(query, RETRY_LABEL[kind]);
    const short = query.split(/\s+/).length <= 2;
    terms = person ? [query, terms[1], terms[2]] : [query, retry, short ? query : retry];
  }
  const sources: SourceName[] = kind === 'object' && !query ? ['serper', 'commons', 'serper'] : ['serper', 'serper', 'commons'];
  const seen = new Set<string>();
  const out: Want[] = [];
  terms.forEach((t, i) => {
    const key = `${sources[i]}:${t.toLowerCase()}`;
    if (!t || seen.has(key)) return;
    seen.add(key);
    // Commons ANDs every word: no quotes, each word once.
    const commons = () => [...new Set(t.replace(/"/g, '').split(/\s+/))].join(' ');
    out.push({ ...base, id: `${id}:${i + 1}`, terms: sources[i] === 'commons' ? commons() : t, sources: [sources[i]] });
  });
  const searches = out.slice(0, WISH_QUERIES);
  const phrases = wishPhrases(wish.want);
  const pages = person ? [] : wishPages(wish.want).slice(0, 2);
  pages.forEach((pg, i) =>
    searches.push({ ...base, kind: pg.paper ? 'paper' : 'web_page', id: `${id}:${WISH_QUERIES + i + 1}`, terms: pg.url, url: pg.url, phrases, sources: [pg.paper ? 'paper' : 'screen'] }),
  );
  return searches;
}

/** Which wish a want id belongs to. */
const wishOf = (wantId: string) => /^wish:([^:]+):\d+$/.exec(wantId)?.[1] ?? null;

/** Years between a candidate's date and the wish's year, or null when either is unknown. */
function yearsOff(c: Pick<Cand, 'date_taken'>, wish: ShotWish): number | null {
  const want = Number(year(wish.want));
  const got = Number(c.date_taken?.slice(0, 4));
  return want && got ? Math.abs(got - want) : null;
}

/**
 * The best screened candidate for a wish, or null: it must fit the wish (the look says so), not be
 * garbled, and for a person wish show that person; then a verified identity, one face, size, the wish's
 * period (a dated picture within a year of the wish's year scores up, one more than three years off scores
 * down) and recency. A page we captured (no look) counts only when a word the wish quotes was measured on it.
 */
export function pickForWish<T extends Cand>(cands: readonly T[], wish: ShotWish, taken: ReadonlySet<T> = new Set()): T | null {
  let best: { c: T; s: number } | null = null;
  for (const c of cands) {
    if (c.reject || taken.has(c) || !c.file || isGarbled(c)) continue;
    if (!c.wants.some((w) => wishOf(w) === wish.id)) continue;
    if (c.look && (c.look.fits === false || c.look.garbled)) continue;
    if (!c.look && c.made && !c.text_boxes?.length) continue;
    if (wish.person && !c.people.includes(wish.person)) continue;
    let s = c.look?.fits || (c.made && c.text_boxes?.length) ? 2 : 0;
    if (c.flags.includes('logo_bank')) s += 2; // the reviewed mark beats anything a search finds
    if (wish.person) {
      if (isVerified(c)) s += 2;
      if (PORTRAIT_KINDS.has(c.kind) && faceCount(c) === 1) s += 0.5;
    }
    s += Math.min(Math.min(c.width ?? 0, c.height ?? 0), 1600) / 1600;
    const off = yearsOff(c, wish);
    if (off !== null) s += off <= 1 ? 0.75 : off > 3 ? -0.75 : 0;
    s += c.recency * 0.25;
    if (!best || s > best.s || (s === best.s && c.order < best.c.order)) best = { c, s };
  }
  return best?.c ?? null;
}

/** Why each candidate of a wish was or wasn't kept (the wish search's log; iteration 4 had none). */
export function wishOutcomes(cands: readonly Cand[], wish: ShotWish): string[] {
  return cands
    .filter((c) => c.wants.some((w) => wishOf(w) === wish.id))
    .map((c) => `${c.source}:${(c.url ?? c.source_page ?? c.localFile ?? '').slice(0, 90)} → ${c.reject ?? (c.look ? `fits=${c.look.fits !== false}` : 'no look')}${c.people.length ? ` [${c.people.join(', ')}]` : ''}`)
    .slice(0, 24);
}

/** The highest V number among files in `<jobDir>/media` (the inventory's last V id). */
export function lastVisualNumber(mediaDir: string): number {
  if (!fs.existsSync(mediaDir)) return 0;
  return fs.readdirSync(mediaDir).reduce((max, f) => {
    const m = /^V(\d+)\.[a-z0-9]+$/i.exec(f);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
}

async function knownHashes(mediaDir: string): Promise<{ id: string; phash: string }[]> {
  if (!fs.existsSync(mediaDir)) return [];
  const out: { id: string; phash: string }[] = [];
  for (const f of fs.readdirSync(mediaDir)) {
    const m = /^([VM]\d+)\.(jpe?g|png|webp)$/i.exec(f);
    if (!m) continue;
    try {
      out.push({ id: m[1], phash: await phash(path.join(mediaDir, f)) });
    } catch {
      // an unreadable file can't be a duplicate of anything
    }
  }
  return out;
}

export async function searchWishes(deps: HarvestDeps, input: WishSearchInput): Promise<WishSearchResult> {
  const { pitch, facts, jobDir, jobId, mode, settings } = input;
  const problems: string[] = [];
  const found: WishSearchResult['found'] = [];
  const wishes = input.wishes.slice(0, MAX_WISHES);
  if (input.wishes.length > MAX_WISHES) problems.push(`${input.wishes.length - MAX_WISHES} wish(es) past the first ${MAX_WISHES} were not searched; they take their fallbacks`);
  if (!wishes.length) return { found, problems, usd: 0 };

  const now = deps.now?.() ?? new Date();
  const log = deps.log ?? jsonlLog('harvest', jobId ?? 'nojob');
  const mediaDir = path.join(jobDir, 'media');
  const tmpDir = path.join(mediaDir, `tmp-wishes-${process.pid}-${now.getTime()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const cast = [...new Set([...pitch.cast, ...(facts?.cast ?? [])].filter((m) => m.kind === 'person').map((m) => m.name))];
  const roles = new Map<string, string>([...pitch.cast, ...(facts?.cast ?? [])].map((m) => [m.name, m.role]));
  const qids = new Map((facts?.cast ?? []).map((m) => [m.name, m.qid]));
  let usd = 0;
  try {
    const p = makePipeline({
      deps: { ...deps, cutouts: trustedCutouts(deps.cutouts ?? loadCutouts(deps.root ?? process.cwd()), deps.root ?? process.cwd()) },
      pitch,
      settings,
      jobId,
      mode,
      now,
      // A wish can be any year of the story: no news-window date filter on its searches.
      isNews: false,
      tmpDir,
      capUsd: deps.capUsd ?? WISH_CAP_USD,
      log,
      wants: [],
      cast,
      roles: Object.fromEntries([...roles].filter(([, r]) => Boolean(r))),
      known: await knownHashes(mediaDir),
    });
    const wants = wishes.flatMap((w) => {
      try {
        return wishWants(w, { context: w.person ? roles.get(w.person) : undefined, qid: w.person ? qids.get(w.person) ?? null : null });
      } catch (error) {
        problems.push(`${w.id}: could not plan a search (${error instanceof Error ? error.message : String(error)})`);
        return [];
      }
    });
    log({ event: 'wish_search', wishes: wishes.map((w) => ({ id: w.id, person: w.person, want: w.want, cut_out: wantsCutout(w) })), wants: wants.map((w) => ({ id: w.id, sources: w.sources, terms: w.terms })) });
    // A wish keeping several pictures looks at more of each query; everything stays under the look's cap.
    const perWant = new Map(wishes.map((w) => [`wish:${w.id}:`, Math.min(WISH_PER_SOURCE_MAX, Math.max(WISH_PER_SOURCE, wishCount(w) * 2))]));
    const reach = (w: Want) => [...perWant].find(([prefix]) => w.id.startsWith(prefix))?.[1] ?? WISH_PER_SOURCE;
    for (const n of [...new Set(wants.map(reach))].sort((a, b) => a - b)) await p.pass(wants.filter((w) => reach(w) === n), n);
    await p.boxFaces(p.live());
    usd = p.run.spend.serperUsd + p.run.spend.lookUsd;
    if (p.run.spend.serperQueries) await recordCost(deps.db, { jobId, mode, vendor: 'serper', component: 'harvest_wish_search', usd: p.run.spend.serperUsd });

    let n = lastVisualNumber(mediaDir);
    const taken = new Set<Cand>();
    for (const wish of wishes) {
      try {
        const count = wishCount(wish);
        for (let i = 0; i < count; i += 1) {
          const c = pickForWish(p.live(), wish, taken);
          if (!c) {
            if (i === 0) problems.push(`${wish.id}: nothing found that shows "${wish.want.slice(0, 120)}"; ${wish.fallback} stands in`);
            else problems.push(`${wish.id}: found ${i} of ${count} different pictures`);
            break;
          }
          taken.add(c);
          n += 1;
          const asset = await saveAsset(c, `V${n}`, jobDir, [`wish:${wish.id}`]);
          p.run.notes.push(...(await writeSidecars(jobDir, [{ asset, faces: c.faces, textHeavy: c.look?.text_heavy === true }], { readWords: deps.readWords ?? null, detectFaces: deps.detectFaces ?? null, cutout: deps.cutout ?? null })));
          await deps.db.query(`INSERT INTO reel_ai_drama.assets (job_id, asset_key, ref, kind, status, data) VALUES ($1, $2, $3, $4, 'usable', $5::jsonb)`, [
            jobId,
            assetKey(asset, c.bytes),
            asset.id,
            asset.kind,
            JSON.stringify(asset),
          ]);
          found.push({ wish_id: wish.id, asset });
        }
      } catch (error) {
        problems.push(`${wish.id}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
      }
    }
    // The hub's photo bank: the finds taken (picked) and the ones that passed every check but weren't (passed),
    // as the carousel offers its winner and runners-up.
    const passed = p.live().filter((c) => !taken.has(c));
    offerToBank(deps.photoBank, { jobId, pitch, facts, wants, kept: [...[...taken].map((c, i) => ({ c, slide: i + 1, outcome: 'picked' as const })), ...passed.map((c, i) => ({ c, slide: taken.size + i + 1, outcome: 'passed' as const }))], at: now }, p.run.notes);
    await deps.photoBank?.flush?.(5_000);
    log({
      event: 'wish_search_done',
      found: found.map((f) => `${f.wish_id}→${f.asset.id}`),
      problems,
      usd,
      notes: p.run.notes,
      outcomes: Object.fromEntries(wishes.map((w) => [w.id, wishOutcomes(p.cands, w)])),
    });
  } catch (error) {
    problems.push(`wish search stopped: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return { found, problems, usd: Number(usd.toFixed(6)) };
}
