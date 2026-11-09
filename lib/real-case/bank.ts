import fs from 'node:fs';
import path from 'node:path';

import { AFFILIATED_COMPANIES, BLUE_CHIP_PLAYERS, type BluePlayer } from '@/lib/social-hub/blue-chip-players';
import { logoFor, type BankedLogo } from '@/lib/social-hub/logo-bank';
import type { CastMember } from '@/lib/real-case/types';

/**
 * How a story's players can appear on screen (RC-33, RC-34). A company with a banked logo shows it (the
 * shared logo bank, lib/social-hub/logo-bank.ts); a blue-chip person with a banked cutout shows it (this
 * format's cutout bank, explainers/real-case/bank/cutouts.json); anyone else is a faceless silhouette or a
 * name card. Players are matched to the blue-chip list by exact name, former name or headline token,
 * never by a loose guess, so a wrong face or logo can't reach a reel.
 */

export const CUTOUT_DIR = path.join('explainers', 'real-case', 'bank', 'cutouts');
export const CUTOUT_MANIFEST = path.join('explainers', 'real-case', 'bank', 'cutouts.json');

/** One banked cutout: a licensed Commons portrait with its background removed, reviewed by Lucas. */
export type BankedCutout = {
  /** The person's id in the blue-chip list. */
  id: string;
  name: string;
  /** The person's Wikidata QID, pinned when the cutout was made. */
  qid: string;
  /** Repo-relative transparent PNG. */
  file: string;
  width: number;
  height: number;
  /** The credit line a published reel carries (author, licence). */
  credit: string;
  /** The Commons file page the portrait came from. */
  provenance: string;
  /** Lucas looked at it and approved it (RC-34): an unapproved cutout is never used. */
  approved: boolean;
};

export function loadCutouts(root: string = process.cwd()): BankedCutout[] {
  const file = path.join(root, CUTOUT_MANIFEST);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { cutouts?: BankedCutout[] };
  return (parsed.cutouts ?? []).filter((c) => fs.existsSync(path.join(root, c.file)));
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

/** The blue-chip player a cast member is, by exact name, former name or token; null when none. */
export function bluePlayerFor(member: Pick<CastMember, 'name' | 'kind'>): BluePlayer | null {
  if (member.kind === 'private_person') return null;
  const want = member.kind === 'public_figure' ? 'person' : 'company';
  const name = norm(member.name);
  const hit = BLUE_CHIP_PLAYERS.find(
    (p) => p.kind === want && [p.name, ...(p.aka ?? []), ...p.tokens].some((n) => norm(n) === name),
  );
  return hit ?? null;
}

export type PlayerBanking = { logo: BankedLogo | null; cutout: BankedCutout | null };

/** What a cast member may show. A product shows its company's logo only when it is that company. */
export function bankingFor(member: CastMember, cutouts: readonly BankedCutout[] = loadCutouts()): PlayerBanking {
  if (member.kind === 'private_person') return { logo: null, cutout: null };
  if (member.kind === 'public_figure') {
    const person = bluePlayerFor(member);
    return { logo: null, cutout: person ? (cutouts.find((c) => c.id === person.id && c.approved) ?? null) : null };
  }
  const company = bluePlayerFor(member);
  const affiliated = company ? null : AFFILIATED_COMPANIES.find((c) => norm(c.name) === norm(member.name));
  const id = company?.id ?? affiliated?.id ?? null;
  return { logo: id ? logoFor(id) : null, cutout: null };
}

/** The `## Players` line's banking note: "logo banked", "cutout banked", or nothing. */
export function bankingNote(b: PlayerBanking): string | null {
  if (b.cutout) return 'cutout banked';
  if (b.logo) return 'logo banked';
  return null;
}
