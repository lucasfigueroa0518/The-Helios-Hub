/**
 * Helios Social rebuild — Step 0 / S2: photo coverage measurement.
 *
 * For every person and company named in past briefs (TERMS), does
 * Wikidata/Commons have a usable photo, and how many have two or more?
 * Sizes the Helios photo bank (spec §5.1 "Measure before building").
 *
 * No AI. Public Wikidata/Commons APIs only, via the pulled image-step
 * plumbing (unchanged). Identity rule: P18 / P180 only — no free-text
 * Commons search for subjects.
 *
 *   npx tsx scripts/social_photo_coverage.ts
 *
 * Writes runs/photo-coverage-<ts>/report.{md,json} (local, untracked).
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { resolveSubject } from '@/lib/social/editorial/v2/image-step/wikidata';
import { findCandidates, type CommonsCandidate } from '@/lib/social/editorial/v2/image-step/commons';

const ROOTS = ['runs', 'exports', 'Claude outputs'];
const USABLE_SHORT_SIDE = 1080;
const RELAXED_SHORT_SIDE = 800;
const DELAY_MS = 250;

// Local copies of the shape regexes in wikidata.ts (private there).
const ORG_RE = /\b(company|corporation|corp|inc\.?|ltd|nonprofit|non-profit|firm|organization|organisation|startup|studio|laboratory|lab|labs|foundation|institute|agency|association|coalition|university|department|ministry|office|commission|division|team|maker|developer|publisher|outlet|newspaper)\b/i;
const PERSON_RE = /\b(person|politician|governor|senator|president|ceo|cto|cfo|coo|founder|co-founder|cofounder|researcher|scientist|journalist|reporter|editor|writer|author|professor|director|actor|actress|musician|singer|artist|athlete|congressman|congresswoman|representative|minister|judge|secretary|chief|head of|lead|manager|engineer|investor|executive|employee|chair|chairman|chairwoman|mayor|attorney)\b/i;

type Term = { name: string; description: string };
type Kind = 'person' | 'org' | 'excluded';

type SubjectRow = {
  name: string;
  kind: Kind;
  description: string;
  brief: string;
  qid?: string;
  qidLabel?: string;
  unresolvedReason?: string;
  usable: number;       // short side ≥ 1080
  relaxed: number;      // short side ≥ 800
  bestLicense?: string;
  bestSource?: string;
  error?: string;
};

// Hand-audited corrections to the keyword classifier (first run,
// 2026-10-04): real people/orgs it missed, and laws/concepts/products it
// let through. Measurement input only — not pipeline logic.
const KIND_OVERRIDES: Record<string, Kind> = {
  'david sacks': 'person',
  'josh gottheimer (d-nj-5)': 'person',
  'rep. mike lawler (r-ny-17)': 'person',
  'rep. nick lalota (r-ny-1)': 'person',
  'anthropic institute': 'org',
  'national security agency (nsa)': 'org',
  'finra (financial industry regulatory authority)': 'org',
  'deepseek': 'org',
  'house ai commission': 'org',
  'united states ai safety institute': 'org',
  'metr / redwood research': 'org',
  'executive order': 'excluded',
  'sb 813': 'excluded',
  'sb 53 / transparency in frontier artificial intelligence act': 'excluded',
  'no deepseek on government devices act': 'excluded',
  'embedded evaluators': 'excluded',
  '"pacing the frontier" open letter': 'excluded',
  '"we must pace the frontier"': 'excluded',
  'frontier model / frontier ai': 'excluded',
  'test harness': 'excluded',
  'independent verification organization': 'excluded',
  'claude': 'excluded',
  'claude design': 'excluded',
  'cc': 'excluded',
};

/**
 * Lookup names, cleanest first: drop a trailing "(…)" and a leading
 * honorific, and split "A / B" into alternatives. Mirrors what a clean
 * SUBJECTS entry in the new brief will hold.
 */
function lookupNames(raw: string): string[] {
  const base = raw
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/^(rep\.|sen\.|senator|governor|gov\.|president|dr\.)\s+/i, '')
    .trim();
  const parts = base.split(/\s+\/\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [raw];
}

function classify(t: Term): Kind {
  const override = KIND_OVERRIDES[t.name.trim().toLowerCase()];
  if (override) return override;
  const d = t.description;
  // Description usually opens with the gloss: "CEO of Anthropic." vs
  // "A San Francisco-based AI safety company". Judge on the first clause.
  const head = d.split(/[;.]/)[0] ?? d;
  const person = PERSON_RE.test(head);
  const org = ORG_RE.test(head);
  // A person gloss leads with a role ("CEO of X"); an org gloss leads with
  // an article + noun ("A ... company"). Ties go to whichever matches first.
  if (person && org) {
    const pi = head.search(PERSON_RE);
    const oi = head.search(ORG_RE);
    return pi <= oi ? 'person' : 'org';
  }
  if (person) return 'person';
  if (org) return 'org';
  return 'excluded';
}

