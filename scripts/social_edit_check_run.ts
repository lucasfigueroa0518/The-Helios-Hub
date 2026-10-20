/**
 * Helios Social — LIVE Editor → captioner → Fact-checker → mechanical run on
 * saved Writer drafts (Tommy's OK required; --cap-usd required), the same
 * stages and fresh-caption rule as a live run (captionAndCheck). A fresh
 * draft (spec §4.2b) reruns Writer → Editor → captioner → Fact-checker from
 * the same brief, at most MAX_FRESH_DRAFTS times. No Claude call starts
 * unless CALL_RESERVE_USD still fits under the total cap (Claude + Jev). The
 * caption closings log lives in memory for the run (it never writes the
 * shared log), and `final` is the caption as posted, Source line included.
 *
 *   npx tsx scripts/social_edit_check_run.ts --cap-usd 0.75 <name>=<writer.json> …
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

const CALL_RESERVE_USD = 0.2;

async function main() {
  const at = process.argv.indexOf('--cap-usd');
  const cap = at > 0 ? Number(process.argv[at + 1]) : NaN;
  const inputs = process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.split('=') as [string, string]);
  if (!Number.isFinite(cap) || cap <= 0 || inputs.length === 0) throw new Error('usage: --cap-usd <amount> <name>=<writer.json> …');

  const { newAnthropic } = await import('@/lib/anthropic-client');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { validateBrief } = await import('@/lib/social/reporter/brief');
  const { runEditor } = await import('@/lib/social/editor/editor');
  const { runWriter } = await import('@/lib/social/writer/writer');
  const { isWellKnownLive } = await import('@/lib/social/writer/well-known');
  const { MAX_FRESH_DRAFTS } = await import('@/lib/social/pipeline/orchestrator');
  const { captionAndCheck, createScriptCaptionStages, scriptBrief } = await import('@/lib/social/pipeline/caption-check');
  const { createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { priceAnthropicMessages } = await import('@/lib/anthropic-pricing');

  const live = liveMessagesCreate(newAnthropic());
  const jevTally = createJevTally();
  let spent = 0;
  const total = () => spent + jevTally.costUsd;
  const create: typeof live = async (params) => {
    if (total() + CALL_RESERVE_USD > cap) throw new Error(`total cap: $${total().toFixed(4)} spent, a call could pass $${cap}`);
    const res = await live(params);
    spent += Number(priceAnthropicMessages([res as any], { modelId: (params as any).model }).costUsd);
    return res;
  };

  // One captioner for the run, as live: its closings log and Jev fits carry across stories and fresh drafts.
  const tail = createScriptCaptionStages({ create, jev: tallied(createJevAsk(), jevTally) });

  const dir = path.join(process.cwd(), 'runs', `edit-check-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(dir, { recursive: true });
  const summary: unknown[] = [];
  for (const [name, file] of inputs) {
    const saved = JSON.parse(await fsp.readFile(file, 'utf8'));
    const brief = validateBrief(JSON.parse(await fsp.readFile(saved.brief, 'utf8')));
    let writerDraft = saved.result.draft;
    const attempts: unknown[] = [];
    let final: unknown = null;
    let stop: string | null = null;
    for (let attempt = 0; attempt <= MAX_FRESH_DRAFTS; attempt++) {
      let writer = null;
      if (attempt > 0) {
        writer = await runWriter(brief, { create, isWellKnown: isWellKnownLive });
        if (!writer.ok) { attempts.push({ attempt, writer }); stop = `fresh Writer failed: ${writer.detail}`; break; }
        writerDraft = writer.draft;
      }
      const editor = await runEditor(brief, writerDraft, { create });
      if (!editor.ok) { attempts.push({ attempt, writer, writerDraft, editor }); stop = `Editor failed: ${editor.detail}`; break; }
      const seen = { captioner: tail.captioner.length, checks: tail.factCheck.length };
      const out = await captionAndCheck(tail.stages, { storyId: name, submission: editor.draft, filled: editor.filled }, scriptBrief(name, brief));
      const outcome = out.kind === 'ok' ? { kind: out.kind, freshCaptions: out.freshCaptions, costUsd: out.costUsd, mechanical: out.final.mechanical } : out;
      attempts.push({ attempt, writer, writerDraft, editor, captioner: tail.captioner.slice(seen.captioner), checks: tail.factCheck.slice(seen.checks), outcome });
      if (out.kind === 'ok') { final = out.final.filled; break; }
      if (out.kind === 'stopped') { stop = `${out.stage} ${out.reasonCode}: ${out.detail}`; break; }
      if (attempt === MAX_FRESH_DRAFTS) stop = `unfixable-draft: ${out.why}`;
    }
    await fsp.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ writerFile: file, brief: saved.brief, attempts, final, stop }, null, 2));
    summary.push({ name, attempts: attempts.length, freshDrafts: attempts.length - 1, final: !!final, stop });
  }
  console.log(JSON.stringify({ dir: path.relative(process.cwd(), dir), totalUsd: Number(total().toFixed(4)), claudeUsd: Number(spent.toFixed(4)), jev: jevTally, summary }, null, 2));
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
