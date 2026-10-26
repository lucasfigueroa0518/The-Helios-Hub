import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { bankDir as defaultBankDir, bankIndexSource, catalogEntries, catalogMarkdown } from '../../../explainers/world-kit/props/catalog.mjs';

/**
 * The asset bank grows itself (Explainers 3.6, EX3-114; Lucas, 2026-10-22: "As more assets are drawn,
 * more assets go in there"). After a reel renders, every new drawing it made (NEW_PROPS in
 * assets/world/new-props.js and assets/frames/*.props.js) joins the bank when the blind picture
 * check named it as specifically as it was meant (`picture-check.json` "assets", pass: true), its
 * tags are complete, it draws cleanly in every state (`try.mjs props`), and its file imports only
 * from the kit. Each file is copied to `<bank>/<job>-<name>.js` with a manifest beside it, and the
 * bank's index and catalog are rebuilt. Never fails a render: problems come back as `skipped`.
 */

export type HarvestResult = {
  added: { name: string; file: string }[];
  skipped: { name: string; why: string }[];
};

type FoundProp = { file: string; name: string; tags: Record<string, unknown> | null; ok: boolean };
type AssetRow = { name?: unknown; file?: unknown; meant?: unknown; seen?: unknown; pass?: unknown };

/** The picture check's asset rows, whichever shape the file has (`{ tiles, assets }`, or tiles only). */
export function verifiedAssets(projectDir: string): Map<string, AssetRow> {
  const out = new Map<string, AssetRow>();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(projectDir, '.hyperframes', 'picture-check.json'), 'utf8'));
    const rows: AssetRow[] = Array.isArray(raw?.assets) ? raw.assets : [];
    for (const row of rows) if (typeof row.name === 'string' && row.pass === true) out.set(row.name, row);
  } catch {
    // no check, no verified assets
  }
  return out;
}

/** Only kit imports, so the file stands alone in the bank (never the bank itself through props.js). */
export function kitOnlyImports(source: string): string | null {
  for (const m of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1] ?? m[2];
    if (!spec.startsWith('../kit/')) return `imports ${spec} (only ../kit/ may be imported)`;
    if (spec === '../kit/props.js') return 'imports ../kit/props.js (import ../kit/props/kit.js and ../kit/draw.js instead)';
  }
  return null;
}

/** Run the kit's own check on the project's new drawings. */
function findProps(projectDir: string): { props: FoundProp[]; error: string | null } {
  const run = spawnSync(process.execPath, [path.join('assets', 'kit', 'try.mjs'), 'props'], { cwd: projectDir, encoding: 'utf8', timeout: 60_000 });
  try {
    const parsed = JSON.parse(run.stdout) as { props?: FoundProp[] };
    return { props: parsed.props ?? [], error: null };
  } catch {
    return { props: [], error: `try.mjs props gave no result (${(run.stderr || run.stdout || '').trim().slice(0, 200)})` };
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export function harvestNewProps(input: { projectDir: string; jobId: string; topic: string; bankDir?: string; now?: Date }): HarvestResult {
  const bankDir = input.bankDir ?? defaultBankDir();
  const result: HarvestResult = { added: [], skipped: [] };
  const { props, error } = findProps(input.projectDir);
  if (error) return { added: [], skipped: [{ name: '*', why: error }] };
  if (!props.length) return result;
  const verified = verifiedAssets(input.projectDir);
  const taken = new Set(catalogEntries(bankDir).map((e: { name: string }) => e.name));
  const job = input.jobId.slice(0, 8);

  for (const file of [...new Set(props.map((p) => p.file))]) {
    const inFile = props.filter((p) => p.file === file);
    const source = fs.readFileSync(path.join(input.projectDir, file), 'utf8');
    const importProblem = kitOnlyImports(source);
    const keep: Record<string, { source_name: string; tags: unknown; meant: unknown; seen: unknown }> = {};
    for (const p of inFile) {
      const row = verified.get(p.name);
      const why = importProblem ?? (!p.ok ? 'failed try.mjs props (tags, states or drawing)' : !row ? 'not named by the picture check' : null);
      if (why) {
        result.skipped.push({ name: p.name, why });
        continue;
      }
      const key = taken.has(p.name) ? `${p.name} (${job})` : p.name;
      taken.add(key);
      keep[key] = { source_name: p.name, tags: p.tags, meant: row!.meant ?? null, seen: row!.seen ?? null };
    }
    if (!Object.keys(keep).length) continue;
    fs.mkdirSync(bankDir, { recursive: true });
    const base = `${job}-${slug(path.basename(file).replace(/(\.props)?\.js$/, ''))}`;
    // In the bank, the kit sits two levels up (world-kit/props/bank → world-kit).
    fs.writeFileSync(path.join(bankDir, `${base}.js`), source.replace(/(['"])\.\.\/kit\//g, '$1../../'));
    const manifest = { file: `${base}.js`, job: input.jobId, topic: input.topic, added_at: (input.now ?? new Date()).toISOString(), from: file, props: keep };
    fs.writeFileSync(path.join(bankDir, `${base}.json`), `${JSON.stringify(manifest, null, 1)}\n`);
    for (const key of Object.keys(keep)) result.added.push({ name: key, file: `${base}.js` });
  }

  if (result.added.length) {
    fs.writeFileSync(path.join(bankDir, 'index.js'), bankIndexSource(bankDir));
    // The repo's catalog follows the repo's bank; a bank kept elsewhere is cataloged into each job (workspace.ts).
    if (path.resolve(bankDir) === path.resolve(defaultBankDir(''))) {
      fs.writeFileSync(path.join(bankDir, '..', 'CATALOG.md'), catalogMarkdown(catalogEntries(bankDir)));
    }
  }
  return result;
}
