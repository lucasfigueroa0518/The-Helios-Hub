import type { BankedCutout } from '@/lib/real-case/bank';
import { OFFICIAL_DOMAINS } from '@/lib/social/photos/official-domains';
import { BLUE_CHIP_PLAYERS, bluePlayer, type BluePlayer } from '@/lib/social-hub/blue-chip-players';
import { siteOf, urlKey } from '@/lib/reel-ai-drama/reporting/validate';
import type { CastMember, FactSheet, Pitch, VisualKind } from '@/lib/reel-ai-drama/types';

import type { SourceName, Want } from './types';

/**
 * Step 1 of the harvest (research 04 §7.1): the pitch's cast, scene and expected visuals, plus the fact
 * sheet's sources, artifacts and places when reporting has finished, become "wants". Each want names the
 * adapters that serve it, in the research's source order (§7.2).
 */

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
export const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';

const STOP = new Set('a an the of and or to in on at for with by from as is was were be been his her their its it that this into over after before about who what when'.split(' '));
export const contentWords = (s: string) => norm(s).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w));

/** The blue-chip player a cast member is: by id, then exact name, former name or token. */
export function playerOf(member: Pick<CastMember, 'name' | 'kind' | 'player_id'>): BluePlayer | null {
  if (member.player_id) {
    const p = bluePlayer(member.player_id);
    if (p) return p;
  }
  const name = norm(member.name);
  return BLUE_CHIP_PLAYERS.find((p) => p.kind === member.kind && [p.name, ...(p.aka ?? []), ...p.tokens].some((n) => norm(n) === name)) ?? null;
}

export function isNewsStory(eventDate: string | null, now: Date, windowDays: number): boolean {
  if (!eventDate) return false;
  const t = Date.parse(eventDate);
  return Number.isFinite(t) && now.getTime() - t <= windowDays * 86_400_000;
}

const PRESS_WIRES = ['prnewswire.com', 'businesswire.com', 'globenewswire.com'];

/** The company an official page belongs to, or a press wire; null for news and other sites. */
export function officialOwner(url: string): string | null {
  const key = urlKey(url);
  for (const c of OFFICIAL_DOMAINS) {
    for (const p of c.paths) {
      if ((key === p.host || key.startsWith(`${p.host}/`) || key.split('/')[0].endsWith(`.${p.host}`)) && (!p.path || `/${key.split('/').slice(1).join('/')}`.startsWith(p.path))) return c.company;
    }
  }
  return PRESS_WIRES.includes(siteOf(url)) ? 'press wire' : null;
}

export const arxivId = (url: string) => /arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5})/i.exec(url)?.[1] ?? null;
export const youtubeId = (url: string) => /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i.exec(url)?.[1] ?? null;
const SOCIAL_HOSTS = ['x.com', 'twitter.com', 'threads.net', 'threads.com', 'bsky.app', 'linkedin.com', 'reddit.com', 'news.ycombinator.com'];
export const isPostUrl = (url: string) => SOCIAL_HOSTS.includes(siteOf(url)) || SOCIAL_HOSTS.some((h) => urlKey(url).startsWith(`${h}/`));

/** Search sources per expected-visual kind (§7.2, trimmed to the adapters we have). */
const SEARCH_ROUTES: Partial<Record<VisualKind, SourceName[]>> = {
  person_photo: ['serper', 'commons'],
  event_photo: ['serper', 'commons'],
  archival: ['commons', 'openverse', 'serper'],
  place_photo: ['commons', 'openverse', 'serper'],
  product: ['serper', 'openverse', 'commons'],
  object: ['openverse', 'commons', 'serper'],
  logo: ['logo'],
};

const ARTIFACT_KIND: Record<FactSheet['artifacts'][number]['kind'], VisualKind> = {
  post: 'social_post',
  statement: 'web_page',
  document: 'document',
  headline: 'headline',
  paper: 'paper',
  filing: 'document',
  other: 'web_page',
};

/** Up to `n` words of a verbatim text: a short phrase measures better than a paragraph. */
export function phraseOf(text: string, n = 14): string {
  const words = text.trim().split(/\s+/);
  return words.length <= n ? text.trim() : words.slice(0, n).join(' ');
}

type CastLike = { name: string; kind: 'person' | 'company'; player_id: string | null; qid: string | null; role: string };

