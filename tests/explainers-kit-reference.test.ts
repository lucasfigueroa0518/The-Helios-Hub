/**
 * The generated kit reference (4.2 cost lever): every export of every module a frame draws with
 * appears in it, it fits the token budget, and it is generated (never hand-written). Offline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

test('KIT-REFERENCE: every export of every reference module is listed, within ~25.5k tokens', async () => {
  await import('../explainers/world-kit/try.mjs').catch(() => null);
  const R: any = await import('../explainers/world-kit/kit-reference.mjs');
  const { markdown, modules } = await R.kitReference();
  assert.ok(markdown.startsWith('# KIT-REFERENCE (generated'), 'marked as generated');
  for (const file of R.REFERENCE_MODULES) {
    const mod = await import(`../explainers/world-kit/${file}`);
    for (const name of Object.keys(mod)) {
      assert.ok(markdown.includes(`\`${name}`), `${file}: ${name} is in the reference`);
      assert.ok(modules[file].includes(name), `${file}: ${name} is parsed`);
    }
  }
  // ~24k (cost fix 2, 2026-10-28): builders no longer read kit source, so the most used exports carry their whole doc
  // +~400 for the visual fixes' connect.js, setlock.js and layout.js (2026-10-28)
  // 24.4k → 25.5k (2026-11-17): since instruction injection, builders get the reference by section (only
  // core.js, draw.js and motion.js in every prompt), so the whole file's size no longer reaches every turn.
  assert.ok(markdown.length / 4 <= 25500, `about ${Math.round(markdown.length / 4)} tokens`);
  // the lists builders look up are spelled out
  for (const want of ['EXTERIOR_KINDS', 'street', 'MOOD_NAMES', 'evening', 'OBJECT_IDS', 'laptop', 'PROPS', 'carton', 'carry(name,', 'jumpCutProblems(shots', 'animal(kind, x, y', 'pinsAt(t, segments)', 'move?: { kind:']) assert.ok(markdown.includes(want), want);
});
