/**
 * Lead time on the board (Bald-Eagle D4; lib/social-hub/adapters/explainers.ts): an unbooked render the night made
 * ahead shows on the date it was made for. Pure; canned rows only.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { explainerPosts } from '@/lib/social-hub/adapters/explainers';
import type { ExplainerJobRow, ExplainersRead } from '@/lib/social-hub/queries/explainers';

function job(over: Partial<ExplainerJobRow> = {}): ExplainerJobRow {
  return {
    job_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', topic_id: '11111111-1111-4111-8111-111111111111', status: 'ok', trigger: 'auto', mode: 'development',
    spend_usd: '3', requested_at: '2026-10-12T06:10:00Z', finished_at: '2026-10-12T07:00:00Z', error: null,
    title: 'What is an API?', scope: 'Explain an API call.', source_url: null, origin: 'generated',
    audience_fit: null, teachability_45s: null, analogy_potential: null, visual_potential: null, accuracy_under_simplification: null, hook_strength: null, weighted_score: null,
    verdict: null, tags: null, feedback_at: null, video_artifact_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', video_location: 'bucket',
    ...over,
  };
}

const read = (jobs: ExplainerJobRow[]): ExplainersRead => ({ jobs, attempts: [], schedules: [], insights: [], topics: [], requireApproval: true });

test('an unbooked night render shows on its target date; a person’s render has no date', () => {
  const [ahead] = explainerPosts(read([job({ target_date: '2026-10-14' })]));
  assert.equal(ahead!.status, 'ready');
  assert.equal(ahead!.nyDate, '2026-10-14', 'made Monday night for Wednesday: shown on Wednesday');
  const [mine] = explainerPosts(read([job({ trigger: 'click', target_date: null })]));
  assert.equal(mine!.nyDate, null);
});
