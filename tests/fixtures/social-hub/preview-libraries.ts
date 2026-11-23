/**
 * Fixture libraries for the development-only preview (/social/preview): the
 * music pool and photo bank as the hub reads them. No database.
 */
import type { FaceCheckState } from '@/lib/field-notes/photos/read';
import type { PhotoKind, PoolPhoto, PoolStatus } from '@/lib/field-notes/types';
import type { LibraryItem, LibraryPage, LibrarySummary } from '@/lib/media-library/read';
import type { MusicSong } from '@/lib/social-hub/queries/music';
import type { LibrariesModel } from '@/lib/social-hub/views/libraries';

const TITLES: Array<[string, string, string, number]> = [
  ['Midnight Drive', 'Neon Atlas', 'synthwave', 104], ['Paper Planes', 'Lumen', 'indie pop', 118], ['Low Tide', 'Harbor Lights', 'lo-fi', 82],
  ['Gold Rush', 'KAYO', 'hip hop', 94], ['Static Hearts', 'The Vellums', 'alt rock', 132], ['Sunday Loop', 'Mira Vale', 'house', 122],
  ['Glass City', 'Odessa Park', 'electronic', 110], ['Slow Motion', 'June & Arlo', 'r&b', 88], ['Overclocked', 'Bitwise', 'drum & bass', 174],
  ['Field Notes', 'Pale Fern', 'acoustic', 96], ['Afterglow', 'Solene', 'pop', 116], ['Run It Back', 'Dex Marlowe', 'hip hop', 90],
];

function songs(): MusicSong[] {
  const out: MusicSong[] = TITLES.map(([title, artist, genre, bpm], i) => ({
    audioId: `1800${String(i).padStart(10, '0')}`,
    type: 'music',
    title,
    artist,
    cover: null,
    durationMs: 30_000 + i * 1_000,
    trendingRank: i + 1,
    firstIngestedAt: `2026-10-0${1 + (i % 7)}T04:30:00Z`,
    lastSeenTrendingAt: '2026-10-08T04:30:00Z',
    genre,
    bpm,
    vibes: ['energetic', 'warm', 'driving', 'calm'].slice(i % 3, (i % 3) + 2),
    instruments: ['synth', 'drums'],
    tagged: i % 5 !== 4,
    uses: i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
    lastUsedAt: i % 4 === 0 ? '2026-10-07T14:00:00Z' : null,
  }));
  for (let i = 0; i < 6; i++) {
    out.push({
      audioId: `1900${String(i).padStart(10, '0')}`, type: 'original_sound', title: `Original sound · @creator${i + 1}`, artist: `@creator${i + 1}`,
      cover: null, durationMs: 15_000, trendingRank: i + 1, firstIngestedAt: '2026-10-06T04:30:00Z', lastSeenTrendingAt: '2026-10-08T04:30:00Z',
      genre: null, bpm: null, vibes: [], instruments: [], tagged: false, uses: 0, lastUsedAt: null,
    });
  }
  return out;
}

export function previewLibraries(): LibrariesModel {
  return {
    music: { present: true, songs: songs(), lastIngest: { status: 'ok', finishedAt: '2026-10-08T04:31:12Z', added: 3 } },
    photos: { present: true, stored: 1240, reusable: 812, addedLast7d: 38, lastAddedAt: '2026-10-08T07:12:00Z' },
  };
}

const SUBJECTS: Array<[string, string, string[], string[]]> = [
  ['Jensen Huang', 'headshot', ['portrait', 'stage', 'keynote'], ['person']],
  ['Nvidia headquarters', 'hq', ['building', 'campus', 'glass'], ['building']],
  ['Data center aisle', 'openverse', ['servers', 'racks', 'blue light'], ['data center']],
  ['Sam Altman', 'headshot', ['portrait', 'conference'], ['person']],
  ['Robot arm', 'stocksnap', ['robotics', 'factory', 'automation'], ['robotics']],
  ['European Parliament', 'commons', ['government', 'chamber', 'vote'], ['policy']],
  ['Microsoft logo', 'logo', ['logo', 'brand'], ['logo']],
  ['Laptop with code', 'openverse', ['code', 'screen', 'developer'], ['software']],
  ['Chip close-up', 'stocksnap', ['semiconductor', 'macro', 'hardware'], ['hardware']],
  ['California capitol', 'commons', ['government', 'building', 'sacramento'], ['policy']],
  ['Satya Nadella', 'headshot', ['portrait', 'stage'], ['person']],
  ['Apple Park', 'hq', ['building', 'campus', 'ring'], ['building']],
];

