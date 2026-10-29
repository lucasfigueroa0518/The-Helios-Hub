import fs from 'node:fs';
import path from 'node:path';

import { BLUE_CHIP_PLAYERS, bluePlayer, type BluePlayer } from '@/lib/social-hub/blue-chip-players';
import type { CastMember, Pitch } from '@/lib/reel-ai-drama/types';

/** Lowercase, straight quotes, single spaces: the form names are compared in. */
export const norm = (s: string): string =>
  s.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();

export const slug = (s: string): string => norm(s).replace(/'/g, '').replace(/ /g, '-');

const byName = (() => {
  const map = new Map<string, BluePlayer>();
  for (const p of BLUE_CHIP_PLAYERS) {
    for (const n of [p.name, ...(p.aka ?? []), ...p.tokens]) {
      const key = norm(n);
      if (!map.has(key)) map.set(key, p);
    }
  }
  return map;
})();

/** A blue-chip player id for a name (exact name, former name or headline token), or null. */
export function playerIdForName(name: string): string | null {
  return byName.get(norm(name))?.id ?? null;
}

export const isPlayerId = (id: string | null | undefined): id is string => !!id && !!bluePlayer(id);

/** The cast member a pitch names as its central figure. */
export function centralMember(p: Pitch): CastMember | null {
  const want = norm(p.central_figure);
  return p.cast.find((c) => norm(c.name) === want) ?? null;
}

/** The blue-chip player at the center of a pitch: the spread key (MD-32). */
export function centralPlayerId(p: Pitch): string | null {
  const member = centralMember(p);
  if (!member) return null;
  return isPlayerId(member.player_id) ? member.player_id : playerIdForName(member.name);
}

export const DAY_MS = 86_400_000;

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** A DB date or timestamp (Date or string) as an ISO string, or null. */
export function toIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** A DB `date` column as YYYY-MM-DD (PGlite returns a Date at UTC midnight). */
export function toDateOnly(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isoDate(v);
  return String(v).slice(0, 10);
}

export const daysBetween = (from: string | Date, to: Date): number =>
  (to.getTime() - new Date(from).getTime()) / DAY_MS;

// ── The cutout bank's QIDs (read directly; Real Case code stays dormant, MD-48) ──

type CutoutEntry = { id: string; name: string; qid: string | null; approved: boolean };

export const CUTOUT_MANIFEST = 'explainers/real-case/bank/cutouts.json';

let cutoutCache: CutoutEntry[] | null = null;

export function bankedCutouts(root: string = process.cwd()): CutoutEntry[] {
  if (cutoutCache && root === process.cwd()) return cutoutCache;
  const file = path.join(root, CUTOUT_MANIFEST);
  const list = fs.existsSync(file) ? ((JSON.parse(fs.readFileSync(file, 'utf8')) as { cutouts?: CutoutEntry[] }).cutouts ?? []) : [];
  if (root === process.cwd()) cutoutCache = list;
  return list;
}

/** A banked person's QID and whether an approved cutout exists, by name or player id. */
export function bankedPerson(name: string, playerId: string | null): { qid: string | null; cutout: boolean } | null {
  const id = playerId ?? playerIdForName(name);
  const hit = bankedCutouts().find((c) => (id && c.id === id) || norm(c.name) === norm(name));
  return hit ? { qid: hit.qid, cutout: hit.approved } : null;
}
