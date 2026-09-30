/**
 * Offline A/B validation for the fact-first Writer + Editor prompts.
 * Second pass (2026-09-30): Sonnet field-scoped length repairs, outline
 * validation before Editor, cover carries an "answers Q?" annotation,
 * fact-checker run after Editor, one full-Editor repair round on FC flags.
 *
 * Reads saved briefs + sources from run transcripts, writes results to
 * "Claude outputs/copy-ab/<slug>/".
 *
 * Usage: npx tsx scripts/copy_rewrite_ab.ts
 */
import fs from 'node:fs';
import path from 'node:path';

// Load env before importing modules that use ANTHROPIC_API_KEY.
{
  const root = '/Users/tommypozo/Desktop/HELIOS/The-Helios-Hub';
  const envPath = path.join(root, '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/\r$/, '');
    }
  }
}

import { promises as fsp } from 'node:fs';

const ROOT = '/Users/tommypozo/Desktop/HELIOS/The-Helios-Hub';
const OUT_ROOT = path.join(ROOT, 'Claude outputs', 'copy-ab');

type RunSpec = { slug: string; transcriptDir: string };

const RUNS: RunSpec[] = [
  { slug: 'google-cc', transcriptDir: 'runs/2026-09-29T03-38-05-457Z' },
  { slug: 'gottheimer', transcriptDir: 'runs/2026-09-29T19-50-15-796Z' },
  { slug: 'suleyman', transcriptDir: 'runs/2026-09-29T16-40-07-763Z' },
  { slug: 'newsom', transcriptDir: 'runs/2026-09-29T02-28-32-764Z' },
];

/** Set to `false` to skip the fact-checker (Writer + Editor + length repair only). */
const RUN_FACT_CHECKER = true;

async function loadBriefAndSources(spec: RunSpec) {
  const t = JSON.parse(await fsp.readFile(path.join(ROOT, spec.transcriptDir, 'transcript.json'), 'utf-8'));
  const debug = t.debug ?? t;
  const brief = debug.reporter?.brief;
  const briefRaw = debug.reporter?.briefRaw ?? '';
  const sourcesArr = debug.sources ?? [];
  const sourceTexts = sourcesArr.map((s: { url: string; title?: string; text?: string }) => ({
    url: s.url,
    title: s.title ?? null,
    text: s.text ?? '',
  }));
  if (!brief) throw new Error(`${spec.slug}: no debug.reporter.brief in transcript`);
  return { brief, briefRaw, sourceTexts };
}

