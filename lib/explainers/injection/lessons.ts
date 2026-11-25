import fs from 'node:fs';
import path from 'node:path';

import { EXPLAINERS_DIR } from '@/lib/explainers/render/workspace';

/**
 * First-try lesson rules (Lucas 2026-11-17: lessons are general rules, never another reel's text;
 * code fixes come first and retire their lesson). explainers/injection/lessons.json holds one plain
 * rule per kind of first-try self-check error. Code classifies every error into a lesson id: a
 * rule's id when one matches, else `kind:<normalized error>` (names, quotes and numbers removed), so
 * a kind nobody has written a rule for yet is still counted, injected generically and listed for a rule.
 */

export const LESSONS_FILE = path.join(EXPLAINERS_DIR, 'injection', 'lessons.json');

export type LessonRule = { id: string; match: string; rule: string; codeFix: string | null; retired: boolean };
type CompiledRule = LessonRule & { re: RegExp };

let cache: { file: string; mtime: number; rules: CompiledRule[] } | null = null;

/** The rules (cached until the file changes). A missing or broken file is no rules, never an error. */
export function loadLessonRules(file = LESSONS_FILE): CompiledRule[] {
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (cache && cache.file === file && cache.mtime === mtime) return cache.rules;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { rules?: LessonRule[] };
    const rules: CompiledRule[] = [];
    for (const r of raw.rules ?? []) {
      try {
        rules.push({ ...r, codeFix: r.codeFix ?? null, retired: Boolean(r.retired), re: new RegExp(r.match, 'i') });
      } catch {
        /* a bad regex skips that rule */
      }
    }
    cache = { file, mtime, rules };
    return rules;
  } catch {
    return [];
  }
}

/** The error without its frame prefix (`04-analogy: occlusion: …` → `occlusion: …`). */
export const stripFrame = (error: string) => error.replace(/^\s*\d+-[a-z0-9-]+:\s*/i, '');

/** The same error, whatever frame, time, name or number it names. */
export function normalizeError(error: string): string {
  return stripFrame(error)
    .replace(/"[^"]*"/g, '"…"')
    .replace(/`[^`]*`/g, '`…`')
    .replace(/\d+(\.\d+)?s\b/g, 'Ns')
    .replace(/\d+(\.\d+)?/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/** The lesson id an error belongs to. */
export function lessonIdOf(error: string, rules = loadLessonRules()): string {
  const bare = stripFrame(error);
  for (const r of rules) if (r.re.test(bare)) return r.id;
  return `kind:${normalizeError(error)}`;
}

export const isRuleId = (id: string) => !id.startsWith('kind:');

/** What a builder is told for a lesson id: the rule's text, or the normalized error for an unwritten kind. Null when retired. */
export function lessonText(id: string, rules = loadLessonRules()): string | null {
  if (!isRuleId(id)) return `Avoid this self-check error: ${id.slice('kind:'.length)}`;
  const r = rules.find((x) => x.id === id);
  if (!r) return null;
  return r.retired ? null : r.rule;
}

export function ruleOf(id: string, rules = loadLessonRules()): LessonRule | null {
  return rules.find((x) => x.id === id) ?? null;
}
