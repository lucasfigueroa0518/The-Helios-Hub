/**
 * Helios Social — LIVE Editor + Fact-checker run on saved Writer drafts
 * (Tommy's OK required; --cap-usd required). A fresh draft (spec §4.2b)
 * reruns Writer → Editor → Fact-checker from the same brief, at most
 * MAX_FRESH_DRAFTS times. No Claude call starts unless CALL_RESERVE_USD
 * still fits under the total cap.
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

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { validateBrief } = await import('@/lib/social/reporter/brief');
  const { runEditor } = await import('@/lib/social/editor/editor');
  const { runFactCheck } = await import('@/lib/social/factcheck/factcheck');
  const { runWriter } = await import('@/lib/social/writer/writer');
  const { isWellKnownLive } = await import('@/lib/social/writer/well-known');
  const { fillDraft } = await import('@/lib/social/writer/draft');
  const { MAX_FRESH_DRAFTS } = await import('@/lib/social/pipeline/orchestrator');
  const { priceAnthropicMessages } = await import('@/lib/anthropic-pricing');

  const live = liveMessagesCreate(new Anthropic());
  let spent = 0;
  const create: typeof live = async (params) => {
    if (spent + CALL_RESERVE_USD > cap) throw new Error(`total cap: $${spent.toFixed(4)} spent, a call could pass $${cap}`);
    const res = await live(params);
    spent += Number(priceAnthropicMessages([res as any], { modelId: (params as any).model }).costUsd);
    return res;
  };

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
      const check = await runFactCheck(brief, { submission: editor.draft, filled: editor.filled }, { create });
      attempts.push({ attempt, writer, writerDraft, editor, check });
      if (!check.ok) { stop = `Fact-checker failed: ${check.detail}`; break; }
      if (check.outcome.kind === 'ok') { final = fillDraft(check.outcome.draft, brief); break; }
      if (check.outcome.kind === 'set-aside') { stop = `set aside: ${check.outcome.why}`; break; }
      if (attempt === MAX_FRESH_DRAFTS) stop = `unfixable-draft: ${check.outcome.why}`;
    }
    await fsp.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ writerFile: file, brief: saved.brief, attempts, final, stop }, null, 2));
    summary.push({ name, attempts: attempts.length, freshDrafts: attempts.length - 1, final: !!final, stop });
  }
  console.log(JSON.stringify({ dir: path.relative(process.cwd(), dir), totalUsd: Number(spent.toFixed(4)), summary }, null, 2));
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