async function main() {
  const { runWriter } = await import('@/lib/social/editorial/v2/writer');
  const { runEditor } = await import('@/lib/social/editorial/v2/editor');
  const { runFactChecker } = await import('@/lib/social/editorial/v2/fact-checker');
  const { runFieldRepair } = await import('@/lib/social/editorial/v2/field-repair');
  const { parseDraft } = await import('@/lib/social/editorial/v2/parse');
  const codeChecks = await import('@/lib/social/editorial/v2/code-checks');
  const {
    checkPost, checkSlideRepeats, checkCoverClaimUniqueness,
    validateOutline, partitionErrors, LIMITS,
  } = codeChecks;

  await fsp.mkdir(OUT_ROOT, { recursive: true });

  let grandCost = 0;
  const rows: PostRow[] = [];

  for (const spec of RUNS) {
    console.log(`\n=== ${spec.slug} ===`);
    const outDir = path.join(OUT_ROOT, spec.slug);
    await fsp.mkdir(outDir, { recursive: true });

    const { brief, briefRaw, sourceTexts } = await loadBriefAndSources(spec);
    console.log(`  brief: ${brief.terms.length} terms, ${sourceTexts.length} sources`);

    // 1. Writer.
    console.log('  writing…');
    let w = await runWriter({ brief, briefRaw, sourceTexts });
    await fsp.writeFile(path.join(outDir, 'writer-raw.txt'), w.raw, 'utf-8');
    let writerCost = w.usage.approxCostUsd;
    console.log(`    writer cost $${w.usage.approxCostUsd.toFixed(4)}, stop=${w.stopReasons.join(',')}`);

    // 2. Validate the Writer's OUTLINE. Retry once with errors on fail.
    let outlineErrors = runOutlineValidation(w.raw, validateOutline as unknown as (o: unknown) => { ok: boolean; errors: Array<{ message: string }> });
    if (outlineErrors.length > 0) {
      console.log(`    outline validation: ${outlineErrors.length} error(s); retrying Writer with OUTLINE CHECK ERRORS`);
      const retry = await runWriter({
        brief, briefRaw, sourceTexts,
        outlineCheckErrors: outlineErrors.map((e) => ({ message: e })),
        previousDraftRaw: w.raw,
      });
      writerCost += retry.usage.approxCostUsd;
      await fsp.writeFile(path.join(outDir, 'writer-retry-raw.txt'), retry.raw, 'utf-8');
      console.log(`    writer retry cost $${retry.usage.approxCostUsd.toFixed(4)}`);
      w = retry;
      outlineErrors = runOutlineValidation(w.raw, validateOutline as unknown as (o: unknown) => { ok: boolean; errors: Array<{ message: string }> });
      console.log(`    outline validation after retry: ${outlineErrors.length} error(s)`);
    }

    // 3. Parse READER QUESTIONS + which Qs are answered (slides + cover).
    const readerQuestions = parseReaderQuestions(w.raw);
    const answeredQids = new Set<string>([
      ...extractAnsweredQidsFromOutline(w.raw),
      ...extractCoverAnsweredQid(w.raw),
    ]);
    const unusedFacts = readerQuestions.filter((q) => !answeredQids.has(q.qid));
    await fsp.writeFile(path.join(outDir, 'reader-questions.json'), JSON.stringify({
      readerQuestions, answeredQids: [...answeredQids], unusedFacts,
    }, null, 2), 'utf-8');
    console.log(`    ${readerQuestions.length} reader questions, ${answeredQids.size} answered, ${unusedFacts.length} unused`);

    // 4. Editor, primary pass.
    console.log('  editing…');
    const unusedFactsBlock = unusedFacts.length > 0 ? buildUnusedFactsBlock(unusedFacts) : undefined;
    const editorInput = {
      brief, briefRaw, sourceTexts,
      post: w.raw,
      lengthsBlock: unusedFactsBlock,
    };
    let e = await runEditor(editorInput);
    await fsp.writeFile(path.join(outDir, 'editor-raw.txt'), e.raw, 'utf-8');
    const editorCost = e.usage.approxCostUsd;
    console.log(`    editor cost $${e.usage.approxCostUsd.toFixed(4)}, stop=${e.stopReasons.join(',')}`);

    // 5. Run code checks.
    let currentPost = e.post;
    let currentRaw = e.raw;
    let fieldRepairCost = 0;
    let fullEditorRepairCost = 0;
    let fcCost = 0;
    let fcVerdict: string | null = null;
    let fcFlags: unknown[] = [];
    let ranFactCheck = false;

    // 5a. Field-scoped Sonnet repairs for char_limit errors, until either
    //     everything fits or we hit a per-post repair budget of 2 rounds
    //     across all fields.
    const MAX_FIELD_REPAIR_ROUNDS = 2;
    for (let round = 0; round < MAX_FIELD_REPAIR_ROUNDS; round += 1) {
      const primaryChecks = checkPost(currentPost, brief);
      const charLimitErrors = primaryChecks.errors.filter((err) => err.kind === 'char_limit');
      if (charLimitErrors.length === 0) break;
      console.log(`  field-repair round ${round + 1}: ${charLimitErrors.length} char_limit error(s)`);
      const repairs: FieldRepairEntry[] = [];
      for (const err of charLimitErrors) {
        const target = err.field ?? inferFieldFromMessage(err.message);
        const currentText = extractFieldText(currentPost, err, target);
        if (!currentText) continue;
        const limit = extractLimitFromMessage(err.message);
        const label = err.target === 'cover' ? 'COVER TEXT'
          : err.target === 'follow' ? 'FOLLOW'
          : `SLIDE ${err.slidePosition ?? '?'} ${target}`;
        const adjacent = err.target === 'slide' && err.slidePosition
          ? summarizeAdjacent(currentPost, err.slidePosition, target)
          : undefined;
        const src = pickSourceExcerpt(currentText, sourceTexts, 800);
        const fr = await runFieldRepair({
          fieldLabel: label,
          currentText,
          limit,
          sourceExcerpt: src,
          adjacentSummary: adjacent,
        });
        fieldRepairCost += fr.usage.approxCostUsd;
        repairs.push({ label, oldChars: currentText.length, newChars: fr.newText.length, limit, stillOver: fr.stillOver });
        applyFieldTo(currentPost, err, target, fr.newText);
      }
      currentRaw = serializePost(currentPost);
      await fsp.writeFile(
        path.join(outDir, `field-repair-round-${round + 1}.json`),
        JSON.stringify(repairs, null, 2),
        'utf-8',
      );
      console.log(`    field repairs: ${repairs.map((r) => `${r.label}:${r.oldChars}→${r.newChars}/${r.limit}${r.stillOver ? '(still over)' : ''}`).join(', ')}`);
    }

    // 5b. For remaining SOFT errors that aren't char_limit (highlight,
    //     rhythm, slide_repeats, cover_claim_uniqueness, term_unexplained,
    //     variety), do a single full-Editor pass. Skip if none.
    const postFieldChecks = checkPost(currentPost, brief);
    const repeats = checkSlideRepeats(currentPost, brief);
    const coverClaim = checkCoverClaimUniqueness(currentPost, brief);
    const nonLengthSoft = [
      ...postFieldChecks.errors.filter((err) => err.kind !== 'char_limit'),
      ...repeats.errors,
      ...coverClaim.errors,
    ];
    const partitioned = partitionErrors(nonLengthSoft);
    if (partitioned.hard.length + partitioned.soft.length > 0) {
      console.log(`  editor repair round (Sonnet): ${partitioned.hard.length} hard + ${partitioned.soft.length} soft non-length checks`);
      const checkErrors = nonLengthSoft.map((err) => ({
        kind: err.kind,
        target: err.target,
        slidePosition: err.slidePosition,
        field: err.field,
        message: err.message,
      }));
      const r = await runEditor({
        ...editorInput,
        post: currentRaw,
        checkErrors,
        // Repair-mode routes to REPAIR_EDITOR_MODEL (now Sonnet).
        mode: 'repair',
      });
      fullEditorRepairCost += r.usage.approxCostUsd;
      await fsp.writeFile(path.join(outDir, 'editor-repair-raw.txt'), r.raw, 'utf-8');
      currentPost = r.post;
      currentRaw = r.raw;
      console.log(`    editor repair cost $${r.usage.approxCostUsd.toFixed(4)}`);
    }

    // 6. Fact-checker (optional).
    if (RUN_FACT_CHECKER) {
      console.log('  fact-checker…');
      ranFactCheck = true;
      const fc = await runFactChecker({
        brief, briefRaw, sourceTexts,
        post: serializeForFactChecker(currentPost),
        caption: '', // no caption stage in this test
      });
      fcCost = fc.usage.approxCostUsd;
      fcVerdict = fc.result.verdict;
      fcFlags = fc.result.flags;
      await fsp.writeFile(path.join(outDir, 'fact-check.json'), JSON.stringify({
        verdict: fc.result.verdict, flags: fc.result.flags, cost: fc.usage.approxCostUsd,
      }, null, 2), 'utf-8');
      await fsp.writeFile(path.join(outDir, 'fact-check-raw.txt'), fc.raw, 'utf-8');
      console.log(`    fact-checker: ${fc.result.verdict}, ${fc.result.flags.length} flag(s), $${fc.usage.approxCostUsd.toFixed(4)}`);

      // 6a. One full-Editor repair round if FLAGGED. Sonnet.
      if (fc.result.verdict === 'FLAGGED' && fc.result.flags.length > 0) {
        console.log('  fc-repair (Sonnet)…');
        const r = await runEditor({
          ...editorInput,
          post: currentRaw,
          factCheckFlags: fc.result.flags,
          mode: 'repair',
        });
        fullEditorRepairCost += r.usage.approxCostUsd;
        await fsp.writeFile(path.join(outDir, 'editor-fc-repair-raw.txt'), r.raw, 'utf-8');
        currentPost = r.post;
        currentRaw = r.raw;
        console.log(`    fc-repair cost $${r.usage.approxCostUsd.toFixed(4)}`);

        // Rerun fact-checker once to see if the repair converged.
        const fc2 = await runFactChecker({
          brief, briefRaw, sourceTexts,
          post: serializeForFactChecker(currentPost),
          caption: '',
        });
        fcCost += fc2.usage.approxCostUsd;
        fcVerdict = fc2.result.verdict;
        fcFlags = fc2.result.flags;
        await fsp.writeFile(path.join(outDir, 'fact-check-2.json'), JSON.stringify({
          verdict: fc2.result.verdict, flags: fc2.result.flags, cost: fc2.usage.approxCostUsd,
        }, null, 2), 'utf-8');
        console.log(`    fc round 2: ${fc2.result.verdict}, ${fc2.result.flags.length} flag(s), $${fc2.usage.approxCostUsd.toFixed(4)}`);
      }
    }

    // 7. Save final post + summary.
    await fsp.writeFile(path.join(outDir, 'post.json'), JSON.stringify(currentPost, null, 2), 'utf-8');
    const finalPrimary = checkPost(currentPost, brief);
    const finalRepeats = checkSlideRepeats(currentPost, brief);
    const finalCoverClaim = checkCoverClaimUniqueness(currentPost, brief);
    const finalAll = [
      ...finalPrimary.errors,
      ...finalRepeats.errors,
      ...finalCoverClaim.errors,
    ];
    const finalPartitioned = partitionErrors(finalAll);
    await fsp.writeFile(path.join(outDir, 'code-check-report.json'), JSON.stringify({
      finalErrors: finalAll,
      finalHardCount: finalPartitioned.hard.length,
      finalSoftCount: finalPartitioned.soft.length,
    }, null, 2), 'utf-8');
    await fsp.writeFile(path.join(outDir, 'summary.txt'), buildSummary({
      slug: spec.slug,
      brief,
      readerQuestions,
      unusedFacts,
      post: currentPost,
      finalErrors: finalAll,
      fcVerdict,
      fcFlags,
    }), 'utf-8');

    const total = writerCost + editorCost + fieldRepairCost + fullEditorRepairCost + fcCost;
    grandCost += total;
    rows.push({
      slug: spec.slug,
      writerCost, editorCost, fieldRepairCost, fullEditorRepairCost, fcCost,
      total,
      hardAfter: finalPartitioned.hard.length,
      softAfter: finalPartitioned.soft.length,
      slideCount: currentPost.slides.length,
      fcVerdict,
      fcFlagsAfter: (fcFlags as unknown[]).length,
      ranFactCheck,
    });
    console.log(`  total for ${spec.slug}: $${total.toFixed(4)}`);
  }

  const grandRow = { grandTotalCost: Number(grandCost.toFixed(4)), perPost: rows };
  await fsp.writeFile(path.join(OUT_ROOT, 'summary.json'), JSON.stringify(grandRow, null, 2), 'utf-8');
  console.log(`\n=== GRAND TOTAL: $${grandCost.toFixed(4)} across ${rows.length} posts ===`);
  for (const r of rows) {
    const fc = r.ranFactCheck ? ` fc:${r.fcVerdict}(${r.fcFlagsAfter})` : '';
    console.log(`  ${r.slug}: $${r.total.toFixed(4)} (W $${r.writerCost.toFixed(4)}, E $${r.editorCost.toFixed(4)}, FR $${r.fieldRepairCost.toFixed(4)}, ER $${r.fullEditorRepairCost.toFixed(4)}, FC $${r.fcCost.toFixed(4)}), ${r.hardAfter} hard, ${r.softAfter} soft, ${r.slideCount} slides${fc}`);
  }
}

