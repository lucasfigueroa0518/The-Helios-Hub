import { getJson } from './fetch';
import type { RawCandidate, Source, SourceRun } from './types';

/**
 * Places (research 04 §2.5): geocode with Nominatim (at most one request a second, a real User-Agent,
 * per the OSMF policy), then the kit's printed-map renderer (B4's `renderMap`). The map is ours, built
 * from OpenFreeMap tiles, so it is trusted and made.
 */

import { placeQueries } from '@/lib/reel-ai-drama/development/visuals-check';

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const NOMINATIM_GAP_MS = 1100;
/** Process-wide and serialized: the policy is per client, not per harvest, and lookups may run in parallel. */
export const nominatimGate: { last: number; chain: Promise<void> } = { last: 0, chain: Promise.resolve() };

export async function geocode(run: Pick<SourceRun, 'deps'>, query: string): Promise<{ lat: number; lon: number; display: string } | null> {
  const sleep = run.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const turn = nominatimGate.chain.then(async () => {
    const wait = nominatimGate.last + NOMINATIM_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    nominatimGate.last = Date.now();
  });
  nominatimGate.chain = turn.catch(() => undefined);
  await turn;
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const hits = await getJson<{ lat: string; lon: string; display_name: string }[]>(run.deps.http, url.toString());
  const hit = hits[0];
  return hit ? { lat: Number(hit.lat), lon: Number(hit.lon), display: hit.display_name } : null;
}

export const MAP_CREDIT = 'Map data © OpenStreetMap contributors · OpenFreeMap';

export const mapSource: Source = async (want, run) => {
  const place = want.place;
  if (!place) return [];
  if (!run.deps.renderMap) {
    const note = 'maps: skipped (no map renderer)';
    if (!run.notes.includes(note)) run.notes.push(note);
    return [];
  }
  let lat = place.lat;
  let lon = place.lon;
  if (lat === null || lon === null) {
    // Places come in prose ("the X", "offices in Y"): try the name, then the town it names (placeQueries).
    let hit: Awaited<ReturnType<typeof geocode>> = null;
    for (const q of placeQueries(place.address ?? place.name)) {
      hit = await geocode(run, q);
      if (hit) break;
    }
    if (!hit) {
      run.notes.push(`geocode "${place.address ?? place.name}": not found`);
      return [];
    }
    ({ lat, lon } = hit);
  }
  const out = run.nextName('png');
  await run.deps.renderMap({ lat, lon, zoom: place.address ? 15 : 12, label: place.name, sublabel: place.address ?? place.role, out });
  const candidate: RawCandidate = {
    source: 'map',
    want: want.id,
    kind: 'map',
    url: null,
    localFile: out,
    source_page: null,
    credit: MAP_CREDIT,
    license: 'ODbL',
    caption: `Map of ${place.name}`,
    people: [],
    qids: [],
    place: place.name,
    date_taken: null,
    date_basis: 'unknown',
    character_image: false,
    made: true,
    trusted: true,
    shows: `A printed-style map with a pin on ${place.name}${place.address ? ` (${place.address})` : ''} at ${lat.toFixed(4)}, ${lon.toFixed(4)}.`,
    flags: [],
  };
  return [candidate];
};
