/**
 * Cost rollups and the Health sentence. No database and no model calls.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activityOf,
  assembleReport,
  capPace,
  defaultProdSpendSince,
  inLedger,
  periodRange,
  type ReportFacts,
} from '@/lib/reels/analytics/rollups';
import {
  barsInView,
  chartYMax,
  describeRunStage,
  healthVerdict,
  publishFailureLine,
  sourceTone,
  visibleIndexRange,
  type RunActivity,
} from '@/lib/reels/health-status';

const cutoff = defaultProdSpendSince();

function facts(patch: Partial<ReportFacts> = {}): ReportFacts {
  return {
    days: ['2026-09-30'],
    rows: [],
    postsGenerated: 0,
    postsPublished: 0,
    ingestRuns: 0,
    nights: 0,
    ideasScored: 0,
    scoringCalls: 0,
    copyCalls: 0,
    postsWithCopy: 0,
    copyCallUsd: 0,
    imageJobs: 0,
    postsWithFrame: 0,
    videoJobs: 0,
    postsWithVideo: 0,
    publishedWithVideo: 0,
    ideaProductionUsd: 0,
    publishedIdeaProductionUsd: 0,
    failedJobUsd: 0,
    unshippedCopyUsd: 0,
    ...patch,
  };
}

test('production spend starts at midnight in New York on September 30', () => {
  assert.equal(cutoff.toISOString(), '2026-09-30T04:00:00.000Z');
  assert.equal(inLedger(new Date('2026-09-30T03:59:00.000Z'), 'production', cutoff), false);
  assert.equal(inLedger(cutoff, 'production', cutoff), true);
  assert.equal(inLedger(new Date('2026-09-29T12:00:00.000Z'), 'development', cutoff), true);
});

test('a custom range ends at the next New York midnight', () => {
  const range = periodRange('custom', new Date('2026-10-02T15:00:00.000Z'), { from: '2026-09-30', to: '2026-10-01' });
  assert.equal(range.start.toISOString(), '2026-09-30T04:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-10-02T04:00:00.000Z');
});

test('an average is spend divided by the count', () => {
  const report = assembleReport(facts({
    rows: [{ day: '2026-09-30', vendor: 'anthropic', activity: 'ingest', usd: 10 }],
    ingestRuns: 2,
    nights: 1,
  }));
  const average = report.stats.find((stat) => stat.id === 'ingest-avg');
  assert.equal(average?.value, 5);
  assert.equal(average?.numerator.value, 10);
  assert.equal(average?.denominator?.value, 2);
});

test('copy call cost uses only the Sonnet write calls', () => {
  const report = assembleReport(facts({
    rows: [{ day: '2026-09-30', vendor: 'anthropic', activity: 'copy', usd: 9 }],
    copyCallUsd: 4,
    copyCalls: 2,
    postsWithCopy: 1,
  }));
  assert.equal(report.stats.find((stat) => stat.id === 'copy-run')?.value, 2);
  assert.equal(report.stats.find((stat) => stat.id === 'copy-avg')?.value, 9);
});

test('vendor and activity stacks keep Kling on video', () => {
  assert.equal(activityOf('grouping'), 'group');
  assert.equal(activityOf('reel-motion'), 'video');
  const report = assembleReport(facts({
    rows: [
      { day: '2026-09-30', vendor: 'anthropic', activity: 'score', usd: 1 },
      { day: '2026-09-30', vendor: 'fal', activity: 'video', usd: 0.672 },
    ],
  }));
  assert.equal(report.vendors.find((series) => series.key === 'fal')?.values[0], 0.672);
  assert.equal(report.activities.find((series) => series.key === 'video')?.values[0], 0.672);
  assert.equal(report.activities.find((series) => series.key === 'score')?.values[0], 1);
});

test('waste ratios use finished videos and the dollars that made them', () => {
  const report = assembleReport(facts({
    postsPublished: 1,
    postsWithVideo: 4,
    publishedWithVideo: 1,
    ideaProductionUsd: 8,
    publishedIdeaProductionUsd: 2,
  }));
  assert.equal(report.waste.find((stat) => stat.id === 'publish-yield')?.value, 0.25);
  assert.equal(report.waste.find((stat) => stat.id === 'spend-yield')?.value, 0.25);
  assert.equal(report.waste.find((stat) => stat.id === 'cost-per-video')?.value, 2);
  assert.equal(report.waste.find((stat) => stat.id === 'production-per-published')?.value, 8);
});

test('the monthly pace uses production days left', () => {
  const pace = capPace(20, 100, new Date('2026-10-02T16:00:00.000Z'), cutoff);
  assert.equal(pace.left, 80);
  assert.equal(pace.daysLeft, 30);
  assert.ok(pace.perDay > 0);
});

test('health names the first broken thing and stays quiet when the night is clean', () => {
  assert.equal(healthVerdict({
    runStatus: 'failed',
    failedSourceName: 'Cursor changelog',
    staleSource: null,
    jobErrorsToday: null,
    stuckStage: null,
    metaReady: true,
  }).sentence, 'Last night failed.');
  assert.match(healthVerdict({
    runStatus: 'ok',
    failedSourceName: null,
    staleSource: { name: 'Cursor changelog', days: 3 },
    jobErrorsToday: { stage: 'frame', count: 2 },
    stuckStage: 'copy',
    metaReady: false,
  }).sentence, /Cursor changelog has not succeeded in 3 days/);
  assert.equal(healthVerdict({
    runStatus: 'ok',
    failedSourceName: null,
    staleSource: null,
    jobErrorsToday: null,
    stuckStage: null,
    metaReady: true,
  }).sentence, 'Everything is working.');
  assert.equal(healthVerdict({
    runStatus: 'ok',
    failedSourceName: null,
    staleSource: null,
    jobErrorsToday: { stage: 'publish', count: 1, detail: 'The caption was too long.' },
    stuckStage: null,
    metaReady: true,
  }).sentence, '1 publish job failed today. The caption was too long.');
  assert.equal(
    publishFailureLine('Meta returned 400: The caption was too long. (code 36004/2207010, trace abc)'),
    'The caption was too long.',
  );
  assert.equal(healthVerdict({
    runStatus: 'running',
    failedSourceName: null,
    staleSource: null,
    jobErrorsToday: null,
    stuckStage: 'frame',
    metaReady: true,
    activity: 'Drawing the frame.',
  }).sentence, 'Drawing the frame.');
  assert.match(healthVerdict({
    runStatus: 'running',
    failedSourceName: null,
    staleSource: { name: 'CBS News', days: 4 },
    jobErrorsToday: null,
    stuckStage: null,
    metaReady: true,
    activity: 'Scoring ideas.',
  }).sentence, /CBS News has not succeeded in 4 days/);
  const now = new Date('2026-09-30T16:00:00.000Z');
  assert.equal(sourceTone(null, 'failed', now), 'failed');
  assert.equal(sourceTone(null, null, now), 'never');
  assert.equal(sourceTone(new Date(now.getTime() - 40 * 60 * 60 * 1000).toISOString(), 'ok', now), 'stale');
  assert.equal(sourceTone(now.toISOString(), 'ok', now), 'fresh');
});

function activity(patch: Partial<RunActivity> = {}): RunActivity {
  return {
    status: 'running',
    adapterTotal: 27,
    finishedAdapters: 0,
    currentAdapter: null,
    storiesKept: 0,
    components: [],
    scored: 0,
    hasSlate: false,
    copyWritten: 0,
    frame: 0,
    video: 0,
    song: 0,
    publish: 0,
    ...patch,
  };
}

test('a live night names the stage it is actually in', () => {
  assert.equal(describeRunStage(activity({ status: 'requested' })), 'Queued. Waiting for the worker to start.');
  assert.equal(describeRunStage(activity()), 'Starting the night.');
  assert.equal(
    describeRunStage(activity({ currentAdapter: 'The Guardian', finishedAdapters: 14, storiesKept: 96 })),
    'Reading The Guardian. 14 of 27 sources done, 96 stories kept.',
  );
  assert.equal(
    describeRunStage(activity({ finishedAdapters: 20, storiesKept: 100 })),
    'Ingesting sources. 20 of 27 done, 100 stories kept.',
  );
  assert.equal(
    describeRunStage(activity({
      currentAdapter: 'CBS News',
      components: ['grouping'],
      storiesKept: 109,
    })),
    'Grouping 109 stories into ideas.',
  );
  assert.equal(
    describeRunStage(activity({ components: ['scoring-pass1'], scored: 80 })),
    'Scoring ideas. 80 scored so far.',
  );
  assert.equal(
    describeRunStage(activity({ hasSlate: true, scored: 136 })),
    'Scored 136 ideas. Writing copy.',
  );
  assert.equal(
    describeRunStage(activity({ components: ['copy-caption'] })),
    'Writing the on-screen copy.',
  );
  assert.equal(describeRunStage(activity({ copyWritten: 1, frame: 1 })), 'Drawing the frame.');
  assert.equal(describeRunStage(activity({ status: 'ok', video: 1 })), 'Rendering the clip.');
  assert.equal(describeRunStage(activity({ status: 'ok', song: 1 })), 'Picking a song.');
  assert.equal(describeRunStage(activity({ status: 'ok', publish: 1 })), 'Publishing the reel.');
  assert.equal(describeRunStage(activity({ status: 'ok' })), null);
  assert.equal(describeRunStage(activity({ storiesKept: 1, finishedAdapters: 1 })), 'Ingesting sources. 1 of 27 done, 1 story kept.');
});

test('the source chart shows a few columns and scales to the ones in view', () => {
  assert.equal(barsInView(0), 5);
  assert.equal(barsInView(400), 3);
  assert.equal(barsInView(700), 4);
  assert.equal(barsInView(1100), 5);
  assert.deepEqual(visibleIndexRange(10, 0, 500, 100), { start: 0, end: 5 });
  assert.deepEqual(visibleIndexRange(10, 80, 500, 100), { start: 1, end: 6 });
  assert.equal(chartYMax([4, 18, 9]), 18);
  assert.equal(chartYMax([0, 0]), 1);
});