// ── helpers ──────────────────────────────────────────────────────────

type PostRow = {
  slug: string;
  writerCost: number;
  editorCost: number;
  fieldRepairCost: number;
  fullEditorRepairCost: number;
  fcCost: number;
  total: number;
  hardAfter: number;
  softAfter: number;
  slideCount: number;
  fcVerdict: string | null;
  fcFlagsAfter: number;
  ranFactCheck: boolean;
};

type FieldRepairEntry = {
  label: string;
  oldChars: number;
  newChars: number;
  limit: number;
  stillOver: boolean;
};

function parseReaderQuestions(raw: string): Array<{ qid: string; question: string; fact: string }> {
  const m = raw.match(/(^|\n)READER QUESTIONS:\s*\n([\s\S]*?)\n(?:OUTLINE|COVER OPTIONS|COVER):/);
  if (!m) return [];
  const out: Array<{ qid: string; question: string; fact: string }> = [];
  for (const line of m[2]!.split('\n')) {
    const q = line.trim().match(/^(Q\d+):\s*(.+?)\s+[—-]\s+(.+)$/);
    if (q) out.push({ qid: q[1]!, question: q[2]!.trim(), fact: q[3]!.trim() });
  }
  return out;
}

function extractAnsweredQidsFromOutline(raw: string): Set<string> {
  const set = new Set<string>();
  const m = raw.match(/(^|\n)OUTLINE:\s*\n([\s\S]*?)(?=\n(?:COVER OPTIONS|COVER):|$)/);
  if (!m) return set;
  for (const line of m[2]!.split('\n')) {
    for (const q of line.matchAll(/\bQ(\d+)\b/g)) set.add(`Q${q[1]!}`);
  }
  return set;
}

