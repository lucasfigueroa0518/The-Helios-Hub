import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { FACE_RING_MAX, THOUGHT_MARK_MAX } from '@/lib/reel-ai-drama/checks/variety';
import { CRAFT_NAMES, loadCraft, loadPrompt, PROMPT_NAMES, type PromptName } from '@/lib/reel-ai-drama/prompts';
import type { DirectorPlan } from '@/lib/reel-ai-drama/types';
import { ARRANGEMENT_MAX, PERSON_PICTURE_MAX, SHOT_MAX_WORDS } from '@/lib/reel-ai-drama/writing/validate';

/**
 * Builds `planning/AI Mini Docs/prompts-for-review.md` from the craft and prompt files, for Lucas to
 * approve before any live run. Run: `npx tsx lib/reel-ai-drama/writing/review-doc.ts`; pass a saved plan's JSON
 * path to add that plan's shot map (MD-136).
 */

export const REVIEW_DOC_PATH = path.join('planning', 'AI Mini Docs', 'prompts-for-review.md');
export const FLAGS_PATH = path.join('planning', 'AI Mini Docs', 'research', 'flags.json');

type Flag = { id: string; theme: string; final: { action: 'cut' | 'keep' | 'rewrite' | 'superseded'; text?: string; note?: string } };

const USED_BY: Partial<Record<PromptName, string>> = {
  producer: 'B1 development producer (Sonnet 5.5 + web search), one cell per call → `Pitch[]`',
  reporting: 'B2 reporting (Sonnet 5.5 + search/fetch) → `FactSheet`; can kill the story',
  'story-editor': 'Blind story editor (Opus 5.5), system = this + principles; reads the script only → `StoryNotes` (MD-102)',
  writer: 'P4 writer (Opus 5.5), system = this + principles; owns the story from the brief, the fact timeline and the inventory → `WriterDraft` (MD-100)',
  'writer-revise': 'One rewrite on story-editor notes, P5 lines back, C1 facts fix (Opus 5.5), system = this + principles → replacements',
  director: 'P5 director (Opus 5.5), system = this + director craft + story timing + kit guide → `DirectorPlan`',
  'solver-look': 'Problem solver, look (Sonnet 5.5): every frame\'s sheets, the script, all findings and every picture → `submit_look`, a verdict per frame',
  'solver-frame': 'Problem solver, one frame (Sonnet 5.5, then Opus 5.5 on a second round) → `submit_frame`: a plan or code change, built and measured',
  'first-viewer': 'C3 first-time viewer (Sonnet 5.5 vision on the contact sheet + caption transcript)',
  'design-review': 'Design reviewer (MD-129, MD-133): one still per story frame plus the first instant of frame 1; shared intro + the fast set (Haiku 5.5) or the judge set (Sonnet 5.5) → `submit_design_review`',
  'post-text': 'P9 post caption (Sonnet 5.5); code adds credits and the comment question',
  'sound-designer': 'Sound designer: plans music sections, stingers and ambience on the final voice timing (MD-61, MD-63)',
  integrity: 'C2 integrity look (Haiku 5.5): does each image show what its line claims',
  'visuals-look': 'B1 visuals pre-scout (Haiku 5.5, numbered images) → `submit_look`',
  'harvest-look': 'B2 harvest filters (Haiku 5.5, 4×4 contact sheet) → `submit_looks`',
};