function mergedCast(pitch: Pitch, facts: FactSheet | null): CastLike[] {
  const out: CastLike[] = [];
  for (const m of [...(facts?.cast ?? []), ...pitch.cast]) {
    const found = out.find((x) => norm(x.name) === norm(m.name));
    const qid = 'qid' in m ? (m as { qid: string | null }).qid : null;
    if (found) {
      found.qid ??= qid;
      found.player_id ??= m.player_id;
      found.role ||= m.role;
    } else out.push({ name: m.name, kind: m.kind, player_id: m.player_id, qid, role: m.role ?? '' });
  }
  return out;
}

export type PlanOptions = { isNews: boolean; cutouts: readonly BankedCutout[] };

export function planWants(pitch: Pitch, facts: FactSheet | null, opts: PlanOptions): Want[] {
  const wants: Want[] = [];
  const add = (w: Omit<Want, 'qids' | 'people' | 'playerId' | 'key_moment'> & Partial<Pick<Want, 'qids' | 'people' | 'playerId' | 'key_moment'>>) =>
    wants.push({ qids: [], people: [], playerId: null, key_moment: false, ...w });
  const year = pitch.event_date?.slice(0, 4) ?? '';
  const sceneWords = new Set(contentWords(`${pitch.scene} ${pitch.turn}`));
  const overlapsScene = (text: string) => contentWords(text).filter((w) => sceneWords.has(w)).length >= 3;

  for (const m of mergedCast(pitch, facts)) {
    const player = playerOf(m);
    const s = slug(m.name);
    if (m.kind === 'person') {
      const cutout = opts.cutouts.find((c) => c.approved && ((player && c.id === player.id) || (m.qid && c.qid === m.qid) || norm(c.name) === norm(m.name)));
      const qid = m.qid ?? cutout?.qid ?? player?.qid ?? null;
      add({ id: `person:${s}`, kind: 'person_photo', what: `a photo of ${m.name}`, terms: m.name, people: [m.name], qids: qid ? [qid] : [], playerId: player?.id ?? null, context: m.role, sources: ['bank', 'wikidata', 'commons', 'serper'] });
      if (norm(m.name) === norm(pitch.central_figure)) {
        add({ id: `person-event:${s}`, kind: 'event_photo', what: `${m.name} around the time of the story`, terms: `${m.name} ${opts.isNews ? '' : year}`.trim(), people: [m.name], qids: qid ? [qid] : [], sources: ['serper'] });
      }
    } else {
      const qid = m.qid ?? player?.qid ?? null;
      add({ id: `company:${s}`, kind: 'logo', what: `${m.name}'s logo`, terms: m.name, qids: qid ? [qid] : [], playerId: player?.id ?? null, sources: ['logo'] });
      add({ id: `company-place:${s}`, kind: 'place_photo', what: `${m.name}'s headquarters or offices`, terms: `${m.name} headquarters`, qids: qid ? [qid] : [], sources: ['wikidata', 'commons'] });
    }
  }

  add({ id: 'moment', kind: 'event_photo', what: pitch.scene, terms: `${pitch.central_figure} ${contentWords(pitch.scene).slice(0, 6).join(' ')}`.trim(), people: [pitch.central_figure], key_moment: true, sources: ['serper', 'commons'] });

  pitch.expected_visuals.forEach((v, i) => {
    const sources = SEARCH_ROUTES[v.kind];
    if (!sources) return; // pages, posts, documents, maps and frames come from URLs and places below
    add({ id: `visual:${i + 1}`, kind: v.kind, what: v.what, terms: v.hint || v.what, key_moment: overlapsScene(v.what), sources });
  });

  const sources = new Map<string, { url: string; title: string; kind: string }>();
  for (const s of [...(facts?.sources ?? []), ...pitch.sources.map((s) => ({ ...s, kind: '' }))]) {
    if (/^https?:\/\//i.test(s.url) && !sources.has(urlKey(s.url))) sources.set(urlKey(s.url), { url: s.url, title: s.title, kind: s.kind });
  }
  let headlines = 0;
  [...sources.values()].forEach((s, i) => {
    if (youtubeId(s.url)) {
      add({ id: `video:${i + 1}`, kind: 'video_frame', what: `frames from ${s.title}`, terms: s.title, url: s.url, sources: ['video'] });
      return;
    }
    if (arxivId(s.url)) return; // papers come from the artifacts / arXiv pass below
    const owner = officialOwner(s.url);
    add({ id: `article:${i + 1}`, kind: 'event_photo', what: `images on "${s.title}"`, terms: s.title, url: s.url, sources: [owner ? 'newsroom' : 'article'] });
    if (owner && !isPostUrl(s.url)) {
      add({ id: `page:${i + 1}`, kind: 'web_page', what: `the ${owner} page "${s.title}"`, terms: s.title, url: s.url, phrases: [s.title], sources: ['screen'] });
    } else if (!isPostUrl(s.url) && headlines < 4) {
      headlines += 1;
      add({ id: `headline:${i + 1}`, kind: 'headline', what: `the headline "${s.title}"`, terms: s.title, url: s.url, phrases: [s.title], sources: ['screen'] });
    }
  });

  for (const a of facts?.artifacts ?? []) {
    const url = a.url ?? facts?.sources.find((s) => s.id === a.source_id)?.url ?? null;
    if (!url) continue;
    const id = arxivId(url);
    if (id) {
      add({ id: `paper:${a.id}`, kind: 'paper', what: `the paper's arXiv page`, terms: a.text, url: `https://arxiv.org/abs/${id}`, phrases: [phraseOf(a.text)], sources: ['paper'] });
      continue;
    }
    if (youtubeId(url)) continue;
    const kind = isPostUrl(url) ? 'social_post' : ARTIFACT_KIND[a.kind];
    add({ id: `artifact:${a.id}`, kind, what: `the ${a.kind} "${phraseOf(a.text, 10)}"`, terms: a.text, url, phrases: [phraseOf(a.text)], key_moment: overlapsScene(a.text), sources: [kind === 'document' ? 'document' : 'screen'] });
  }
  for (const s of sources.values()) {
    const id = arxivId(s.url);
    if (id && !wants.some((w) => w.url === `https://arxiv.org/abs/${id}`)) {
      add({ id: `paper:${id}`, kind: 'paper', what: `the paper "${s.title}"`, terms: s.title, url: `https://arxiv.org/abs/${id}`, phrases: [s.title], sources: ['paper'] });
    }
  }

  (facts?.places ?? []).forEach((p, i) => {
    add({ id: `place:${i + 1}`, kind: 'map', what: `a map of ${p.name}`, terms: p.address ?? p.name, place: p, sources: ['map'] });
    add({ id: `place-photo:${i + 1}`, kind: 'place_photo', what: `a photo of ${p.name}`, terms: p.name, place: p, sources: ['commons', 'openverse'] });
  });

  return wants;
}

// ── Cast coverage (MD-60): every person shown has an image; main characters get several looks ──

/** Target distinct portraits per person: main characters (the pitch's cast) want several looks, the rest one. */
export const MAIN_LOOKS = 4;
export const SUPPORT_LOOKS = 1;
/** Extra Serper searches per person still short after the first pass (cheapest sources ran first). */
export const TOPUP_QUERIES = 3;

export type CastPerson = { name: string; main: boolean; role: string; qid: string | null; playerId: string | null };

/** Every person in the story: the pitch's cast are the main characters, fact-sheet-only people support. */
export function castPeople(pitch: Pitch, facts: FactSheet | null): CastPerson[] {
  const main = new Set(pitch.cast.filter((m) => m.kind === 'person').map((m) => norm(m.name)));
  return mergedCast(pitch, facts)
    .filter((m) => m.kind === 'person')
    .map((m) => ({ name: m.name, main: main.has(norm(m.name)), role: m.role, qid: m.qid, playerId: m.player_id }));
}

/** Official hosts of the companies a person's role names (their bio and press pages hold the cleanest portraits). */
export function officialHostsFor(role: string): string[] {
  const text = norm(role);
  return OFFICIAL_DOMAINS.filter((c) => c.names.some((n) => new RegExp(`\\b${norm(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text))).flatMap((c) => c.paths.filter((p) => !p.path).map((p) => p.host));
}

/**
 * Second-pass wants for a person still short of their target: a portrait search, a search for them at
 * work (interview, stage) and, when their role names a company we know, that company's own site. Each is
 * one Serper query; results go through the same screens as the first pass.
 */
export function topUpWants(person: CastPerson, have: number): Want[] {
  const target = person.main ? MAIN_LOOKS : SUPPORT_LOOKS;
  if (have >= target) return [];
  const s = slug(person.name);
  const base = { kind: 'person_photo' as const, people: [person.name], qids: person.qid ? [person.qid] : [], playerId: person.playerId, key_moment: false, sources: ['serper' as SourceName], context: person.role };
  const terms = [`${person.name} portrait`, `${person.name} interview`, ...officialHostsFor(person.role).slice(0, 1).map((h) => `${person.name} site:${h}`)];
  return terms.slice(0, TOPUP_QUERIES).map((t, i) => ({ ...base, id: `person-look:${s}:${i + 1}`, what: `another photo of ${person.name}`, terms: t }));
}