/** Cover carries its Q via a `COVER ANSWERS: Q?` line and / or annotations
 *  inline on the option lines. */
function extractCoverAnsweredQid(raw: string): Set<string> {
  const set = new Set<string>();
  const answersLine = raw.match(/(?:^|\n)COVER ANSWERS:\s*(Q\d+)/i);
  if (answersLine) set.add(answersLine[1]!.toUpperCase());
  // Fallback: scan CHOSEN option's line for an "answers Q?" annotation.
  const chosen = raw.match(/(?:^|\n)CHOSEN:\s*(\d+)/);
  if (chosen) {
    const num = chosen[1]!;
    const optRe = new RegExp(`(?:^|\\n)\\s*${num}\\.\\s+.*?answers\\s+(Q\\d+)`, 'i');
    const optMatch = raw.match(optRe);
    if (optMatch) set.add(optMatch[1]!.toUpperCase());
  }
  return set;
}

function buildUnusedFactsBlock(unused: Array<{ qid: string; question: string; fact: string }>): string {
  const lines = ['UNUSED BRIEF FACTS (reader questions from your list that no slide currently answers — pull from here if you need to swap a fact during repair):'];
  for (const q of unused) lines.push(`- ${q.qid}: ${q.question} — ${q.fact}`);
  return lines.join('\n');
}

