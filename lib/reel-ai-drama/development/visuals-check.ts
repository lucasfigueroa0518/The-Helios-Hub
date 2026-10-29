import type Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { logoForPlayerId } from '@/lib/social-hub/logo-bank';
import { VISUAL_KINDS, type Pitch, type VisualKind, type VisualsCard, type VisualsGrade } from '@/lib/reel-ai-drama/types';
import { appendJsonl } from '@/lib/reel-ai-drama/development/log';
import { bankedPerson, norm, playerIdForName } from '@/lib/reel-ai-drama/development/util';

/**
 * The visuals check (PROCESS.md D6, research 04 §6): a cheap proof that real material exists, run only
 * on pitches that cleared both Jev bars. Free signals first (Commons depth per cast member, the logo
 * bank, geocodable places, screenshot-able sources), then 1–2 Serper image searches when a key is set,
 * then one optional Haiku look at the hits. Every outside call is an injected dep; the whole check stays
 * under `capUsd` (Lucas: "definitely under thirty five cents"; research estimates ~$0.003).
 */

export type ImageHit = { url: string; thumbnail: string | null; width: number; height: number; domain: string; title: string; page: string | null };

export type LookTile = { index: number; usable: boolean; watermark: boolean; ai_art: boolean; relevant: boolean; kind: VisualKind | null; note: string };

export type CostLine = {
  vendor: 'serper' | 'anthropic';
  usd: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type VisualsCheckDeps = {
  /** Commons files depicting a QID (`haswbstatement:P180=Q…` total hits). */
  commonsDepth: (qid: string) => Promise<number>;
  /** A Wikidata QID for a name, when the cutout bank has none. */
  wikidataQid: (name: string) => Promise<string | null>;
  /** Coordinates for a place name, or null. */
  geocode?: ((place: string) => Promise<{ lat: number; lon: number } | null>) | null;
  /** Serper image search; null when SERPER_API_KEY is not set (skipped and noted). */
  imageSearch?: ((query: string) => Promise<{ hits: ImageHit[]; usd: number }>) | null;
  /** One Haiku look at the hits; null to skip. */
  look?: ((input: { pitch: Pitch; hits: ImageHit[] }) => Promise<{ tiles: LookTile[]; cost: CostLine }>) | null;
  /** Banked person lookup (defaults to the cutout bank). */
  banked?: (name: string, playerId: string | null) => { qid: string | null; cutout: boolean } | null;
  /** Whether the logo bank holds a logo for a player id (defaults to the shared logo bank). */
  hasLogo?: (playerId: string) => boolean;
  /** Every paid call, for the cost ledger. */
  record?: (line: CostLine) => Promise<void>;
};

/** Estimated prices for the cap check before each paid step. */
export const SERPER_QUERY_USD = 0.001;
export const LOOK_ESTIMATE_USD = 0.01;
export const MAX_IMAGE_QUERIES = 2;
export const MAX_LOOK_TILES = 12;

/** Research 04 gates. */
export const MIN_SPECIFIC = 3;
export const MIN_KINDS = 4;

const STOCK_DOMAINS = /(gettyimages|shutterstock|alamy|istockphoto|dreamstime|depositphotos|123rf|stock\.adobe|adobestock|pond5|agefotostock|bigstockphoto|vectorstock|freepik)\./i;
const SOCIAL = /(^|\.)(x\.com|twitter\.com|threads\.net|bsky\.app|linkedin\.com|facebook\.com|instagram\.com|youtube\.com|reddit\.com)$/i;
const DOCUMENT = /(sec\.gov|courtlistener\.com|uscourts\.gov|justice\.gov|regulations\.gov|federalregister\.gov|\.pdf($|\?))/i;
const PAPER = /(arxiv\.org|openreview\.net|aclanthology\.org|nature\.com\/articles|science\.org\/doi|proceedings\.)/i;

const MIN_SHORT_SIDE = 600;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Sources by the visual each one gives (a screenshot of a page, post, document or paper). */
export function classifySources(p: Pitch): Partial<Record<VisualKind, number>> {
  const counts: Partial<Record<VisualKind, number>> = {};
  const add = (k: VisualKind) => (counts[k] = (counts[k] ?? 0) + 1);
  const seen = new Set<string>();
  for (const s of p.sources) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    const host = hostOf(s.url);
    if (!host) continue;
    if (SOCIAL.test(host)) add('social_post');
    else if (PAPER.test(s.url)) add('paper');
    else if (DOCUMENT.test(s.url)) add('document');
    else {
      add('web_page');
      if (s.publisher) add('headline');
    }
  }
  return counts;
}

/** Places to geocode: what the pitch expects a place photo or map of. */
export function placesOf(p: Pitch): string[] {
  return [...new Set(p.expected_visuals.filter((v) => v.kind === 'place_photo' || v.kind === 'map').map((v) => v.hint || v.what))].slice(0, 3);
}

