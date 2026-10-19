/**
 * The logo bank (Lucas, 2026-10-13): one logo file for every blue-chip company
 * and every affiliated company (lib/social-hub/blue-chip-players.ts
 * LOGO_COMPANIES), so a meme or a slide can badge a player without fetching
 * anything at render time.
 *
 *   - Built by `npx tsx scripts/social_logo_bank.ts` with the
 *     cover card's own rules (lib/social/photos/logo.ts): Wikidata P154 on the
 *     company's pinned QID only, never matched by name; the Commons file's
 *     licence checked (PD / CC0 / CC BY / CC BY-SA, plus MIT and Apache 2.0
 *     for logos: Lucas, 2026-10-13); Commons' rendered PNG,
 *     never recoloured or cropped; a light or dark plate picked from the
 *     logo's own luminance.
 *   - The files live in lib/social/render/assets/logos/<id>.png and the
 *     manifest in logo-bank.generated.ts. Both are reviewed before they ship:
 *     Wikidata is open to edits, so a rebuild is a diff to read, not a refresh
 *     to trust.
 *   - A company Commons has no licensed logo for is listed as missing with the
 *     reason. MANUAL_LOGOS fills a gap with a file a person chose and approved;
 *     a manual entry wins over a built one.
 */
import { LOGO_COMPANIES, bluePlayer, companiesOf, type BluePlayer } from '@/lib/social-hub/blue-chip-players';

import { BUILT_LOGOS } from './logo-bank.generated';

/** Where the files live, relative to the repo root. */
export const LOGO_DIR = 'lib/social/render/assets/logos';

export type LogoPlate = 'light' | 'dark';

/**
 * Whether a logo spells the company's name (a wordmark, alone or with a
 * symbol) or is a symbol only. A wordmark badges a company by itself; a symbol
 * needs the name beside it. Read off the reviewed logo sheet on 2026-10-13.
 */
export type LogoMark = 'wordmark' | 'symbol';
export const SYMBOL_ONLY_LOGOS: ReadonlySet<string> = new Set(['mistral', 'apple', 'tesla', 'xai', 'higgsfield']);
export const markOf = (companyId: string): LogoMark => (SYMBOL_ONLY_LOGOS.has(companyId) ? 'symbol' : 'wordmark');

export type BankedLogo = {
  /** The company's id in the blue-chip list (or an affiliated company's). */
  id: string;
  name: string;
  qid: string;
  /** Repo-relative PNG path. */
  file: string;
  width: number;
  height: number;
  plate: LogoPlate;
  /** The credit line a published slide carries. */
  credit: string;
  source: 'commons' | 'manual';
  /** Filled in by logoFor from SYMBOL_ONLY_LOGOS. */
  mark?: LogoMark;
  /** Commons: the file page title. Manual: where the file came from and who approved it. */
  provenance: string;
};

export type MissingLogo = { id: string; name: string; qid: string; reason: string };

export type BuiltEntry = ({ status: 'ok' } & Omit<BankedLogo, 'source'>) | ({ status: 'missing' } & MissingLogo);

/**
 * Gaps filled by hand: a file under LOGO_DIR/manual/, its credit, and who
 * approved it. Each is the mark the company serves on its own site, rendered
 * to PNG unchanged except that a currentColor glyph is drawn black. Eureka
 * Labs (only a GitHub avatar on a white square) was not approved; SSI has no
 * logo anywhere official, so both stay unbadged.
 */
const approved = 'approved by Lucas, 2026-10-13';
export const MANUAL_LOGOS: readonly BankedLogo[] = [
  {
    id: 'xai', name: 'SpaceXAI', qid: 'Q120599684', file: `${LOGO_DIR}/manual/xai.png`, width: 800, height: 305, plate: 'light',
    credit: 'Logo: SpaceXAI · x.ai', source: 'manual',
    provenance: `x.ai header mark (inline SVG on https://x.ai/, 2026-10-13); the company now brands itself SpaceXSI; ${approved}`,
  },
  {
    id: 'higgsfield', name: 'Higgsfield', qid: 'Q140561494', file: `${LOGO_DIR}/manual/higgsfield.png`, width: 800, height: 800, plate: 'light',
    credit: 'Logo: Higgsfield · higgsfield.ai', source: 'manual',
    provenance: `higgsfield.ai header glyph (inline SVG, 2026-10-13); ${approved}`,
  },
  {
    id: 'relativity-space', name: 'Relativity Space', qid: 'Q54263821', file: `${LOGO_DIR}/manual/relativity-space.png`, width: 800, height: 230, plate: 'dark',
    credit: 'Logo: Relativity Space · relativityspace.com', source: 'manual',
    provenance: `https://www.relativityspace.com/s/Relativity_Logo-02.svg (site footer, 2026-10-13); ${approved}`,
  },
];

/**
 * Files a review turned down, by company id and Commons file. The builder
 * records them as missing instead of saving them, so a rebuild cannot bring
 * them back; a new file on Wikidata gets reviewed afresh.
 */
export const REVIEW_REJECTS: Readonly<Record<string, { provenance: string; reason: string }>> = {
  xai: {
    provenance: 'File:SpaceXAI logo.svg',
    reason: "Wikidata's current SpaceXAI (xAI) logo is SpaceX's own wordmark, not a SpaceXAI or Grok mark (review, 2026-10-13)",
  },
};

const manual = new Map(MANUAL_LOGOS.map((l) => [l.id, l]));
const built = new Map<string, BuiltEntry>(BUILT_LOGOS.map((e) => [e.id, e]));

/** A company's logo, or null when the bank has none. */
export function logoFor(companyId: string): BankedLogo | null {
  const m = manual.get(companyId);
  if (m) return { ...m, mark: markOf(companyId) };
  const b = built.get(companyId);
  if (!b || b.status !== 'ok' || REVIEW_REJECTS[companyId]?.provenance === b.provenance) return null;
  const { status: _status, ...rest } = b;
  return { ...rest, source: 'commons', mark: markOf(companyId) };
}

/** The logo that badges a player: a company's own, a person's primary company's (falling back to their others). */
export function logoForPlayer(p: BluePlayer): BankedLogo | null {
  if (p.kind === 'company') return logoFor(p.id);
  for (const c of companiesOf(p)) {
    const logo = logoFor(c.id);
    if (logo) return logo;
  }
  return null;
}

/** Companies the bank cannot badge yet, with the builder's reason. */
export function missingLogos(): MissingLogo[] {
  return LOGO_COMPANIES.flatMap((c) => {
    if (logoFor(c.id)) return [];
    const b = built.get(c.id);
    const reason = b?.status === 'missing' ? b.reason : REVIEW_REJECTS[c.id]?.reason ?? 'not built yet';
    return [{ id: c.id, name: c.name, qid: c.qid, reason }];
  });
}

export const logoForPlayerId = (id: string): BankedLogo | null => {
  const p = bluePlayer(id);
  return p ? logoForPlayer(p) : logoFor(id);
};