function runOutlineValidation(rawWriterOutput: string, validate: (outline: unknown) => { ok: boolean; errors: Array<{ message: string }> }): string[] {
  const m = rawWriterOutput.match(/(^|\n)OUTLINE:\s*\n([\s\S]*?)(?=\n(?:COVER OPTIONS|COVER):|$)/);
  if (!m) return ['Writer did not emit an OUTLINE: block'];
  const outline: Array<Record<string, unknown>> = [];
  for (const line of m[2]!.split('\n')) {
    const stripped = line.trim();
    if (!stripped) continue;
    const parsed = parseOutlineLine(stripped);
    if (parsed) outline.push(parsed);
  }
  const report = validate(outline as unknown);
  return report.errors.map((e) => e.message);
}

function parseOutlineLine(line: string): Record<string, unknown> | null {
  const m = line.match(/^SLIDE\s+(\d+):\s*(text|landing|stat|split_stat|quote|image)\s*—\s*(?:answers\s+Q\d+\s*—\s*)?(.+)$/i);
  if (!m) return null;
  const position = Number(m[1]);
  const kind = m[2]!.toLowerCase();
  const rest = m[3]!;
  const out: Record<string, unknown> = { position, kind };
  // Parse "FIELD: value | FIELD: value" pattern for non-text kinds.
  const pairs = rest.split('|').map((p) => p.trim());
  for (const pair of pairs) {
    const kv = pair.match(/^(HEADLINE|NOTE|BY|QUOTE|BIG|SECOND NOTE|SECOND):\s*(.+)$/i);
    if (kv) {
      const key = kv[1]!.toUpperCase();
      const val = kv[2]!.trim().replace(/^"|"$/g, '');
      if (key === 'HEADLINE') out.headline = val;
      else if (key === 'NOTE') out.note = val;
      else if (key === 'BY') out.quoteBy = val;
      else if (key === 'QUOTE') out.quote = val;
      else if (key === 'BIG') out.bigNumber = val;
      else if (key === 'SECOND') out.secondNumber = val;
      else if (key === 'SECOND NOTE') out.secondNote = val;
    }
  }
  return out;
}

