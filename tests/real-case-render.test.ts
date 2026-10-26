import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { ExplainersDb } from '@/lib/explainers/db';
import type { AgentMessage, AgentQuery } from '@/lib/explainers/render/agent';
import { localArtifactStore } from '@/lib/explainers/storage';
import { claimNextRealCaseJob, getRealCaseJob, listRealCaseArtifacts, requestStoryRender } from '@/lib/real-case/jobs';
import { FACT_FINDINGS_FILE, type FactChecker, type SentenceVerdict } from '@/lib/real-case/render/fact-check';
import { RC_BUILD_PROMPT, RC_PLAN_PROMPT, runRealCaseJob } from '@/lib/real-case/render/job';
import { applyRealCaseOverlay, realCaseFrameMd } from '@/lib/real-case/render/workspace';
import { addStory, getStory, setStoryStatus } from '@/lib/real-case/repository';
import { ensureRealCaseSchema } from '@/lib/real-case/schema';
import { loadRealCaseSettings } from '@/lib/real-case/settings';
import type { StoryClaim } from '@/lib/real-case/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { OBJECT_HERO_OPENERS } from '../explainers/world-kit/openers/bank.js';

import { scratchExplainersDb } from './explainers-pglite';

// The lint fixture's fictional story (invented bakery, invented facts): the plan the fake director writes.
const FIXTURE = path.join(process.cwd(), 'explainers', 'real-case', 'lint', 'fixtures', 'good');
const PLAN_STORYBOARD = fs.readFileSync(path.join(FIXTURE, 'STORYBOARD.md'), 'utf8');
const PLAN_SCRIPT = fs.readFileSync(path.join(FIXTURE, 'SCRIPT.md'), 'utf8');
const PRESET_FRAME = fs.readFileSync(path.join(process.cwd(), 'explainers', 'frame-presets', 'helios', 'FRAME.md'), 'utf8');

const FACT_TEXTS = [
  "In June 2025, Larkspur Bakery's website showed the old price of $4 for its sourdough after the price rose.",
  'The website kept a saved copy of each page for 24 hours.',
  '1,200 orders went through at the old price.',
  'Larkspur Bakery now clears the saved copy whenever a price changes.',
];
const CLAIMS: StoryClaim[] = FACT_TEXTS.map((text, i) => ({
  id: `c${i + 1}`,
  text,
  source_id: 's1',
  excerpt: text,
  core: true,
  check: { status: 'verified', via: 'live', checked_at: '2026-10-26T00:00:00.000Z' },
}));

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rc-render-'));

async function setup() {
  const { db } = await scratchExplainersDb();
  await ensureRealCaseSchema(db);
  const story = await addStory(db, {
    topicId: '00000000-0000-0000-0000-000000000001',
    scoutId: null,
    cycleId: null,
    term: 'caching',
    title: 'The sourdough price that would not change',
    summary: 'A saved copy of a page kept an old price alive for a day.',
    polarity: 'failure',
    story: {
      incident: 'A bakery website kept the old price after it rose.',
      puzzle: 'Why would a site show a price that no longer exists?',
      steps: [
        { step: 'request', in_story: 'a customer opens the page' },
        { step: 'check the copy', in_story: 'a saved page is found' },
        { step: 'serve the copy', in_story: 'the old price goes out' },
      ],
      click: 'The copy was made before the price changed.',
      other_side: 'Clear the copy when the price changes.',
      takeaway: 'A cache is only as fresh as its last copy.',
    },
    claims: CLAIMS,
    sources: [{ id: 's1', url: 'https://example.org/bakery', publisher: 'Example', kind: 'statement', published: null }],
  });
  await setStoryStatus(db, story.id, 'pool');
  const settings = await loadRealCaseSettings(db);
  const req = await requestStoryRender(db, { storyId: story.id, trigger: 'click', settings });
  assert.ok(req.ok);
  const job = (await claimNextRealCaseJob(db))!;
  return { db, story, job };
}

type Scenario = {
  /** What the fake director does on a facts round. */
  onFacts?: (script: string) => string;
  /** The checker's verdicts per call (the last repeats). */
  verdicts: SentenceVerdict[][];
};

