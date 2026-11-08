import type { BankedCutout } from '@/lib/real-case/bank';
import { OFFICIAL_DOMAINS } from '@/lib/social/photos/official-domains';
import { BLUE_CHIP_PLAYERS, bluePlayer, type BluePlayer } from '@/lib/social-hub/blue-chip-players';
import { siteOf, urlKey } from '@/lib/reel-ai-drama/reporting/validate';
import { pitchBrief, pitchCentral, type CastMember, type FactSheet, type Pitch, type VisualKind } from '@/lib/reel-ai-drama/types';

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

type CastLike = { name: string; kind: 'person' | 'company' | 'product'; player_id: string | null; qid: string | null; role: string };

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

/** The pitch's key moment: its old `scene`, else the brief's first sentence (MD-100: the brief carries the story). */
export function pitchMoment(pitch: Pitch): string {
  if (pitch.scene?.trim()) return pitch.scene.trim();
  const brief = pitchBrief(pitch);
  return (brief.match(/^.*?[.!?](\s|$)/)?.[0] ?? brief).trim();
}

export function planWants(pitch: Pitch, facts: FactSheet | null, opts: PlanOptions): Want[] {
  const wants: Want[] = [];
  const add = (w: Omit<Want, 'qids' | 'people' | 'playerId' | 'key_moment'> & Partial<Pick<Want, 'qids' | 'people' | 'playerId' | 'key_moment'>>) =>
    wants.push({ qids: [], people: [], playerId: null, key_moment: false, ...w });
  const year = pitch.event_date?.slice(0, 4) ?? '';
  const moment = pitchMoment(pitch);
  const central = pitchCentral(pitch);
  const sceneWords = new Set(contentWords(`${moment} ${pitch.turn ?? ''}`));
  const overlapsScene = (text: string) => contentWords(text).filter((w) => sceneWords.has(w)).length >= 3;

  for (const m of mergedCast(pitch, facts)) {
    const player = playerOf(m);
    const s = slug(m.name);
    if (m.kind === 'person') {
      const cutout = opts.cutouts.find((c) => c.approved && ((player && c.id === player.id) || (m.qid && c.qid === m.qid) || norm(c.name) === norm(m.name)));
      const qid = m.qid ?? cutout?.qid ?? player?.qid ?? null;
      add({ id: `person:${s}`, kind: 'person_photo', what: `a photo of ${m.name}`, terms: m.name, people: [m.name], qids: qid ? [qid] : [], playerId: player?.id ?? null, context: m.role, sources: ['bank', 'wikidata', 'commons', 'serper'] });
      if (norm(m.name) === norm(central)) {
        add({ id: `person-event:${s}`, kind: 'event_photo', what: `${m.name} around the time of the story`, terms: `${m.name} ${opts.isNews ? '' : year}`.trim(), people: [m.name], qids: qid ? [qid] : [], sources: ['serper'] });
      }
    } else if (m.kind === 'product') {
      // A product is a player too (MD-135): its mark, and a photo of the thing itself.
      add({ id: `product-logo:${s}`, kind: 'logo', what: `${m.name}'s logo`, terms: m.name, qids: player?.qid ? [player.qid] : [], playerId: player?.id ?? null, sources: ['logo'] });
      add({ id: `product:${s}`, kind: 'product', what: `a clear picture of ${m.name}, the product itself`, terms: m.name, sources: SEARCH_ROUTES.product! });
    } else {
      const qid = m.qid ?? player?.qid ?? null;
      add({ id: `company:${s}`, kind: 'logo', what: `${m.name}'s logo`, terms: m.name, qids: qid ? [qid] : [], playerId: player?.id ?? null, sources: ['logo'] });
      add({ id: `company-place:${s}`, kind: 'place_photo', what: `${m.name}'s headquarters or offices`, terms: `${m.name} headquarters`, qids: qid ? [qid] : [], sources: ['wikidata', 'commons'] });
    }
  }

  add({ id: 'moment', kind: 'event_photo', what: moment, terms: `${central} ${contentWords(moment).slice(0, 6).join(' ')}`.trim(), people: central ? [central] : [], key_moment: true, sources: ['serper', 'commons'] });

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

// ── Cast coverage (MD-60, MD-68, MD-75): every named person is shown; central people get many real looks ──

/** Verified, distinct portraits wanted per central person (MD-68: different years, settings, expressions). */
export const CENTRAL_LOOKS = 6;
/** Verified portraits wanted per other named person (at least one; MD-75: everyone named is shown). */
export const NAMED_LOOKS = 3;
/** Central people: the central figure plus the cast the facts are most about. */
export const CENTRAL_MAX = 3;
/** Serper searches per person per top-up round (Commons category search is free and comes on top). */
export const TOPUP_QUERIES = 3;
export const TOPUP_QUERIES_CENTRAL = 6;

export type CastPerson = { name: string; main: boolean; central: boolean; role: string; qid: string | null; playerId: string | null };

/** How many facts name `name` (full name or a surname of five letters or more). */
function factMentions(facts: FactSheet, name: string): number {
  const n = norm(name);
  const last = (n.split(' ').pop() ?? '').replace(/[^a-z0-9]/g, '');
  const re = n.includes(' ') && last.length >= 5 ? new RegExp(`\\b${last}\\b`) : null;
  return facts.facts.filter((f) => {
    const t = norm(f.text);
    return t.includes(n) || (re ? re.test(t) : false);
  }).length;
}

/**
 * The people the plot turns on (MD-75: naming is not centring). The writer's `central` list wins when there
 * is one (MD-100). Otherwise: the pitch's central person (`pitchCentral`), then the cast people the fact sheet
 * mentions most (at least three facts each); before the facts exist, the pitch cast people its brief (or old
 * scene and turn) names. At most three.
 */
export function centralPeople(pitch: Pitch, facts: FactSheet | null, writerCentral?: readonly string[] | null): string[] {
  const people = mergedCast(pitch, facts).filter((m) => m.kind === 'person');
  const known = (name: string) => people.find((m) => norm(m.name) === norm(name))?.name ?? null;
  if (writerCentral?.length) return [...new Set(writerCentral.map((n) => known(n) ?? n))];
  const out: string[] = [];
  const add = (name: string | null) => {
    if (name && out.length < CENTRAL_MAX && !out.some((x) => norm(x) === norm(name))) out.push(name);
  };
  const lead = pitchCentral(pitch);
  add(known(lead) ?? (lead || null));
  if (facts) {
    people
      .map((m) => ({ name: m.name, n: factMentions(facts, m.name) }))
      .filter((x) => x.n >= 3)
      .sort((a, b) => b.n - a.n)
      .forEach((x) => add(x.name));
  } else {
    const plot = pitch.scene || pitch.turn ? `${pitch.scene ?? ''} ${pitch.turn ?? ''}` : pitchBrief(pitch);
    for (const m of pitch.cast.filter((c) => c.kind === 'person')) {
      const last = norm(m.name).split(' ').pop() ?? '';
      if (norm(plot).includes(norm(m.name)) || (last.length >= 5 && new RegExp(`\\b${last}\\b`).test(norm(plot)))) add(m.name);
    }
  }
  return out;
}

/**
 * Every named person in the story (pitch cast and fact-sheet cast): the pitch's cast are main characters,
 * and `central` (default `centralPeople`) marks who the plot turns on.
 */
export function castPeople(pitch: Pitch, facts: FactSheet | null, central: readonly string[] = centralPeople(pitch, facts)): CastPerson[] {
  const main = new Set(pitch.cast.filter((m) => m.kind === 'person').map((m) => norm(m.name)));
  const isCentral = new Set(central.map(norm));
  return mergedCast(pitch, facts)
    .filter((m) => m.kind === 'person')
    .map((m) => ({ name: m.name, main: main.has(norm(m.name)), central: isCentral.has(norm(m.name)), role: m.role, qid: m.qid, playerId: m.player_id }));
}

/** Verified portraits a person should end the harvest with. */
export const lookTarget = (p: Pick<CastPerson, 'central'>): number => (p.central ? CENTRAL_LOOKS : NAMED_LOOKS);

/** Official hosts of the companies a person's role names (their bio and press pages hold the cleanest portraits). */
export function officialHostsFor(role: string): string[] {
  const text = norm(role);
  return OFFICIAL_DOMAINS.filter((c) => c.names.some((n) => new RegExp(`\\b${norm(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text))).flatMap((c) => c.paths.filter((p) => !p.path).map((p) => p.host));
}

/** Search phrasings per round, so each round reaches different pictures (portraits, work, stage, press, years). */
function topUpTerms(person: CastPerson, round: 1 | 2, year: string): string[] {
  const n = person.name;
  const site = officialHostsFor(person.role).slice(0, 1).map((h) => `${n} site:${h}`);
  if (round === 1) return person.central ? [`${n} portrait`, `${n} interview`, ...site, `${n} speaking on stage`, `${n} keynote`, `${n} press photo`] : [`${n} portrait`, `${n} interview`, ...site];
  return [`${n} photo`, ...(year ? [`${n} ${year}`] : []), `${n} conference`, `${n} headshot`, `${n} panel discussion`, `${n} candid`];
}

/**
 * Top-up wants for a person still short of verified portraits (`lookTarget`): their Commons category
 * (free, captioned files) and Serper phrasings for this round (`round` 2 reaches further, for central people
 * still short). Each Serper want is one query; results go through the same screens as the first pass.
 */
export function topUpWants(person: CastPerson, have: { verified: number }, opts: { round?: 1 | 2; year?: string } = {}): Want[] {
  const round = opts.round ?? 1;
  if (have.verified >= lookTarget(person)) return [];
  const s = slug(person.name);
  const base = { kind: 'person_photo' as const, people: [person.name], qids: person.qid ? [person.qid] : [], playerId: person.playerId, key_moment: false, context: person.role };
  const n = person.central ? TOPUP_QUERIES_CENTRAL : TOPUP_QUERIES;
  const searches = topUpTerms(person, round, opts.year ?? '')
    .slice(0, n)
    .map((t, i): Want => ({ ...base, id: `person-look:${s}:${round === 1 ? '' : 'r2-'}${i + 1}`, what: `another photo of ${person.name}`, terms: t, sources: ['serper'] }));
  const category: Want[] = round === 1 ? [{ ...base, id: `person-cat:${s}`, what: `another photo of ${person.name}`, terms: `incategory:"${person.name}"`, sources: ['commons'] }] : [];
  return [...category, ...searches];
}
