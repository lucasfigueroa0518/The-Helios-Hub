import test from 'node:test';
import assert from 'node:assert/strict';
import { anthropicClientOptions } from '@/lib/anthropic-client';

test('anthropic client: the workspace header is sent only when ANTHROPIC_WORKSPACE_ID is set', () => {
  const saved = process.env.ANTHROPIC_WORKSPACE_ID;
  try {
    delete process.env.ANTHROPIC_WORKSPACE_ID;
    assert.deepEqual(anthropicClientOptions({ maxRetries: 0 }), { maxRetries: 0 });
    process.env.ANTHROPIC_WORKSPACE_ID = ' wrkspc_test ';
    assert.deepEqual(anthropicClientOptions({ defaultHeaders: { 'x-a': '1' } }), { defaultHeaders: { 'x-a': '1', 'anthropic-workspace-id': 'wrkspc_test' } });
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_WORKSPACE_ID; else process.env.ANTHROPIC_WORKSPACE_ID = saved;
  }
});
