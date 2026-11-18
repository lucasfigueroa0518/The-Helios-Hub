import fs from 'node:fs';
import path from 'node:path';

import { EXPLAINERS_DIR } from '@/lib/explainers/render/workspace';

/**
 * Instruction injection, the section index (planning/Explainers Cost/INJECTION-PLAN.md, approved by
 * Lucas 2026-11-16: Jev picks every section that is not core). The builder stack (craft, house style,
 * minimums, frame.md, the kit reference) is split by `## ` heading. `core` sections stay in every
 * builder's system prompt (one shared cached prefix per reel); `pick` sections go into a builder's
 * dispatch message only when Jev says its window needs them; `ref` sections are never injected. Every
 * section that is not injected is still one Read away in .hyperframes/sections/, and each such Read
 * is logged as a miss (the learning loop, ledger.ts).
 */

export type Tier = 'core' | 'pick' | 'ref';
export type IndexEntry = { tier: Tier; summary: string };
export type SectionIndex = { sources: Record<string, string>; sections: Record<string, IndexEntry> };
export type Section = { id: string; source: string; file: string; heading: string; text: string; tier: Tier; summary: string };

export const INDEX_FILE = path.join(EXPLAINERS_DIR, 'injection', 'sections.json');
/** Where a job keeps every non-core section, one file each, plus INDEX.md and the job's index copy. */
export const SECTIONS_DIR = path.join('.hyperframes', 'sections');
const JOB_INDEX = 'index.json';

export function loadIndex(file = INDEX_FILE): SectionIndex {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as SectionIndex;
  return { sources: raw.sources, sections: raw.sections };
}

export const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** One file's sections: its preamble (`<source>:intro`) and each `## ` heading, in order. */
export function splitSections(source: string, text: string): { id: string; heading: string; text: string }[] {
  const out: { id: string; heading: string; text: string }[] = [];
  let heading = '';
  let id = `${source}:intro`;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) out.push({ id, heading, text: body });
  };
  for (const line of text.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m && !line.startsWith('###')) {
      flush();
      heading = m[1];
      id = `${source}:${slug(heading)}`;
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** Every section of the stack as the project holds it. A section the index lacks is a `pick` (fail open). */
export function readSections(projectDir: string, index: SectionIndex): Section[] {
  const out: Section[] = [];
  for (const [source, file] of Object.entries(index.sources)) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(projectDir, file), 'utf8');
    } catch {
      continue;
    }
    for (const s of splitSections(source, text)) {
      const entry = index.sections[s.id];
      out.push({ ...s, source, file, tier: entry?.tier ?? 'pick', summary: entry?.summary ?? s.heading });
    }
  }
  return out;
}

/** The file a section lives in under SECTIONS_DIR (`kit:lens-js` → `kit--lens-js.md`). */
export const sectionFile = (id: string) => `${id.replace(':', '--')}.md`;

/**
 * Write every non-core section to .hyperframes/sections/ (its own file), INDEX.md (id, file, summary)
 * and index.json (the job's copy of the index: its presence turns the core-only stack on, agent.ts).
 * Returns the sections, or null when the stack is not in this project (Real Case, an older job).
 */
export function prepareSections(projectDir: string, index: SectionIndex = loadIndex()): Section[] | null {
  const sections = readSections(projectDir, index);
  if (!sections.length) return null;
  const dir = path.join(projectDir, SECTIONS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const rest = sections.filter((s) => s.tier !== 'core');
  for (const s of rest) fs.writeFileSync(path.join(dir, sectionFile(s.id)), `<!-- ${s.file} -->\n${s.text}\n`);
  fs.writeFileSync(path.join(dir, 'INDEX.md'), indexMarkdown(rest));
  fs.writeFileSync(path.join(dir, JOB_INDEX), `${JSON.stringify(index, null, 2)}\n`);
  return sections;
}

export function indexMarkdown(rest: readonly Section[]): string {
  return [
    '# Instruction sections not in your prompt',
    '',
    'Read one only when your work needs it and it is not already in your prompt or your dispatch message.',
    '',
    ...rest.map((s) => `- \`${SECTIONS_DIR}/${sectionFile(s.id)}\` — ${s.file} § ${s.heading}: ${s.summary}`),
    '',
  ].join('\n');
}

/** The job's index copy, or null (injection off for this job). */
export function jobIndex(projectDir: string): SectionIndex | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, SECTIONS_DIR, JOB_INDEX), 'utf8')) as SectionIndex;
  } catch {
    return null;
  }
}

/**
 * The core-only stack for a builder's system prompt: each source's core sections, in file order, in
 * the same `<file>` wrapping as the full stack. Identical for every builder of a reel (one cache write).
 */
export function coreStack(projectDir: string, index: SectionIndex): string {
  const sections = readSections(projectDir, index);
  const byFile = new Map<string, string[]>();
  for (const s of sections) if (s.tier === 'core') byFile.set(s.file, [...(byFile.get(s.file) ?? []), s.text]);
  const parts = [...byFile].map(([file, texts]) => `<file path="${file}" sections="core">\n${texts.join('\n\n')}\n</file>`);
  if (!parts.length) return '';
  return [
    'These are the core sections of your instruction files, already here: never Read those files.',
    `The sections picked for your work come in your dispatch message. Every other section is one file in ${SECTIONS_DIR}/ (listed in ${SECTIONS_DIR}/INDEX.md): Read one only when your work needs it.`,
    '',
    parts.join('\n\n'),
    '',
    '---',
    '',
    '',
  ].join('\n');
}

/** The dispatch-message block for picked sections (the per-window suffix after the cached prefix). */
export function pickedBlock(sections: readonly Section[], lessons: readonly string[] = []): string {
  const parts: string[] = [];
  if (sections.length) {
    parts.push('Instruction sections picked for this work (complete; never Read them again):', '');
    for (const s of sections) parts.push(`<section id="${s.id}" file="${s.file}">`, s.text, '</section>', '');
  }
  if (lessons.length) {
    parts.push('First-try rules (each is a mistake recent builds of this kind made at their first self-check; follow every one):', ...lessons.map((l) => `- ${l}`), '');
  }
  return parts.length ? `${parts.join('\n')}\n---\n\n` : '';
}
