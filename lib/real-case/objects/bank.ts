import fs from 'node:fs';
import path from 'node:path';

/**
 * The object bank (RC-41, RC-48): what a reel found or drew, kept for later reels. Board and newspaper
 * objects are photo cutouts; whiteboard objects are marker drawings (a PNG plus its traced strokes); a
 * person's whiteboard sketch is a drawing made from their banked cutout. A later reel reuses an entry
 * only on an exact slug match of the same kind, the way Explainer Reels reuse harvested props. Person
 * sketches need Lucas's approval before use, like the cutouts (RC-34); objects do not (the pick or the
 * drawing prompt vouches for them, and a wrong one is caught by the picture check).
 */

export const OBJECT_BANK_DIR = path.join('explainers', 'real-case', 'bank', 'objects');
export const OBJECT_MANIFEST = path.join('explainers', 'real-case', 'bank', 'objects.json');

export type ObjectKind = 'cutout' | 'drawing' | 'person-sketch';

export type BankedObject = {
  slug: string;
  kind: ObjectKind;
  /** What it is, in plain words (the query or the drawing subject). */
  name: string;
  /** Repo-relative transparent PNG. */
  file: string;
  /** Repo-relative strokes JSON (drawings only): { width, height, strokes: string[] } of SVG path data. */
  strokes: string | null;
  width: number;
  height: number;
  credit: string;
  /** cc0 | pdm | by for stock photos; "generated" for drawings. */
  license: string;
  /** Landing page or the model that drew it. */
  source: string;
  /** Person sketches: Lucas looked at it and approved it. Objects are true on entry. */
  approved: boolean;
  created_at: string;
};

export const slugOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function loadObjects(root: string = process.cwd()): BankedObject[] {
  const file = path.join(root, OBJECT_MANIFEST);
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { objects?: BankedObject[] };
  return (parsed.objects ?? []).filter((o) => fs.existsSync(path.join(root, o.file)) && (!o.strokes || fs.existsSync(path.join(root, o.strokes))));
}

/** An approved entry of this kind with exactly this slug, or null. */
export function findBanked(slug: string, kind: ObjectKind, root: string = process.cwd()): BankedObject | null {
  return loadObjects(root).find((o) => o.slug === slug && o.kind === kind && o.approved) ?? null;
}

/**
 * Bank a found or drawn object: copy its files under the bank and add (or replace) its manifest entry.
 * `files.png` and `files.strokes` are absolute paths to the job's copies.
 */
export function bankObject(
  entry: Omit<BankedObject, 'file' | 'strokes' | 'created_at'>,
  files: { png: string; strokes?: string | null },
  root: string = process.cwd(),
): BankedObject {
  const dir = path.join(OBJECT_BANK_DIR, entry.kind, entry.slug);
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  const file = path.join(dir, `${entry.slug}.png`);
  fs.copyFileSync(files.png, path.join(root, file));
  let strokes: string | null = null;
  if (files.strokes) {
    strokes = path.join(dir, `${entry.slug}.strokes.json`);
    fs.copyFileSync(files.strokes, path.join(root, strokes));
  }
  const banked: BankedObject = { ...entry, file, strokes, created_at: new Date().toISOString() };
  const manifest = path.join(root, OBJECT_MANIFEST);
  const all = fs.existsSync(manifest) ? ((JSON.parse(fs.readFileSync(manifest, 'utf8')) as { objects?: BankedObject[] }).objects ?? []) : [];
  const next = [...all.filter((o) => !(o.slug === banked.slug && o.kind === banked.kind)), banked].sort((a, b) => `${a.kind}/${a.slug}`.localeCompare(`${b.kind}/${b.slug}`));
  fs.writeFileSync(manifest, `${JSON.stringify({ objects: next }, null, 1)}\n`);
  return banked;
}
