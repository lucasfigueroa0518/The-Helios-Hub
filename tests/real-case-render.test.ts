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
import { applyRealCaseOverlay } from '@/lib/real-case/render/workspace';
import { addStory, getStory, setStoryStatus } from '@/lib/real-case/repository';
import { ensureRealCaseSchema } from '@/lib/real-case/schema';
import { loadRealCaseSettings } from '@/lib/real-case/settings';
import type { ClaimAct, StoryClaim } from '@/lib/real-case/types';
import type { JevTransport } from '@/lib/reels/jev/runner';

import { scratchExplainersDb } from './explainers-pglite';

// The lint fixture's fictional story (an invented transit agency, invented facts): the plan the fake director writes.
const FIXTURE = path.join(process.cwd(), 'explainers', 'real-case', 'lint', 'fixtures', 'good');
const PLAN_STORYBOARD = fs.readFileSync(path.join(FIXTURE, 'STORYBOARD.md'), 'utf8');
const PLAN_SCRIPT = fs.readFileSync(path.join(FIXTURE, 'SCRIPT.md'), 'utf8');

const FACTS: [string, ClaimAct, string][] = [
  ['c1', 'setup', 'Harbor City Transit launched an AI trip assistant in its app on September 14, 2026.'],
  ['c2', 'setup', 'The agency launched the assistant to cut calls to its help line.'],
  ['c3', 'moment', 'The assistant told riders to use Pier Street station, which had closed in March.'],
  ['c4', 'moment', "The assistant's reply read: Take the Blue Line to Pier Street station, then walk two blocks east."],
  ['c5', 'fallout', 'About 2,300 riders went to the closed station on the first weekend.'],
  ['c6', 'fallout', 'The agency paused the assistant on September 16.'],
  ['c7', 'reveal', "The assistant's model learned its routes from data collected before the station closed."],
  ['c8', 'since', 'On September 20 the agency connected the assistant to its live service alerts and turned it back on.'],
];
const CLAIMS: StoryClaim[] = FACTS.map(([id, act, text]) => ({
  id,
  text,
  act,
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
    topicId: null,
    scoutId: null,
    cycleId: null,
    term: 'knowledge cutoff',
    title: 'The Trip Assistant That Sent Riders to a Closed Station',
    summary: 'A transit assistant sent riders to a closed station because its model only knew routes from before the closure.',
    polarity: 'failure',
    story: {
      event_date: '2026-09-14',
      place: 'Harbor City',
      cold_open: 'A new transit assistant sent about 2,300 riders to a closed station.',
      setup: 'Harbor City Transit added an AI trip assistant to its app.',
      moment: 'It told riders to use Pier Street station, closed since March.',
      fallout: 'About 2,300 riders went there; the agency paused it.',
      reveal: 'Its model learned routes from data collected before the closure.',
      since: 'It came back connected to live service alerts.',
      for_you: 'Ask how fresh an AI\'s information is.',
      cast: [
        { name: 'Harbor City Transit', kind: 'organization', role: 'ran the trip assistant' },
        { name: 'riders', kind: 'private_person', role: 'followed its directions' },
      ],
      timeline: [
        { date: '2026-09-14', what: 'Assistant launched', claim_id: 'c1' },
        { date: '2026-09-16', what: 'Assistant paused', claim_id: 'c6' },
      ],
      artifacts: [
        { id: 'a1', kind: 'reply', speaker: 'the trip assistant', text: 'Take the Blue Line to Pier Street station, then walk two blocks east.', claim_id: 'c4' },
        { id: 'a2', kind: 'post', speaker: 'Harbor City Transit', text: 'We are pausing the trip assistant while we fix its station list.', claim_id: 'c6' },
      ],
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
        meant: { what_happened: 'A transit assistant sent riders to a closed station; the agency paused it.', why_it_happened: 'Its model only knew routes from before the station closed.', term_in_plain_words: 'what a model knows stops when its data was collected' },
        cold_open: { happening: 'An app sent thousands of riders to a closed station.', question: 'How did the app get that wrong?', keep_watching: 5, confused: [] },
        answers: { beats: [], what_happened: 'The app sent thousands of riders to a closed station.', why_it_happened: 'It learned the routes before the station closed.', concept_in_my_words: 'an AI only knows things up to when its data was gathered', keep: 'check how fresh the info is', keep_watching: 4, confused_overall: [] },
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
  assert.equal(done.opener, null);
  assert.equal((await getStory(db, story.id))!.status, 'rendered');
  assert.ok(done.spend_usd > 1, String(done.spend_usd));
  const kinds = (await listRealCaseArtifacts(db, job.id)).map((a) => a.kind);
  for (const k of ['brief', 'storyboard', 'script', 'fact_check', 'lint_report', 'video']) assert.ok(kinds.includes(k as never), k);
  assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM explainers.cost_events')).rows[0].n, 0);

  const project = path.join(deps.jobsRoot, job.id, 'project');
  assert.equal(fs.existsSync(path.join(project, '.claude', 'skills', 'helios-explainer-director', 'SKILL.md')), false);
  assert.ok(fs.readFileSync(path.join(project, '.claude', 'skills', 'helios-real-case-director', 'SKILL.md'), 'utf8').includes('name: helios-real-case-director'));
  assert.equal(fs.existsSync(path.join(project, '.claude', 'skills', 'helios-explainer-director')), false);
  const brief = fs.readFileSync(path.join(project, 'BRIEF.md'), 'utf8');
  assert.ok(brief.includes('- c5: About 2,300 riders went to the closed station on the first weekend.'));
  assert.ok(brief.includes('- a1 (reply, the trip assistant; fact c4): "Take the Blue Line to Pier Street station, then walk two blocks east."'));
  assert.ok(brief.includes('- Harbor City Transit (organization): ran the trip assistant'));
  // The plan session's first viewer is this format's: it asks what happened and why, not about a worked example.
  const kinds2 = (await listRealCaseArtifacts(db, job.id)).filter((a) => a.kind === 'lint_report').map((a) => a.content ?? '');
  assert.ok(kinds2.some((c) => c.includes('"story_match"')), 'the news understanding test ran');
  // The render engine is the news kit (N4c-2): no world kit, no opener, frame.md from ai-news.
  assert.equal(fs.existsSync(path.join(project, 'assets', 'opener.json')), false);
  assert.equal(fs.existsSync(path.join(project, 'assets', 'world')), false);
  assert.ok(fs.existsSync(path.join(project, 'assets', 'kit', 'components', 'evidence.js')));
  assert.equal(fs.existsSync(path.join(project, 'assets', 'kit', 'world.js')), false);
  assert.equal(fs.existsSync(path.join(project, 'assets', 'kit', 'gallery.html')), false);
  assert.ok(fs.readFileSync(path.join(project, 'frame.md'), 'utf8').includes('AI News Explained'));
  assert.ok(fs.existsSync(path.join(project, 'assets', 'fonts', 'GochiHand-Regular.ttf')));
  assert.ok(fs.existsSync(path.join(project, 'assets', 'Helios-mark.png')));
  assert.ok(fs.existsSync(path.join(project, 'assets', 'bank', 'credits.json')));
  const engine = [path.join(project, 'frame.md'), path.join(project, '.hyperframes', 'caption-skin.html'), ...walk(path.join(project, 'assets', 'kit'))];
  for (const file of engine) {
    const text = fs.readFileSync(file, 'utf8');
    for (const banned of ['critter', 'AI BRAIN BREAK', 'dictionaryCard', 'titleCard', 'world.js']) assert.ok(!text.includes(banned), `${path.relative(project, file)} mentions ${banned}`);
  }
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('a fact-check failure is rewritten in a facts session, then passes', async () => {
  const { db, job } = await setup();
  const bad = 'It should mean fewer calls to the help line.';
  const fixed = 'It should cut calls to the help line.';
  const flagged: SentenceVerdict = { frame: 2, sentence: bad, verdict: 'overstated', fact_ids: [], why: 'the facts give the aim, not a result', fix: fixed };
  const { deps, prompts } = fakeDeps(db, {
    verdicts: [[flagged], ALL_GOOD],
    onFacts: (script) => script.replace(bad, fixed),
  });
  assert.deepEqual(await runRealCaseJob(deps, job), { status: 'ok' });
  assert.equal(prompts.filter((p) => p.includes('PHASE: facts')).length, 1);
  assert.equal(prompts.find((p) => p.includes('PHASE: facts'))!.includes('last round'), false);
  const project = path.join(deps.jobsRoot, job.id, 'project');
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, FACT_FINDINGS_FILE), 'utf8')).findings[0].sentence, bad);
  assert.ok(fs.readFileSync(path.join(project, 'SCRIPT.md'), 'utf8').includes(fixed));
  assert.deepEqual((await getRealCaseJob(db, job.id))!.flags, []);
});

