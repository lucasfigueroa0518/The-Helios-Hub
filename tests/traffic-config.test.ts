import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveVercelTrafficConfig } from '@/lib/traffic/vercel-client';

test('local env can use the short VERCEL_* names', () => {
  assert.deepEqual(
    resolveVercelTrafficConfig({
      VERCEL_TOKEN: 'tok',
      VERCEL_ORG_ID: 'team_local',
      VERCEL_PROJECT_ID: 'prj_marketing',
    }),
    { token: 'tok', teamId: 'team_local', projectId: 'prj_marketing' },
  );
});

test('on Vercel, reserved Hub ids are ignored so marketing-site keys must win', () => {
  assert.equal(
    resolveVercelTrafficConfig({
      VERCEL: '1',
      VERCEL_ENV: 'production',
      VERCEL_TOKEN: 'tok',
      VERCEL_ORG_ID: 'team_hub',
      VERCEL_PROJECT_ID: 'prj_hub',
    }),
    null,
  );
  assert.deepEqual(
    resolveVercelTrafficConfig({
      VERCEL: '1',
      VERCEL_ENV: 'production',
      VERCEL_TOKEN: 'tok',
      VERCEL_ORG_ID: 'team_hub',
      VERCEL_PROJECT_ID: 'prj_hub',
      VERCEL_ANALYTICS_TEAM_ID: 'team_marketing',
      VERCEL_ANALYTICS_PROJECT_ID: 'prj_marketing',
    }),
    { token: 'tok', teamId: 'team_marketing', projectId: 'prj_marketing' },
  );
});

test('dedicated analytics names win over local fallbacks', () => {
  assert.deepEqual(
    resolveVercelTrafficConfig({
      VERCEL_TOKEN: 'old',
      VERCEL_ORG_ID: 'team_old',
      VERCEL_PROJECT_ID: 'prj_old',
      VERCEL_ANALYTICS_TOKEN: 'new',
      VERCEL_ANALYTICS_TEAM_ID: 'team_new',
      VERCEL_ANALYTICS_PROJECT_ID: 'prj_new',
    }),
    { token: 'new', teamId: 'team_new', projectId: 'prj_new' },
  );
});