function inferFieldFromMessage(msg: string): string {
  const m = msg.match(/\b(HEADLINE|BODY|NOTE|BIG NUMBER|NUMBER NOTE|SECOND NUMBER|SECOND NOTE|QUOTE|QUOTE BY|COVER|FOLLOW|TEXT|HIGHLIGHT|IMAGE)\b/);
  return m ? m[1]!.toUpperCase() : 'BODY';
}

function extractLimitFromMessage(msg: string): number {
  const m = msg.match(/limit\s+(\d+)/i);
  return m ? Number(m[1]) : 220;
}

function extractFieldText(post: { cover: { text?: string }; follow?: string; slides: Array<{ position: number; headline?: string; body?: string; note?: string; quote?: string; quoteBy?: string; bigNumber?: string; numberNote?: string; secondNumber?: string; secondNote?: string; highlight?: string; image?: string }> }, err: { target: string; slidePosition?: number }, field: string): string {
  if (err.target === 'cover') return post.cover?.text ?? '';
  if (err.target === 'follow') return post.follow ?? '';
  const s = post.slides.find((x) => x.position === err.slidePosition);
  if (!s) return '';
  const key = fieldToKey(field);
  return (s as unknown as Record<string, string>)[key] ?? '';
}

function applyFieldTo(post: { cover: { text?: string }; follow?: string; slides: Array<{ position: number }> }, err: { target: string; slidePosition?: number }, field: string, newText: string) {
  if (err.target === 'cover') {
    (post.cover as { text?: string }).text = newText;
    return;
  }
  if (err.target === 'follow') {
    (post as { follow?: string }).follow = newText;
    return;
  }
  const s = post.slides.find((x) => x.position === err.slidePosition);
  if (!s) return;
  (s as unknown as Record<string, string>)[fieldToKey(field)] = newText;
}

function fieldToKey(field: string): string {
  const map: Record<string, string> = {
    HEADLINE: 'headline',
    BODY: 'body',
    NOTE: 'note',
    'BIG NUMBER': 'bigNumber',
    'NUMBER NOTE': 'numberNote',
    'SECOND NUMBER': 'secondNumber',
    'SECOND NOTE': 'secondNote',
    QUOTE: 'quote',
    'QUOTE BY': 'quoteBy',
    HIGHLIGHT: 'highlight',
    IMAGE: 'image',
    'COVER TEXT': 'text',
    'COVER HIGHLIGHT': 'highlight',
    'COVER IMAGE': 'image',
    'COVER': 'text',
    'FOLLOW': 'follow',
    'TEXT': 'text',
  };
  return map[field.toUpperCase()] ?? field.toLowerCase();
}

