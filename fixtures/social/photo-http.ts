/**
 * Offline stand-in for Wikidata, Wikimedia Commons, the Wikidata query
 * service and Openverse, for the M5 photo tests. Unknown requests throw,
 * so a test can never reach the network.
 */
export type FakeEntity = {
  id: string;
  label: string;
  description: string;
  human: boolean;
  organization: boolean;
  /** Commons files: the first is P18, the rest are P180 depicts. */
  files: string[];
};

export type FakeWeb = {
  /** wbsearchentities: search text → entity ids, in result order. */
  search: Record<string, string[]>;
  entities: Record<string, FakeEntity>;
  /** Openverse: how many results each query returns (default 2). */
  stockCount?: Record<string, number>;
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export const commonsUrl = (file: string) => `https://upload.wikimedia.org/${slug(file)}.jpg`;
export const stockUrl = (query: string, n: number) => `https://stock.example/${slug(query)}-${n}.jpg`;

export function createFakeHttp(web: FakeWeb): { http: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const http = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    const p = url.searchParams;
    if (url.hostname === 'www.wikidata.org' && p.get('action') === 'wbsearchentities') {
      const ids = web.search[p.get('search') ?? ''] ?? [];
      return json({ search: ids.map((id) => ({ id, label: web.entities[id]!.label, description: web.entities[id]!.description })) });
    }
    if (url.hostname === 'www.wikidata.org' && p.get('action') === 'wbgetentities') {
      const id = p.get('ids')!;
      const e = web.entities[id];
      const claims = e?.files[0] ? { P18: [{ mainsnak: { datavalue: { value: e.files[0] } } }] } : {};
      return json({ entities: { [id]: { claims } } });
    }
    if (url.hostname === 'commons.wikimedia.org' && p.get('list') === 'search') {
      const id = /P180=(Q\d+)/.exec(p.get('srsearch') ?? '')?.[1] ?? '';
      return json({ query: { search: (web.entities[id]?.files.slice(1) ?? []).map((f) => ({ title: `File:${f}` })) } });
    }
    if (url.hostname === 'commons.wikimedia.org' && p.get('prop') === 'imageinfo') {
      const pages: Record<string, unknown> = {};
      (p.get('titles') ?? '').split('|').forEach((title, i) => {
        pages[String(i)] = {
          title,
          imageinfo: [{
            url: commonsUrl(title.replace(/^File:/, '')),
            width: 2000,
            height: 2500,
            mime: 'image/jpeg',
            extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="#">Gage Skidmore</a>' } },
          }],
        };
      });
      return json({ query: { pages } });
    }
    if (url.hostname === 'query.wikidata.org') {
      const id = /wd:(Q\d+) wdt:P31 wd:Q5/.exec(p.get('query') ?? '')?.[1] ?? '';
      const e = web.entities[id];
      return json({ results: { bindings: [{ human: { value: String(!!e?.human) }, org: { value: String(!!e?.organization) } }] } });
    }
    if (url.hostname === 'api.openverse.org') {
      const q = p.get('q') ?? '';
      const n = web.stockCount?.[q] ?? 2;
      return json({
        results: Array.from({ length: n }, (_, i) => ({
          url: stockUrl(q, i + 1), foreign_landing_url: 'https://flickr.example', mime_type: 'image/jpeg',
          width: 2400, height: 1600, license: 'by', creator: 'Jane Doe', source: 'flickr', title: `${q} ${i + 1}`,
        })),
      });
    }
    throw new Error(`fake http: unexpected request ${url.href}`);
  }) as typeof fetch;
  return { http, calls };
}

/** Wikidata as the fixture story needs it. */
export const SIF_WEB: FakeWeb = {
  search: {
    'Donald Trump': ['Q22686'],
    'Jay Clayton': ['Q6163829', 'Q900001'],
    Cursor: ['Q900002'],
    'Sam Smith': ['Q900003'],
  },
  entities: {
    Q22686: { id: 'Q22686', label: 'Donald Trump', description: 'president of the United States', human: true, organization: false, files: ['Donald Trump official portrait.jpg', 'Trump at rally.jpg'] },
    Q6163829: { id: 'Q6163829', label: 'Jay Clayton', description: 'American lawyer, former chairman of the SEC', human: true, organization: false, files: ['Jay Clayton SEC.jpg'] },
    Q900001: { id: 'Q900001', label: 'Jay Clayton', description: 'American basketball player', human: true, organization: false, files: ['Jay Clayton dunk.jpg'] },
    Q900002: { id: 'Q900002', label: 'cursor', description: 'indicator on a computer screen', human: false, organization: false, files: ['Mouse pointer.png'] },
    Q900003: { id: 'Q900003', label: 'Sam Smith', description: 'English singer', human: true, organization: false, files: ['Sam Smith concert.jpg'] },
  },
};
