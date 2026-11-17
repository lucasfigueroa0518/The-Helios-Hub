import fs from 'node:fs';
import path from 'node:path';

import { jevPick, PICK_MIN } from '@/lib/explainers/jev/questions/section-picker';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { guidance, type Ledger } from '@/lib/explainers/injection/ledger';
import type { AgentMessage } from '@/lib/explainers/render/agent';

/**
 * The planner's catalog (INJECTION-PLAN.md § Your calls 3; Lucas 2026-11-16: "if there is a benefit,
 * then yes"). Session A's director reads assets/kit/props/CATALOG.md (~12k tokens, re-sent on every
 * later turn). Before session A, Jev picks the entries this reel's topic and analogy could use; the
 * catalog holds only those, and the full one is CATALOG-FULL.md, one Read away (a miss, logged as
 * `catalog:full` for the `planner|catalog` key). When the ledger promotes `catalog:full`, the trim
 * stops. The full catalog is put back right after session A, so the builders see what they always did.
 */

export const CATALOG_REL = path.join('assets', 'kit', 'props', 'CATALOG.md');
export const FULL_REL = path.join('assets', 'kit', 'props', 'CATALOG-FULL.md');
export const CATALOG_MISS = 'catalog:full';
export const PLANNER_ROLE = 'planner';
export const PLANNER_LOOK = 'catalog';

type Entry = { name: string; text: string; is: string };

export function splitCatalog(md: string): { head: string; entries: Entry[] } {
  const parts = md.split(/\n(?=## )/);
  const head = parts[0].startsWith('## ') ? '' : parts.shift()!.trim();
  const entries = parts.map((p) => {
    const name = /^## (.+)$/m.exec(p)?.[1].trim() ?? '';
    const is = /^- is: (.+)$/m.exec(p)?.[1].trim() ?? name;
    return { name, text: p.trim(), is };
  });
  return { head, entries: entries.filter((e) => e.name) };
}

export type CatalogTrim = { trimmed: boolean; kept: number; total: number; reason?: string };

/** Trim the project's catalog to Jev's picks (and keep the full one beside it). Fails open: untouched. */
export async function trimCatalog(input: {
  projectDir: string;
  jev: ExplainersJevRunner | null;
  ledger: Ledger;
  state: Record<string, string>;
  topicId?: string | null;
}): Promise<CatalogTrim> {
  const file = path.join(input.projectDir, CATALOG_REL);
  let md: string;
  try {
    md = fs.readFileSync(file, 'utf8');
  } catch {
    return { trimmed: false, kept: 0, total: 0, reason: 'no catalog' };
  }
  const { head, entries } = splitCatalog(md);
  if (!input.jev) return { trimmed: false, kept: entries.length, total: entries.length, reason: 'no Jev' };
  if (guidance(input.ledger, PLANNER_ROLE, PLANNER_LOOK).always.includes(CATALOG_MISS)) {
    return { trimmed: false, kept: entries.length, total: entries.length, reason: 'the ledger promoted the full catalog' };
  }
  const r = await jevPick(input.jev, 'catalog', entries.map((e) => ({ id: e.name, label: e.name, summary: e.is })), input.state, { component: 'injection:catalog', topicId: input.topicId, min: PICK_MIN });
  if (r.failed) return { trimmed: false, kept: entries.length, total: entries.length, reason: 'Jev failed' };
  const kept = entries.filter((e) => r.picked.includes(e.name));
  fs.writeFileSync(path.join(input.projectDir, FULL_REL), md);
  fs.writeFileSync(
    file,
    [
      head,
      '',
      `This catalog holds the ${kept.length} of ${entries.length} bank assets that could fit this reel. When none fits a thing you need, Read ${FULL_REL.split(path.sep).join('/')} (the full catalog) once before deciding to draw it new.`,
      '',
      ...kept.map((e) => `${e.text}\n`),
    ].join('\n'),
  );
  return { trimmed: true, kept: kept.length, total: entries.length };
}

/** Put the full catalog back (after session A). */
export function restoreCatalog(projectDir: string): void {
  const full = path.join(projectDir, FULL_REL);
  if (!fs.existsSync(full)) return;
  fs.copyFileSync(full, path.join(projectDir, CATALOG_REL));
  fs.rmSync(full, { force: true });
}

/** Watches session A for a Read of the full catalog. */
export function catalogMissWatcher(): { onMessage: (m: AgentMessage) => void; missed: () => boolean } {
  let missed = false;
  return {
    onMessage: (m) => {
      if (m.type !== 'assistant') return;
      const content = (m.message as { content?: unknown } | undefined)?.content;
      for (const b of Array.isArray(content) ? content : []) {
        const x = b as { type?: string; name?: string; input?: Record<string, unknown> };
        if (x.type === 'tool_use' && (x.name === 'Read' || x.name === 'Grep') && /CATALOG-FULL\.md/.test(JSON.stringify(x.input ?? {}))) missed = true;
      }
    },
    missed: () => missed,
  };
}