function fakeDeps(db: ExplainersDb, s: Scenario) {
  const root = tmp();
  const prompts: string[] = [];
  const query: AgentQuery = ({ prompt, options }) => {
    prompts.push(prompt);
    const dir = String(options.cwd);
    const w = (rel: string, content: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    };
    if (prompt === RC_PLAN_PROMPT) {
      w('STORYBOARD.md', PLAN_STORYBOARD);
      w('SCRIPT.md', PLAN_SCRIPT);
      w('.hyperframes/comprehension-check.json', JSON.stringify({
        meant: { term_in_plain_words: 'keeping a saved copy to serve it faster', example_answer: 'the saved copy was made before the price changed' },
        answers: { beats: [], concept_in_my_words: 'the site kept a saved copy and served it', example_answer: 'the copy was older than the price change', example_ambiguous: false, keep_watching: 4, confused_overall: [] },
      }));
    } else if (prompt.includes('PHASE: facts')) {
      if (s.onFacts) w('SCRIPT.md', s.onFacts(fs.readFileSync(path.join(dir, 'SCRIPT.md'), 'utf8')));
    } else if (prompt === RC_BUILD_PROMPT) {
      for (let n = 1; n <= 8; n++) w(`compositions/frames/0${n}-frame.html`, '<div></div>');
      w('index.html', '<html></html>');
      w('audio_meta.json', '{}');
      w('renders/video.mp4', 'fake mp4 bytes');
    }
    return (async function* (): AsyncGenerator<AgentMessage> {
      yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.5, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 1000, outputTokens: 100, costUSD: 0.5 } } };
    })();
  };
  let call = 0;
  const factChecker: FactChecker = {
    async check() {
      const sentences = s.verdicts[Math.min(call, s.verdicts.length - 1)];
      call += 1;
      return { sentences, usd: 0.02, model: 'claude-sonnet-5-5', usage: { input_tokens: 2000, output_tokens: 300 } as never };
    },
  };
  const jevTransport: JevTransport = {
    async systemOne<const Q extends Questions>(_state: EntryType, questions: Q) {
      const answers = Object.fromEntries(Object.keys(questions).map((k) => [k, { type: 'noul', noul: 0.9 }]));
      return { model: 'jev-stub', answers, usage: { input_tokens: 500, output_tokens: 0 } } as unknown as SystemOneResult<Q>;
    },
  };
  const deps = {
    db,
    query,
    store: localArtifactStore(path.join(root, 'storage')),
    jobsRoot: path.join(root, 'jobs'),
    secrets: { anthropicApiKey: 'test', heygenApiKey: 'test' },
    factChecker,
    jevTransport,
    voiceId: 'voice-test',
    prepare: ({ jobsRoot, jobId, story }: { jobsRoot: string; jobId: string; story: Parameters<typeof applyRealCaseOverlay>[1] }) => {
      const jobDir = path.join(jobsRoot, jobId);
      const projectDir = path.join(jobDir, 'project');
      // What the Explainer workspace leaves behind that the overlay touches.
      fs.mkdirSync(path.join(projectDir, '.claude', 'skills', 'helios-explainer-director'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, '.claude', 'skills', 'helios-explainer-director', 'SKILL.md'), 'explainer director');
      fs.writeFileSync(path.join(projectDir, 'frame.md'), PRESET_FRAME);
      applyRealCaseOverlay(projectDir, story);
      return { jobDir, projectDir, homeDir: path.join(jobDir, 'home'), tmpDir: path.join(jobDir, 'tmp') };
    },
    hyperframesLint: () => [],
    boundsCheck: () => [],
    renderVideo: () => undefined,
    repairAssembly: () => [],
    random: () => 0,
  };
  return { deps, prompts };
}

const ALL_GOOD: SentenceVerdict[] = [];