function swatch(i: number, label: string): string {
  const hues = [200, 220, 140, 280, 30, 0, 260, 180];
  const h = hues[i % hues.length];
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${h},28%,78%)'/><stop offset='1' stop-color='hsl(${h},32%,52%)'/></linearGradient></defs><rect width='400' height='300' fill='url(#g)'/><text x='200' y='280' text-anchor='middle' font-family='sans-serif' font-size='18' fill='white' opacity='0.85'>${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export type PreviewPhotoFilters = { tag?: string | null; lane?: string | null; used?: boolean | null };

export function previewPhotos(filters: PreviewPhotoFilters = {}): { page: LibraryPage; summary: LibrarySummary } {
  const all: LibraryItem[] = SUBJECTS.map(([subject, lane, tags, scenes], i) => ({
    id: `00000009-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    thumbUrl: swatch(i, subject),
    width: 400,
    height: 300,
    credit: lane === 'logo' || lane === 'hq' ? 'Image: company press kit' : i % 2 ? 'Photo: Wikimedia Commons, CC BY-SA 4.0' : 'Photo: Openverse, CC0',
    licence: lane === 'logo' || lane === 'hq' ? 'company' : 'open',
    reuseOk: !(lane === 'logo' || lane === 'hq'),
    tags,
    qids: lane === 'headshot' ? [`Q${1000 + i}`] : [],
    subjects: [subject],
    scenes,
    lanes: [lane],
    sources: [lane === 'headshot' || lane === 'commons' ? 'commons' : lane === 'logo' || lane === 'hq' ? 'official' : 'stock'],
    visionPass: true,
    status: 'stored',
    firstSeenAt: `2026-10-0${1 + (i % 7)}T07:00:00Z`,
    lastSeenAt: '2026-10-08T07:00:00Z',
    useCount: i % 3 === 0 ? 2 : i % 4 === 0 ? 1 : 0,
    lastUsedAt: i % 3 === 0 ? '2026-10-07T13:00:00Z' : null,
  }));
  const count = (key: (it: LibraryItem) => string[]) => {
    const m = new Map<string, number>();
    for (const it of all) for (const v of key(it)) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count);
  };
  const items = all.filter((it) =>
    (!filters.tag || it.tags.includes(filters.tag)) &&
    (!filters.lane || it.lanes.includes(filters.lane)) &&
    (filters.used == null || (it.useCount > 0) === filters.used));
  return {
    page: { items, total: items.length, page: 1, pageSize: 48, facets: { lanes: count((i) => i.lanes), sources: count((i) => i.sources), licences: count((i) => [i.licence]), tags: count((i) => i.tags) } },
    summary: { stored: 1240, reusable: 812, addedLast7d: 38, lastAddedAt: '2026-10-08T07:12:00Z', bySource: { commons: 520, stock: 480, official: 240 } },
  };
}

const FIELD_NOTES_POOL: Array<[string, PhotoKind, PoolStatus, FaceCheckState]> = [
  ['Laptop at the desk', 'working', 'live', 'none'],
  ['Whiteboard sketch', 'working', 'live', 'none'],
  ['Team at lunch', 'people', 'live', 'faces'],
  ['Office window', 'scenery', 'live', 'none'],
  ['Meetup stage', 'event', 'live', 'pending'],
  ['Terminal close-up', 'working', 'resting', 'none'],
  ['Coffee and notes', 'scenery', 'resting', 'none'],
  ['Screen with a client name', 'working', 'retired', 'none'],
];

/** Field Notes pool photos for the Photo Bank's Field Notes section in preview (read-only, swatch thumbnails). */
export function previewFieldNotesPool(): Array<PoolPhoto & { facesCheck: FaceCheckState; thumbUrl: string }> {
  return FIELD_NOTES_POOL.map(([label, kind, status, facesCheck], i) => ({
    photoId: `0000000f-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    uploadedBy: i % 2 ? 'lucas@heliosmarketing.org' : 'tommy@heliosmarketing.org',
    uploadedAt: `2026-10-0${8 - (i % 7)}T09:00:00.000Z`,
    status,
    lastUsedPostSeq: status === 'resting' ? 12 : null,
    rejectReason: status === 'retired' ? 'A readable private screen' : null,
    kind,
    opener: kind === 'people',
    facesCheck,
    thumbUrl: swatch(i, label),
  }));
}