async function findBriefs(): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name === 'brief.json') out.push(p);
    }
  }
  for (const r of ROOTS) await walk(path.join(process.cwd(), r));
  return out.sort();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const briefs = await findBriefs();
  const seen = new Map<string, { term: Term; terms: Term[]; story: string; brief: string }>();
  for (const f of briefs) {
    const raw = JSON.parse(await fsp.readFile(f, 'utf8'));
    const b = raw?.reporterOutput?.brief;
    if (!b) continue;
    const terms: Term[] = (b.terms ?? []).filter((t: Term) => t?.name);
    for (const t of terms) {
      const key = t.name.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, { term: t, terms, story: String(b.story ?? ''), brief: path.relative(process.cwd(), f) });
      }
    }
  }

  const rows: SubjectRow[] = [];
  for (const { term, terms, story, brief } of seen.values()) {
    const kind = classify(term);
    const row: SubjectRow = {
      name: term.name,
      kind,
      description: term.description.slice(0, 120),
      brief,
      usable: 0,
      relaxed: 0,
    };
    rows.push(row);
    if (kind === 'excluded') continue;
    try {
      let res: Awaited<ReturnType<typeof resolveSubject>> = { ok: false, reason: 'no lookup names' };
      for (const name of lookupNames(term.name)) {
        res = await resolveSubject({ subject: name, briefTerms: terms, briefStory: story });
        await sleep(DELAY_MS);
        if (res.ok) break;
      }
      if (!res.ok) {
        row.unresolvedReason = res.reason;
        process.stdout.write(`· ${term.name}: unresolved\n`);
        continue;
      }
      row.qid = res.candidate.id;
      row.qidLabel = `${res.candidate.label} — ${res.candidate.description}`;
      const cands: CommonsCandidate[] = await findCandidates(res.candidate.id, {
        minShortSide: RELAXED_SHORT_SIDE,
        limit: 10,
      });
      await sleep(DELAY_MS);
      row.relaxed = cands.length;
      const usable = cands.filter((c) => Math.min(c.width, c.height) >= USABLE_SHORT_SIDE);
      row.usable = usable.length;
      const best = usable[0] ?? cands[0];
      if (best) {
        row.bestLicense = best.license;
        row.bestSource = best.source;
      }
      process.stdout.write(`· ${term.name}: ${row.qid} usable=${row.usable} relaxed=${row.relaxed}\n`);
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
      process.stdout.write(`· ${term.name}: ERROR ${row.error}\n`);
    }
  }

  const summarize = (kind: Kind) => {
    const set = rows.filter((r) => r.kind === kind);
    return {
      total: set.length,
      resolved: set.filter((r) => r.qid).length,
      usable1: set.filter((r) => r.usable >= 1).length,
      usable2: set.filter((r) => r.usable >= 2).length,
      relaxed1: set.filter((r) => r.relaxed >= 1).length,
      relaxed2: set.filter((r) => r.relaxed >= 2).length,
      errors: set.filter((r) => r.error).length,
    };
  };
  const totals = { person: summarize('person'), org: summarize('org') };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(process.cwd(), 'runs', `photo-coverage-${ts}`);
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(
    path.join(outDir, 'report.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), briefs: briefs.length, totals, rows }, null, 2),
  );

  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
  const line = (k: 'person' | 'org') => {
    const t = totals[k];
    return `| ${k} | ${t.total} | ${t.resolved} (${pct(t.resolved, t.total)}) | ${t.usable1} (${pct(t.usable1, t.total)}) | ${t.usable2} (${pct(t.usable2, t.total)}) | ${t.relaxed1} | ${t.relaxed2} | ${t.errors} |`;
  };
  const md: string[] = [
    `# S2 photo coverage — ${new Date().toISOString()}`,
    '',
    `Briefs scanned: ${briefs.length}. Unique TERMS: ${rows.length}. Wikidata/Commons only (P18 + P180), no AI, no free-text search.`,
    `"Usable" = short side ≥ ${USABLE_SHORT_SIDE}px, allowed licence (PD/CC0, CC BY, CC BY-SA), author known. "Relaxed" = ≥ ${RELAXED_SHORT_SIDE}px.`,
    '',
    '| kind | subjects | resolved to QID | ≥1 usable | ≥2 usable | ≥1 relaxed | ≥2 relaxed | errors |',
    '|---|---|---|---|---|---|---|---|',
    line('person'),
    line('org'),
    '',
    '## Per subject',
    '',
    '| subject | kind | QID | usable | relaxed | best licence | source | note |',
    '|---|---|---|---|---|---|---|---|',
    ...rows
      .filter((r) => r.kind !== 'excluded')
      .map((r) => `| ${r.name} | ${r.kind} | ${r.qid ?? ''} | ${r.usable} | ${r.relaxed} | ${r.bestLicense ?? ''} | ${r.bestSource ?? ''} | ${(r.error ?? r.unresolvedReason ?? r.qidLabel ?? '').replace(/\|/g, '/').slice(0, 110)} |`),
    '',
    '## Excluded (classified as concept/other by code)',
    '',
    ...rows.filter((r) => r.kind === 'excluded').map((r) => `- ${r.name} — ${r.description.replace(/\n/g, ' ')}`),
    '',
  ];
  await fsp.writeFile(path.join(outDir, 'report.md'), md.join('\n'));

  console.log('\nTotals:', JSON.stringify(totals, null, 2));
  console.log(`Report: ${path.relative(process.cwd(), outDir)}/report.md`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
