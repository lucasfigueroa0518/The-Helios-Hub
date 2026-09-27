import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { useCreatorPipeline } from '@/lib/social/flags';

describe('useCreatorPipeline', () => {
  const originalEnv = process.env.HELIOS_SOCIAL_CREATOR_PIPELINE;

  test('returns true when row is stamped "creator"', () => {
    delete process.env.HELIOS_SOCIAL_CREATOR_PIPELINE;
    assert.equal(useCreatorPipeline({ pipeline_version: 'creator' }), true);
  });

  test('returns false when row is stamped "legacy"', () => {
    delete process.env.HELIOS_SOCIAL_CREATOR_PIPELINE;
    assert.equal(useCreatorPipeline({ pipeline_version: 'legacy' }), false);
    process.env.HELIOS_SOCIAL_CREATOR_PIPELINE = '1';
    assert.equal(useCreatorPipeline({ pipeline_version: 'legacy' }), false);
  });

  test('returns true for null row when env var is set', () => {
    process.env.HELIOS_SOCIAL_CREATOR_PIPELINE = '1';
    assert.equal(useCreatorPipeline(null), true);
  });

  test('returns false for null row when env var is unset', () => {
    delete process.env.HELIOS_SOCIAL_CREATOR_PIPELINE;
    assert.equal(useCreatorPipeline(null), false);
  });
});