/** Demote headings so each file nests under its own section. */
function nest(text: string, by = 2): string {
  return text.replace(/^(#{1,6}) /gm, (_, h: string) => `${'#'.repeat(Math.min(6, h.length + by))} `);
}

const squash = (s: string) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

/**
 * Where each flags.json call landed: rewrites must appear verbatim in a craft or prompt file, or the kit guide.
 * Superseded calls (the writing side's, retired by MD-101: principles over engines) are listed, not checked.
 */
export function flagsReport(root: string = process.cwd()): { rows: string[]; missingRewrites: string[] } {
  const flags = (JSON.parse(readFileSync(path.join(root, FLAGS_PATH), 'utf8')) as { items: Flag[] }).items;
  const kitGuide = readFileSync(path.join(root, 'explainers', 'reel-ai-drama', 'kit', 'FRAME.md'), 'utf8');
  const corpus = squash([...CRAFT_NAMES.map((n) => loadCraft(n, root)), ...PROMPT_NAMES.map((n) => loadPrompt(n, root)), kitGuide].join('\n'));
  const rows: string[] = [];
  const missingRewrites: string[] = [];
  for (const f of flags) {
    let where = '';
    if (f.final.action === 'superseded') where = f.final.note ? `superseded; ${f.final.note}` : 'superseded';
    else if (f.final.action === 'rewrite') {
      const text = squash((f.final.text ?? '').replace(/\s*\(Lucas:.*\)\s*$/s, '')).replace(/\.$/, '');
      const found = corpus.includes(text);
      if (!found) missingRewrites.push(f.id);
      where = found ? 'rewrite text used verbatim' : '**rewrite text not found**';
    } else if (f.final.action === 'cut') where = 'absent';
    else where = f.final.note ? `kept as written; ${f.final.note}` : 'kept as written';
    rows.push(`| ${f.id} | ${f.theme} | ${f.final.action} | ${where} |`);
  }
  return { rows, missingRewrites };
}

/** A plan's picture beats, frame by frame, for review (MD-136). A plan saved before iteration 8 has none to show. */
export function shotMapReview(plan: Pick<DirectorPlan, 'frames'>): string {
  const out: string[] = [];
  for (const f of plan.frames) {
    if (!f.shots?.length) continue;
    out.push(`### Frame ${f.n}: ${f.name} (${f.treatment})`, '', '| Lands on | Shows | Pictures | Introduces |', '|---|---|---|---|');
    const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
    for (const s of f.shots) out.push(`| ${cell(s.at)} | ${cell(s.shows)} | ${s.asset_ids.join(', ')} | ${s.introduces ? cell(s.introduces) : ''} |`);
    out.push('');
  }
  return out.join('\n');
}

/** A plan's blueprints, frame by frame, for review (iteration 10): what code compiles, on the words it lands on. */
export function blueprintReview(plan: Pick<DirectorPlan, 'frames'>): string {
  const out: string[] = [];
  const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  for (const f of plan.frames) {
    const b = f.blueprint;
    if (!b) continue;
    out.push(`### Frame ${f.n}: ${f.name} (${b.arrangement} on ${b.ground}, ${b.style}${b.peak ? ', peak' : ''}; camera ${b.camera?.move})`, '', '| Lands on | What | Detail |', '|---|---|---|');
    const row = (on: string, what: string, detail: unknown) => out.push(`| ${cell(on)} | ${cell(what)} | ${cell(detail)} |`);
    if (b.hook) row(b.hook.on, 'hook', b.hook.text);
    for (const p of b.pieces ?? []) row(p.on, `piece ${p.id}`, p.asset ?? p.note ?? p.treatment);
    for (const l of b.labels ?? []) row(l.on, 'label', `${l.text}${l.for ? ` (for ${l.for})` : ''}`);
    for (const s of b.speech ?? []) row(s.on, `plate on ${s.on_piece}`, s.text);
    for (const m of b.marks ?? []) row(m.on, `${m.kind} on ${m.on_piece}`, m.target ?? '');
    for (const a of b.arrows ?? []) row(a.on, 'arrow', `${a.from} to ${a.to}`);
    for (const s of b.camera?.stops ?? []) row(s.on, 'camera', s.aim);
    for (const s of b.sounds ?? []) row(s.on, `sound (${s.kind})`, s.what);
    out.push('');
  }
  return out.join('\n');
}

export function buildReviewDoc(root: string = process.cwd(), plan?: Pick<DirectorPlan, 'frames'>): string {
  const { rows } = flagsReport(root);
  const out: string[] = [
    '# Reel AI Drama — prompts for review',
    '',
    '> Generated by `npx tsx lib/reel-ai-drama/writing/review-doc.ts` from `explainers/reel-ai-drama/craft/` and',
    '> `explainers/reel-ai-drama/prompts/`. Edit those files, never this one. Lucas approves these before any live run.',
    '',
    '## Review lens',
    '',
    '- **Altitude:** every rule fits any story; nothing is written for one story.',
    '- **No example pollution:** no real AI story, company or person appears in any prompt or craft file (a test enforces',
    "  the calibration names and the central list's names); illustrations are generic and marked.",
    '- **No contradictions:** conflicts the research left are resolved in place (hold vs move; Lucas\'s timing over the',
    '  research intervals; the Helios caption band over the research\'s lower-third captions).',
    '- **MECE:** how a story is told lives only in the principles; picture-side timing only in the story timing; picture,',
    '  sound and image ethics only in the director craft; verification only in the reporting prompt; story selection only',
    '  in the producer prompt.',
    '- **Musts are HARD CONSTRAINTS; everything else is craft.**',
    '',
    '## What code checks on a plan with shot maps (MD-135, MD-136, MD-138)',
    '',
    `- Every \`at\` is found in its frame's narration, in order; no beat holds past ${SHOT_MAX_WORDS} spoken words; every spoken number has a beat.`,
    '- Every person, company and product in the cast has a beat on the line that first names them, with a picture.',
    `- At most ${FACE_RING_MAX} circle marks on a face and ${THOUGHT_MARK_MAX} \`thought\` mark per reel.`,
    '- A figure on screen is one the words over it state (MD-137).',
    '',
    '## What code checks on a plan with blueprints (iteration 10; one fix round, then a flag)',
    '',
    "- Every `Words` is what the frame's voice says, matched as `nk.cueAt` matches; every piece reference, arrangement, kind and aim is real.",
    `- One picture of a person holds at most ${PERSON_PICTURE_MAX} frames a reel, never adjacent ones, counting near-duplicates and cutouts.`,
    `- The same people in the same arrangement don't repeat, and one ground and arrangement holds at most ${ARRANGEMENT_MAX} frames.`,
    '- A company, product or source a line names has a real picture or logo on screen; a passing mention needs one by then. A place named after a locative, or a room the line sets the scene in, is shown.',
    "- A failed search's stand-in shows what the shot says, or the frame is rebuilt from real pictures, or drawn plainly as made.",
    '- On render, `checkPlanCarried` holds each frame to its blueprint: every piece, label, mark, arrow and camera stop on its words.',
    '',
    ...(plan ? ['## This plan\'s shot map', '', shotMapReview(plan), '', '## This plan\'s blueprints', '', blueprintReview(plan), ''] : []),
    '## How the flagged principles were applied (research/flags.json)',
    '',
    '| Id | Theme | Call | In the files |',
    '|---|---|---|---|',
    ...rows,
    '',
    '## Contents',
    '',
    ...CRAFT_NAMES.map((n) => `- craft: \`${n}\``),
    ...PROMPT_NAMES.map((n) => `- prompt: \`${n}\` — ${USED_BY[n] ?? ''}`),
    '',
  ];
  for (const n of CRAFT_NAMES) out.push(`---\n\n## Craft: \`${n}.md\`\n\n${nest(loadCraft(n, root))}\n`);
  for (const n of PROMPT_NAMES) out.push(`---\n\n## Prompt: \`${n}.md\`\n\n*Used by:* ${USED_BY[n] ?? ''}\n\n${nest(loadPrompt(n, root))}\n`);
  return out.join('\n');
}

if (process.argv[1]?.endsWith('review-doc.ts')) {
  const planPath = process.argv[2];
  writeFileSync(path.join(process.cwd(), REVIEW_DOC_PATH), buildReviewDoc(process.cwd(), planPath ? (JSON.parse(readFileSync(planPath, 'utf8')) as DirectorPlan) : undefined));
  console.log(`wrote ${REVIEW_DOC_PATH}`);
}
