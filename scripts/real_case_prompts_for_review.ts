/**
 * Regenerates the build-phase half of planning/Real Case Reels/prompts-for-review.md from the code, so
 * what Lucas approves is what would be sent: the frame worker's agent prompt and role, frame.md, the
 * picture checker, and object prep's prompts. Sections 1–5 (scout, scoring, fact check, first viewer,
 * understanding judge) are kept as they are.
 *
 *   npx tsx scripts/real_case_prompts_for_review.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { objectPrompt, personPrompt, photoPrompt } from '@/lib/real-case/objects/drawing';
import { PICK_SYSTEM } from '@/lib/real-case/objects/pick';
import { NEWS_FRAME_WORKER_PROMPT, NEWS_PICTURE_CHECKER_PROMPT } from '@/lib/real-case/render/agents';

const FILE = path.join('planning', 'Real Case Reels', 'prompts-for-review.md');
const RC = path.join('explainers', 'real-case');
const read = (rel: string) => fs.readFileSync(path.join(RC, rel), 'utf8').trim();
const block = (text: string, lang = 'text') => `\`\`\`\`${lang}\n${text.trim()}\n\`\`\`\``;

const current = fs.readFileSync(FILE, 'utf8');
const cut = current.indexOf('\n## 6. ');
const head = (cut >= 0 ? current.slice(0, cut) : current).trimEnd().replace(
  /^Generated from the code[^\n]*$/m,
  'Generated from the code (`scripts/real_case_prompts_for_review.ts` writes sections 6–9), so it matches what would be sent. The director\'s plan-phase prompts are files under `explainers/real-case/`: `director/SKILL.md`, `story-design.md`, `storyboard-skeleton.md`. The build phase (N4c-4) is sections 6–9.',
);

const sections = [
  `## 6. The frame worker (one per frame, frames 1 to 7)

Its agent prompt (the subagent's system prompt, Sonnet; Read and Write only):

${block(NEWS_FRAME_WORKER_PROMPT)}

Its role file, \`.hyperframes/frame-packets/_role.md\` (\`frame-worker-core.md\` then \`frame-worker.md\`); its packet adds its storyboard block:

${block(`${read('frame-worker-core.md')}\n\n${read('frame-worker.md')}`, 'md')}`,
  `## 7. frame.md (the \`ai-news\` preset: the visual system, motion and sound rules)

${block(read(path.join('presets', 'ai-news', 'FRAME.md')), 'md')}`,
  `## 8. The build session's own steps and the blind picture check

The director's build phase (\`director/SKILL.md\` § Phase: build) runs the workflow from Step 3.1: \`workflow.md\` (Steps 4–6) and \`visual-design.md\` (Step 4's shot method), both in full below. The picture checker's agent prompt (Haiku, Read only):

${block(NEWS_PICTURE_CHECKER_PROMPT)}

${block(read('workflow.md'), 'md')}

${block(read('visual-design.md'), 'md')}`,
  `## 9. Object prep (code, after the plan; RC-52)

The vision pick (Haiku \`claude-haiku-5-5\`, cached system prompt; the user turn is a numbered contact sheet and "Object: <name>. N candidates."):

${block(PICK_SYSTEM)}

A whiteboard drawing (gpt-image-2, medium, 1024²), for the object "<name>":

${block(objectPrompt('<name>'))}

A public figure's sketch (gpt-image-2 edit, with their approved banked cutout as the reference image; banked for Lucas's approval before any reel uses it):

${block(personPrompt())}

An object photo when stock has no clean one (cut out with rembg):

${block(photoPrompt('<name>'))}`,
];

fs.writeFileSync(FILE, `${head}\n\n${sections.join('\n\n')}\n`);
console.log(`wrote ${FILE}`);
