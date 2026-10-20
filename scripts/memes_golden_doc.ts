/**
 * Assemble the per-template dossiers (.memes-local/golden/dossiers/) into the
 * template section of planning/Memes/GOLDEN_SET.md, between the markers
 * "<!-- dossiers:start -->" and "<!-- dossiers:end -->". The rest of the
 * file (the findings and the writing guide) is written by hand. Offline.
 *
 *   npx tsx scripts/memes_golden_doc.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { TEMPLATE_CATALOG } from '@/lib/memes/catalog';
import { GOLDEN_DIR } from '@/lib/memes/golden';

type Dossier = {
  templateId: string;
  coded: { top: number; tech: number; flops: number };
  picture: string; figure: string; mechanism: string;
  boxMap: Array<{ imgflipBox: number; slot: string; region: string; holds: string }>;
  patterns: Array<{ id: string; form: string; share: number; device: string; realShape: string }>;
  voice: string;
  slotTargets: Record<string, { p50: number; p90: number; form: string }>;
  winnersVsFlops: string; techNotes: string; misreads: string[];
  ourMemes: Array<{ text: string; verdict: string; why: string; lucas: string; agree: boolean | null }>;
  slotProblems: string; slotProposal: { slots: unknown[]; why: string } | null;
  examples: Array<{ pattern: string; story: string; fills: Record<string, string> }>;
  test: string; newsFit: string; newsFitWhy: string; styleNotes: string[];
};

const DOC = path.join(process.cwd(), 'planning', 'Memes', 'GOLDEN_SET.md');
const START = '<!-- dossiers:start -->';
const END = '<!-- dossiers:end -->';

const sections: string[] = [];
for (const t of TEMPLATE_CATALOG) {
  const f = path.join(GOLDEN_DIR, 'dossiers', `${t.id}.json`);
  if (!fs.existsSync(f)) {
    sections.push(`### ${t.name} (\`${t.id}\`)\n\nNo dossier.\n`);
    continue;
  }
  const d = JSON.parse(fs.readFileSync(f, 'utf8')) as Dossier;
  const wrong = d.ourMemes.filter((m) => m.verdict !== 'right').length;
  sections.push(
    [
      `### ${t.name} (\`${t.id}\`)`,
      '',
      `Coded ${d.coded.top} top uses, ${d.coded.tech} tech memes, ${d.coded.flops} flops. News fit: **${d.newsFit}** (${d.newsFitWhy}). Our memes misused it: ${wrong} of ${d.ourMemes.length}.`,
      '',
      `- **Mechanism:** ${d.mechanism}`,
      `- **Picture:** ${d.picture}`,
      `- **Figure:** ${d.figure}`,
      `- **Voice:** ${d.voice}`,
      `- **Boxes:** ${d.boxMap.map((b) => `B${b.imgflipBox} → ${b.slot} (${b.region}: ${b.holds})`).join('; ')}`,
      `- **Patterns:**`,
      ...d.patterns.map((p) => `  - \`${p.id}\` (${Math.round(p.share * 100)}%, ${p.device}): ${p.form}. Real shape: ${p.realShape}`),
      `- **Slot targets:** ${Object.entries(d.slotTargets).map(([s, v]) => `${s} p50 ${v.p50} / p90 ${v.p90}, ${v.form}`).join('; ')}`,
      `- **Winners vs flops:** ${d.winnersVsFlops}`,
      `- **Tech memes:** ${d.techNotes}`,
      `- **Misreads:**`,
      ...d.misreads.map((m) => `  - ${m}`),
      `- **Test:** ${d.test}`,
      d.slotProblems ? `- **Slot problems:** ${d.slotProblems}${d.slotProposal ? ` Proposal: ${d.slotProposal.why}` : ''}` : '',
      `- **Our examples:**`,
      ...d.examples.map((e) => `  - \`${e.pattern}\` · ${e.story} → ${Object.entries(e.fills).map(([k, v]) => `${k}: ${v}`).join(' / ')}`),
      d.ourMemes.length ? `- **Our memes, coded:**` : '',
      ...d.ourMemes.map((m) => `  - ${m.verdict.toUpperCase()} (Lucas: ${m.lucas}) ${m.text}: ${m.why}`),
      '',
    ].filter((l) => l !== '').join('\n') + '\n',
  );
}

const body = `${START}\n\n${sections.join('\n')}\n${END}`;
const doc = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8') : `# Golden set\n\n${START}\n${END}\n`;
const next = doc.includes(START) ? doc.replace(new RegExp(`${START}[\\s\\S]*${END}`), body) : `${doc}\n\n${body}\n`;
fs.writeFileSync(DOC, next);
console.log(`Wrote ${sections.length} template sections to ${DOC}`);