function summarizeAdjacent(post: { slides: Array<{ position: number; headline?: string; body?: string; note?: string; quote?: string; bigNumber?: string; numberNote?: string }> }, slidePosition: number, thisField: string): string {
  const s = post.slides.find((x) => x.position === slidePosition);
  if (!s) return '';
  const bits: string[] = [];
  if (thisField !== 'HEADLINE' && s.headline) bits.push(`HEADLINE: ${s.headline}`);
  if (thisField !== 'BODY' && s.body) bits.push(`BODY (${s.body.length} chars): ${s.body.slice(0, 120)}`);
  if (thisField !== 'NOTE' && s.note) bits.push(`NOTE: ${s.note}`);
  if (thisField !== 'QUOTE' && s.quote) bits.push(`QUOTE: ${s.quote.slice(0, 120)}`);
  if (thisField !== 'BIG NUMBER' && s.bigNumber) bits.push(`BIG NUMBER: ${s.bigNumber}`);
  if (thisField !== 'NUMBER NOTE' && s.numberNote) bits.push(`NUMBER NOTE: ${s.numberNote}`);
  return bits.join(' | ');
}

/**
 * Pick the sentences from the source texts that best match the current
 * field text (naive: which source paragraph has the most token overlap).
 * Returned excerpt is capped at ~800 chars so the field-repair prompt
 * stays small.
 */
function pickSourceExcerpt(currentText: string, sourceTexts: Array<{ url: string; text: string }>, maxChars: number): string {
  if (sourceTexts.length === 0) return '';
  const currentTokens = new Set(currentText.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4));
  if (currentTokens.size === 0) return sourceTexts[0]!.text.slice(0, maxChars);
  let best = { score: -1, excerpt: '' };
  for (const src of sourceTexts) {
    const paragraphs = src.text.split(/\n{2,}/);
    for (const p of paragraphs) {
      const tokens = p.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
      let score = 0;
      for (const t of tokens) if (currentTokens.has(t)) score += 1;
      if (score > best.score) best = { score, excerpt: p.trim() };
    }
  }
  return best.excerpt.slice(0, maxChars);
}

function serializePost(post: { cover?: { text?: string; highlight?: string; image?: string }; slides: Array<{ position: number; headline?: string; body?: string; note?: string; quote?: string; quoteBy?: string; bigNumber?: string; numberNote?: string; secondNumber?: string; secondNote?: string; highlight?: string; image?: string }>; follow?: string }): string {
  const lines: string[] = [];
  const c = post.cover ?? {};
  lines.push(`COVER: ${c.text ?? ''}`);
  if (c.highlight) lines.push(`COVER HIGHLIGHT: ${c.highlight}`);
  if (c.image) lines.push(`COVER IMAGE: ${c.image}`);
  lines.push('');
  for (const s of post.slides) {
    lines.push(`SLIDE ${s.position}`);
    if (s.headline) lines.push(`HEADLINE: ${s.headline}`);
    if (s.body) lines.push(`BODY: ${s.body}`);
    if (s.note) lines.push(`NOTE: ${s.note}`);
    if (s.bigNumber) lines.push(`BIG NUMBER: ${s.bigNumber}`);
    if (s.numberNote) lines.push(`NUMBER NOTE: ${s.numberNote}`);
    if (s.secondNumber) lines.push(`SECOND NUMBER: ${s.secondNumber}`);
    if (s.secondNote) lines.push(`SECOND NOTE: ${s.secondNote}`);
    if (s.quote) lines.push(`QUOTE: ${s.quote}`);
    if (s.quoteBy) lines.push(`QUOTE BY: ${s.quoteBy}`);
    if (s.highlight) lines.push(`HIGHLIGHT: ${s.highlight}`);
    if (s.image) lines.push(`IMAGE: ${s.image}`);
    lines.push('');
  }
  if (post.follow) lines.push(`FOLLOW: ${post.follow}`);
  return lines.join('\n');
}

function serializeForFactChecker(post: { cover?: { text?: string; image?: string }; slides: Array<{ position: number; headline?: string; body?: string; note?: string; quote?: string; quoteBy?: string; bigNumber?: string; numberNote?: string; secondNumber?: string; secondNote?: string; highlight?: string; image?: string }>; follow?: string }): string {
  return serializePost(post);
}