test('a render: plan, understanding, facts pass, build; the overlay is the Real Case one; spend on this ledger', async () => {
  const { db, story, job } = await setup();
  const { deps, prompts } = fakeDeps(db, { verdicts: [ALL_GOOD] });
  const outcome = await runRealCaseJob(deps, job);
  assert.deepEqual(outcome, { status: 'ok' });
  assert.deepEqual(prompts, [RC_PLAN_PROMPT, RC_BUILD_PROMPT]);

  const done = (await getRealCaseJob(db, job.id))!;
  assert.equal(done.status, 'ok');
  assert.ok(OBJECT_HERO_OPENERS.includes(done.opener!));
  assert.equal((await getStory(db, story.id))!.status, 'rendered');
  assert.ok(done.spend_usd > 1, String(done.spend_usd));
  const kinds = (await listRealCaseArtifacts(db, job.id)).map((a) => a.kind);
  for (const k of ['brief', 'storyboard', 'script', 'fact_check', 'lint_report', 'video']) assert.ok(kinds.includes(k as never), k);
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM explainers.cost_events')).rows[0].n, 0);

  const project = path.join(deps.jobsRoot, job.id, 'project');
  assert.equal(fs.existsSync(path.join(project, '.claude', 'skills', 'helios-explainer-director', 'SKILL.md')), false);
  assert.ok(fs.readFileSync(path.join(project, '.claude', 'skills', 'helios-real-case-director', 'SKILL.md'), 'utf8').includes('name: helios-real-case-director'));
  assert.ok(fs.existsSync(path.join(project, '.claude', 'skills', 'helios-explainer-director', 'scene-builder.md')));
  const brief = fs.readFileSync(path.join(project, 'BRIEF.md'), 'utf8');
  assert.ok(brief.includes('- c3: 1,200 orders went through at the old price.'));
  assert.equal(/analog/i.test(fs.readFileSync(path.join(project, 'frame.md'), 'utf8').replace(/^[\s\S]*?## Overview/, '')), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, 'assets', 'opener.json'), 'utf8')).hero, 'object');
});

test('a fact-check failure is rewritten in a facts session, then passes', async () => {
  const { db, job } = await setup();
  const bad = 'Still, 1,200 orders went through at $4.';
  const flagged: SentenceVerdict = { frame: 2, sentence: bad, verdict: 'overstated', fact_ids: [], why: 'the facts give the count at the old price, not at $4', fix: 'Still, 1,200 orders went through at the old price.' };
  const { deps, prompts } = fakeDeps(db, {
    verdicts: [[flagged], ALL_GOOD],
    onFacts: (script) => script.replace(bad, 'Still, 1,200 orders went through at the old price.'),
  });
  assert.deepEqual(await runRealCaseJob(deps, job), { status: 'ok' });
  assert.equal(prompts.filter((p) => p.includes('PHASE: facts')).length, 1);
  assert.equal(prompts.find((p) => p.includes('PHASE: facts'))!.includes('last round'), false);
  const project = path.join(deps.jobsRoot, job.id, 'project');
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, FACT_FINDINGS_FILE), 'utf8')).findings[0].sentence, bad);
  assert.ok(fs.readFileSync(path.join(project, 'SCRIPT.md'), 'utf8').includes('went through at the old price.'));
  assert.deepEqual((await getRealCaseJob(db, job.id))!.flags, []);
});

test('a sentence still untrue after the rewrite rounds is cut, and the reel is still made (RC-06)', async () => {
  const { db, job } = await setup();
  const bad = 'The bakery fixed it at the refresh step.';
  const flagged: SentenceVerdict = { frame: 6, sentence: bad, verdict: 'unsupported', fact_ids: [], why: 'no fact names the step', fix: 'cut' };
  const { deps, prompts } = fakeDeps(db, { verdicts: [[flagged]] });
  assert.deepEqual(await runRealCaseJob(deps, job), { status: 'ok' });
  const facts = prompts.filter((p) => p.includes('PHASE: facts'));
  assert.equal(facts.length, 2);
  assert.ok(facts[1].includes('last round'));
  const project = path.join(deps.jobsRoot, job.id, 'project');
  const script = fs.readFileSync(path.join(project, 'SCRIPT.md'), 'utf8');
  assert.equal(script.includes(bad), false);
  assert.ok(script.includes('Now it clears the saved copy whenever a price changes'));
  assert.equal(fs.readFileSync(path.join(project, 'STORYBOARD.md'), 'utf8').includes(bad), false);
  const flags = (await getRealCaseJob(db, job.id))!.flags;
  assert.deepEqual(flags.map((f) => f.kind), ['fact_cut']);
  assert.match(flags[0].detail, /frame 6/);
});

test('no voice id: the job fails with why, and the story goes back to the pool', async () => {
  const { db, story, job } = await setup();
  const { deps } = fakeDeps(db, { verdicts: [ALL_GOOD] });
  const outcome = await runRealCaseJob({ ...deps, voiceId: null }, job);
  assert.equal(outcome.status, 'failed');
  assert.match((outcome as { error: string }).error, /voice id/);
  assert.equal((await getStory(db, story.id))!.status, 'pool');
});

test('the frame.md overlay applies to the current preset and leaves no analogy beat behind', () => {
  const md = realCaseFrameMd(PRESET_FRAME);
  const body = md.replace(/^[\s\S]*?## Overview/, '');
  assert.equal(/analog/i.test(body), false);
  assert.equal(body.includes('EX3-132'), false);
  assert.ok(body.includes('## The story world (V-1)'));
  assert.ok(body.includes('### 4 · Walk it'));
  assert.ok(body.includes('### 5 · The click'));
});