/** 1–2 image queries from the pitch's own hints for story-specific pictures. */
export function imageQueries(p: Pitch): string[] {
  const specific: VisualKind[] = ['event_photo', 'place_photo', 'object', 'product', 'archival', 'video_frame'];
  const hints = p.expected_visuals.filter((v) => specific.includes(v.kind)).map((v) => (v.hint || v.what).trim()).filter(Boolean);
  const out = [...new Set(hints)].slice(0, MAX_IMAGE_QUERIES);
  if (out.length === 0) out.push(`${p.central_figure} ${p.event_date?.slice(0, 4) ?? ''}`.trim());
  return out;
}

export type Gates = { faces: boolean; specific: boolean; kinds: boolean };

/** Green: all gates. Red: too few story-specific visuals, or both other gates miss. Amber otherwise. */
export function gradeCard(g: Gates): VisualsGrade {
  if (!g.specific) return 'red';
  if (g.faces && g.kinds) return 'green';
  if (!g.faces && !g.kinds) return 'red';
  return 'amber';
}

const defaultHasLogo = (playerId: string) => !!logoForPlayerId(playerId);

export async function checkVisuals(deps: VisualsCheckDeps, pitch: Pitch, capUsd: number): Promise<VisualsCard> {
  const banked = deps.banked ?? bankedPerson;
  const hasLogo = deps.hasLogo ?? defaultHasLogo;
  const counts: Partial<Record<VisualKind, number>> = {};
  const add = (k: VisualKind, n: number) => {
    if (n > 0) counts[k] = (counts[k] ?? 0) + n;
  };
  const gaps: string[] = [];
  let usd = 0;
  const spend = async (line: CostLine) => {
    usd += line.usd;
    await deps.record?.(line);
  };

  // 1 · Faces: Commons depth per person in the cast (QIDs from the cutout bank, else Wikidata).
  const faces: VisualsCard['faces'] = [];
  for (const member of pitch.cast.filter((c) => c.kind === 'person')) {
    const bank = banked(member.name, member.player_id);
    let qid = bank?.qid ?? null;
    let count = bank?.cutout ? 1 : 0;
    try {
      qid ??= await deps.wikidataQid(member.name);
      if (qid) count += await deps.commonsDepth(qid);
    } catch (e) {
      gaps.push(`photo lookup failed for ${member.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    faces.push({ name: member.name, found: count > 0, count });
    add('person_photo', count);
  }

  // 2 · Logos for every company in the cast and every blue-chip person's company.
  const logos = new Set<string>();
  for (const member of pitch.cast) {
    const id = member.player_id ?? playerIdForName(member.name);
    if (id && hasLogo(id)) logos.add(id);
  }
  add('logo', logos.size);

  // 3 · Places that geocode → a printed map is possible.
  if (deps.geocode) {
    for (const place of placesOf(pitch)) {
      try {
        if (await deps.geocode(place)) add('map', 1);
        else gaps.push(`could not place "${place}" on a map`);
      } catch {
        gaps.push(`geocoding failed for "${place}"`);
      }
    }
  }

  // 4 · Screenshot-able sources.
  for (const [k, n] of Object.entries(classifySources(pitch))) add(k as VisualKind, n ?? 0);

  // 5 · Story-specific pictures: 1–2 Serper image searches, then one optional Haiku look.
  const hits: ImageHit[] = [];
  if (!deps.imageSearch) {
    gaps.push('image search skipped: SERPER_API_KEY is not set');
  } else {
    for (const q of imageQueries(pitch)) {
      if (usd + SERPER_QUERY_USD > capUsd) {
        gaps.push('image search stopped at the cost cap');
        break;
      }
      try {
        const res = await deps.imageSearch(q);
        await spend({ vendor: 'serper', usd: res.usd });
        hits.push(...res.hits);
      } catch (e) {
        gaps.push(`image search failed for "${q}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const seen = new Set<string>();
  const candidates = hits
    .filter((h) => !STOCK_DOMAINS.test(h.domain) && Math.min(h.width, h.height) >= MIN_SHORT_SIDE)
    .filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)))
    .slice(0, MAX_LOOK_TILES);

  let specificImages = 0;
  const sample: VisualsCard['sample'] = [];
  if (candidates.length) {
    let looked = false;
    if (deps.look && usd + LOOK_ESTIMATE_USD <= capUsd) {
      try {
        const { tiles, cost } = await deps.look({ pitch, hits: candidates });
        await spend(cost);
        looked = true;
        for (const t of tiles) {
          const hit = candidates[t.index];
          if (!hit || !t.usable || !t.relevant || t.watermark || t.ai_art) continue;
          specificImages += 1;
          const kind = t.kind && (VISUAL_KINDS as readonly string[]).includes(t.kind) ? t.kind : 'event_photo';
          add(kind, 1);
          if (sample.length < 6) sample.push({ url: hit.thumbnail ?? hit.url, kind, what: t.note || hit.title });
        }
      } catch (e) {
        gaps.push(`the image look failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (deps.look) {
      gaps.push('image look skipped at the cost cap');
    }
    if (!looked) {
      // Unverified hits: count only those whose title names someone in the cast, at half weight.
      const surnames = pitch.cast.map((c) => norm(c.name).split(' ').pop()!).filter((s) => s.length > 2);
      const named = candidates.filter((h) => surnames.some((s) => norm(h.title).includes(s)));
      specificImages = Math.floor(named.length / 2);
      add('event_photo', specificImages);
      for (const h of named.slice(0, 6)) sample.push({ url: h.thumbnail ?? h.url, kind: 'event_photo', what: h.title });
    }
  } else if (deps.imageSearch) {
    gaps.push('no usable story pictures in the image search');
  }

  // Story-specific: the pictures plus posts, documents, papers and (up to 3) pages from the sources.
  const specific =
    specificImages + (counts.social_post ?? 0) + (counts.document ?? 0) + (counts.paper ?? 0) + Math.min(3, counts.web_page ?? 0);
  const kinds = (VISUAL_KINDS as readonly VisualKind[]).filter((k) => (counts[k] ?? 0) > 0);

  const centralFace = pitch.cast.find((c) => norm(c.name) === norm(pitch.central_figure));
  const facesGate = centralFace?.kind === 'company'
    ? logos.has(centralFace.player_id ?? playerIdForName(centralFace.name) ?? '')
    : faces.some((f) => norm(f.name) === norm(pitch.central_figure) && f.found);
  if (!facesGate) gaps.push(`no photo found of the central figure, ${pitch.central_figure}`);
  if (specific < MIN_SPECIFIC) gaps.push(`only ${specific} visuals specific to this story (need ${MIN_SPECIFIC})`);
  if (kinds.length < MIN_KINDS) gaps.push(`only ${kinds.length} kinds of visual (need ${MIN_KINDS})`);

  return {
    grade: gradeCard({ faces: facesGate, specific: specific >= MIN_SPECIFIC, kinds: kinds.length >= MIN_KINDS }),
    faces,
    specific_count: specific,
    kinds,
    counts,
    gaps,
    sample,
    usd: Math.round(usd * 1e6) / 1e6,
  };
}

// ── Live deps (never called by tests) ───────────────────────────────────────

type Http = typeof fetch;

const UA = 'HeliosHub-ReelAiDrama/1.0 (+https://heliosgroup.tech)';

export function liveCommonsDepth(http: Http = fetch) {
  return async (qid: string): Promise<number> => {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P180=${qid}`)}&srnamespace=6&srlimit=1&format=json`;
    const res = await http(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`commons ${res.status}`);
    const body = (await res.json()) as { query?: { searchinfo?: { totalhits?: number } } };
    const depicted = Number(body.query?.searchinfo?.totalhits ?? 0);
    if (depicted > 0) return depicted;
    // Many Commons photos carry no "depicts" statement; a Wikidata main image (P18) still proves a face exists.
    const ent = await http(`https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(qid)}&property=P18&format=json`, { headers: { 'User-Agent': UA } });
    if (!ent.ok) return 0;
    const claims = (await ent.json()) as { claims?: { P18?: unknown[] } };
    return claims.claims?.P18?.length ?? 0;
  };
}

export function liveWikidataQid(http: Http = fetch) {
  return async (name: string): Promise<string | null> => {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=1&format=json`;
    const res = await http(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`wikidata ${res.status}`);
    const body = (await res.json()) as { search?: { id?: string }[] };
    return body.search?.[0]?.id ?? null;
  };
}