test('a sentence still untrue after the rewrite rounds is cut, and the reel is still made (RC-06)', async () => {
  const { db, job } = await setup();
  const bad = 'A closed station is news it can read.';
  const flagged: SentenceVerdict = { frame: 6, sentence: bad, verdict: 'unsupported', fact_ids: [], why: 'no fact says what it reads', fix: 'cut' };
  const { deps, prompts } = fakeDeps(db, { verdicts: [[flagged]] });
  assert.deepEqual(await runRealCaseJob(deps, job), { status: 'ok' });
  const facts = prompts.filter((p) => p.includes('PHASE: facts'));
  assert.equal(facts.length, 2);
  assert.ok(facts[1].includes('last round'));
  const project = path.join(deps.jobsRoot, job.id, 'project');
  const script = fs.readFileSync(path.join(project, 'SCRIPT.md'), 'utf8');
  assert.equal(script.includes(bad), false);
  assert.ok(script.includes('now connected to the agency\'s live service alerts.'));
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

test('the cold-open test blocks a cold open a stranger would scroll past (RC-35)', async () => {
  const { checkNewsUnderstanding } = await import('@/lib/real-case/render/understanding');
  const jev = { ask: async (r: { questions: Record<string, unknown> }) => ({ answers: Object.fromEntries(Object.keys(r.questions).map((k) => [k, { noul: 0.9 }])) }) } as never;
  const base = { jev, storyId: 's', storyboard: PLAN_STORYBOARD, script: PLAN_SCRIPT };
  const answers = { what_happened: 'x', why_it_happened: 'y', beats: [] };
  const weak = await checkNewsUnderstanding({ ...base, comprehension: { cold_open: { happening: 'a map', question: '', keep_watching: 2 }, answers } });
  assert.deepEqual(weak!.blocking.map((f) => f.kind), ['cold_open']);
  const strong = await checkNewsUnderstanding({ ...base, comprehension: { cold_open: { happening: 'a map', question: 'why?', keep_watching: 4 }, answers } });
  assert.deepEqual(strong!.blocking, []);
});

test('objects are prepared from the final plan before the build, and their spend is recorded (RC-52)', async () => {
  const { db, job } = await setup();
  const { deps, prompts } = fakeDeps(db, { verdicts: [ALL_GOOD] });
  const seen: string[] = [];
  const objects = async (_projectDir: string, storyboard: string) => {
    seen.push(storyboard.includes('## Case file') ? 'plan' : 'no plan');
    seen.push(`after ${prompts.length} sessions`);
    return { placed: [], flags: ['cutout "padlock": none clean'], usd: { vision: 0.002, drawing: 0.11 } };
  };
  assert.deepEqual(await runRealCaseJob({ ...deps, objects }, job), { status: 'ok' });
  assert.deepEqual(seen, ['plan', 'after 1 sessions']);
  const rows = (await db.query<{ vendor: string; component: string; usd: string }>('SELECT vendor, component, usd FROM real_case.cost_events WHERE job_id = $1 AND component LIKE $2 ORDER BY vendor', [job.id, 'objects:%'])).rows;
  assert.deepEqual(rows.map((r) => [r.vendor, r.component, Number(r.usd)]), [['anthropic', 'objects:pick', 0.002], ['openai', 'objects:images', 0.11]]);
});

test('object spend counts toward the job cap: prep over the cap stops before the build', async () => {
  const { db, job } = await setup();
  const { deps, prompts } = fakeDeps(db, { verdicts: [ALL_GOOD] });
  const objects = async () => ({ placed: [], flags: [], usd: { vision: 0, drawing: job.spend_cap_usd + 1 } });
  const outcome = await runRealCaseJob({ ...deps, objects }, job);
  assert.equal(outcome.status, 'failed');
  assert.equal((outcome as { capped: boolean }).capped, true);
  assert.equal(prompts.length, 1, 'session B never starts');
});

test('the news agents: its own frame worker and picture checker, and no scene builder', async () => {
  const { withAgentOverrides, NEWS_FRAME_WORKER_PROMPT, NEWS_PICTURE_CHECKER_PROMPT } = await import('@/lib/real-case/render/agents');
  let agents: Record<string, { prompt: string }> = {};
  const query = ((p: { options: { agents: typeof agents } }) => {
    agents = p.options.agents;
    return (async function* () {})();
  }) as unknown as AgentQuery;
  const base = { prompt: 'x', description: 'x' };
  withAgentOverrides(query)({ prompt: 'go', options: { agents: { 'frame-worker': base, 'scene-builder': base, 'picture-checker': base, 'first-viewer': base } } } as never);
  assert.equal(agents['scene-builder'], undefined);
  assert.equal(agents['frame-worker'].prompt, NEWS_FRAME_WORKER_PROMPT);
  assert.equal(agents['picture-checker'].prompt, NEWS_PICTURE_CHECKER_PROMPT);
  for (const p of [NEWS_FRAME_WORKER_PROMPT, NEWS_PICTURE_CHECKER_PROMPT]) assert.doesNotMatch(p, /critter|world\.js|scene builder/i);
});