function buildSummary(input: {
  slug: string;
  brief: { news: string; terms: Array<{ name: string }> };
  readerQuestions: Array<{ qid: string; question: string; fact: string }>;
  unusedFacts: Array<{ qid: string; question: string; fact: string }>;
  post: { cover: { text?: string; kind?: string; image?: string }; slides: Array<{ position: number; headline?: string; body?: string; note?: string; quote?: string; quoteBy?: string; bigNumber?: string; numberNote?: string; secondNumber?: string; secondNote?: string; highlight?: string; image?: string }>; follow?: string };
  finalErrors: Array<{ kind: string; slidePosition?: number; target: string; message: string }>;
  fcVerdict: string | null;
  fcFlags: unknown[];
}): string {
  const out: string[] = [];
  out.push(`# ${input.slug}`);
  out.push('');
  out.push(`THE NEWS: ${input.brief.news}`);
  out.push(`TERMS: ${input.brief.terms.length}`);
  out.push('');
  out.push(`## READER QUESTIONS (${input.readerQuestions.length})`);
  for (const q of input.readerQuestions) out.push(`- ${q.qid}: ${q.question}  ← ${q.fact}`);
  out.push('');
  out.push(`## UNUSED (${input.unusedFacts.length})`);
  for (const q of input.unusedFacts) out.push(`- ${q.qid}`);
  out.push('');
  out.push('## FINAL SLIDES');
  out.push('');
  out.push(`COVER: ${input.post.cover?.text ?? '(missing)'}`);
  if (input.post.cover?.image) out.push(`COVER IMAGE: ${input.post.cover.image}`);
  out.push('');
  for (const s of input.post.slides) {
    out.push(`SLIDE ${s.position} — ${classifyKind(s)}`);
    if (s.headline) out.push(`  HEADLINE: ${s.headline}`);
    if (s.body) out.push(`  BODY: ${s.body}`);
    if (s.note) out.push(`  NOTE: ${s.note}`);
    if (s.bigNumber) out.push(`  BIG NUMBER: ${s.bigNumber}`);
    if (s.numberNote) out.push(`  NUMBER NOTE: ${s.numberNote}`);
    if (s.secondNumber) out.push(`  SECOND NUMBER: ${s.secondNumber}`);
    if (s.secondNote) out.push(`  SECOND NOTE: ${s.secondNote}`);
    if (s.quote) out.push(`  QUOTE: ${s.quote}`);
    if (s.quoteBy) out.push(`  QUOTE BY: ${s.quoteBy}`);
    if (s.highlight) out.push(`  HIGHLIGHT: ${s.highlight}`);
    if (s.image) out.push(`  IMAGE: ${s.image}`);
    out.push('');
  }
  if (input.post.follow) {
    out.push(`FOLLOW: ${input.post.follow}`);
    out.push('');
  }
  if (input.fcVerdict !== null) {
    out.push(`## FACT-CHECK: ${input.fcVerdict} (${input.fcFlags.length} flag(s) after repair)`);
    for (const f of input.fcFlags as Array<{ size: string; where: string; text: string; problem: string; sourcesSay: string }>) {
      out.push(`- [${f.size}] ${f.where}`);
      out.push(`    TEXT: ${(f.text ?? '').slice(0, 160)}`);
      out.push(`    PROBLEM: ${(f.problem ?? '').slice(0, 200)}`);
    }
    out.push('');
  }
  out.push(`## CODE CHECKS (${input.finalErrors.length})`);
  for (const err of input.finalErrors) {
    out.push(`- [${err.kind}] ${err.target}${err.slidePosition ? ` s${err.slidePosition}` : ''}: ${err.message.slice(0, 200)}`);
  }
  return out.join('\n');
}

function classifyKind(s: { quote?: string; secondNumber?: string; bigNumber?: string; image?: string; headline?: string; body?: string }): string {
  if (s.quote) return 'quote';
  if (s.secondNumber) return 'split_stat';
  if (s.bigNumber) return 'stat';
  if (s.image && /^brief image\s+\d+/i.test(s.image) && s.headline && !s.body) return 'image';
  if (s.headline && !s.body) return 'landing';
  return 'text';
}

main().catch((e) => {
  console.error('ERR:', e);
  process.exit(1);
});