/** Nominatim: one request per second and a User-Agent (its usage policy). */
export function liveGeocode(http: Http = fetch) {
  let last = 0;
  return async (place: string): Promise<{ lat: number; lon: number } | null> => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    // Pitches describe places in prose ("the X", "X's offices in Y"): try the name, then the town it names.
    for (const q of placeQueries(place)) {
      const res = await http(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`, { headers: { 'User-Agent': UA } });
      if (!res.ok) throw new Error(`nominatim ${res.status}`);
      const body = (await res.json()) as { lat?: string; lon?: string }[];
      if (body[0]?.lat) return { lat: Number(body[0].lat), lon: Number(body[0].lon) };
      await new Promise((r) => setTimeout(r, 1100));
    }
    return null;
  };
}

/** Geocoding queries for a place described in prose, most specific first. */
export function placeQueries(place: string): string[] {
  const name = place.trim().replace(/^(the|a|an)\s+/i, '');
  const out = [name];
  const inPart = name.match(/\b(?:in|at|near)\s+(.+)$/i)?.[1];
  if (inPart) out.push(inPart);
  const lastComma = name.includes(',') ? name.slice(name.lastIndexOf(',') + 1).trim() : null;
  if (lastComma) out.push(lastComma);
  return [...new Set(out.filter((q) => q.length > 2))].slice(0, 3);
}

export function liveSerperImages(apiKey: string, http: Http = fetch) {
  return async (query: string): Promise<{ hits: ImageHit[]; usd: number }> => {
    const res = await http('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 20 }),
    });
    if (!res.ok) throw new Error(`serper ${res.status}`);
    const body = (await res.json()) as { images?: Record<string, unknown>[] };
    appendJsonl('visuals-serper', { query, count: body.images?.length ?? 0 });
    const hits = (body.images ?? []).map((i) => ({
      url: String(i.imageUrl ?? ''),
      thumbnail: typeof i.thumbnailUrl === 'string' ? i.thumbnailUrl : null,
      width: Number(i.imageWidth ?? 0),
      height: Number(i.imageHeight ?? 0),
      domain: String(i.domain ?? hostOf(String(i.link ?? i.imageUrl ?? ''))),
      title: String(i.title ?? ''),
      page: typeof i.link === 'string' ? i.link : null,
    })).filter((h) => h.url);
    return { hits, usd: SERPER_QUERY_USD };
  };
}

export const SUBMIT_LOOK_TOOL = {
  name: 'submit_look',
  description: 'Submit one verdict per numbered image, then stop.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['tiles'],
    properties: {
      tiles: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'usable', 'watermark', 'ai_art', 'relevant', 'kind', 'note'],
          properties: {
            index: { type: 'integer' },
            usable: { type: 'boolean' },
            watermark: { type: 'boolean' },
            ai_art: { type: 'boolean' },
            relevant: { type: 'boolean' },
            kind: { anyOf: [{ type: 'string', enum: [...VISUAL_KINDS] }, { type: 'null' }] },
            note: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

/**
 * The Haiku look: the hits' thumbnails as numbered image blocks (Serper thumbnails are small and
 * reliably fetchable). The prompt (`visuals-look`, B3) is the cached system; the images are the suffix.
 */
export function liveLook(client: Anthropic, opts: { model: string; prompt: string }) {
  return async ({ pitch, hits }: { pitch: Pitch; hits: ImageHit[] }): Promise<{ tiles: LookTile[]; cost: CostLine }> => {
    const content: Anthropic.ContentBlockParam[] = [
      {
        type: 'text',
        text: JSON.stringify({
          story: { title: pitch.title, logline: pitch.logline, event_date: pitch.event_date, cast: pitch.cast.map((c) => c.name) },
          tiles: hits.map((h, index) => ({ index, title: h.title, domain: h.domain })),
        }),
      },
      ...hits.flatMap((h, index): Anthropic.ContentBlockParam[] => [
        { type: 'text', text: `Image ${index}` },
        { type: 'image', source: { type: 'url', url: h.thumbnail ?? h.url } },
      ]),
    ];
    const message = await client.messages.create({
      model: opts.model,
      max_tokens: 2000,
      tools: [SUBMIT_LOOK_TOOL] as unknown as Anthropic.Tool[],
      tool_choice: { type: 'auto' },
      system: cachedSystemText(opts.prompt),
      messages: [{ role: 'user', content }],
    });
    appendJsonl('visuals-look', { model: message.model, stop_reason: message.stop_reason, usage: message.usage, content: message.content });
    const call = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_LOOK_TOOL.name);
    const usd = Number(priceAnthropicMessages([message as unknown as MessageUsageLike], { modelId: message.model || opts.model }).costUsd);
    const cost: CostLine = {
      vendor: 'anthropic',
      usd,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    const tiles = ((call?.input as { tiles?: LookTile[] } | undefined)?.tiles ?? []).filter((t) => Number.isInteger(t.index));
    return { tiles, cost };
  };
}

/** Every live dep wired; a missing Serper key leaves image search off (noted on the card). */
export function liveVisualsCheckDeps(opts: {
  http?: Http;
  serperApiKey?: string | null;
  client?: Anthropic | null;
  visionModel: string;
  lookPrompt?: string | null;
  record?: VisualsCheckDeps['record'];
}): VisualsCheckDeps {
  const http = opts.http ?? fetch;
  return {
    commonsDepth: liveCommonsDepth(http),
    wikidataQid: liveWikidataQid(http),
    geocode: liveGeocode(http),
    imageSearch: opts.serperApiKey ? liveSerperImages(opts.serperApiKey, http) : null,
    look: opts.client && opts.lookPrompt ? liveLook(opts.client, { model: opts.visionModel, prompt: opts.lookPrompt }) : null,
    record: opts.record,
  };
}
