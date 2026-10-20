import assert from 'node:assert/strict';
import test from 'node:test';

import { BUILD_FIT, buildFitState, buildLineInstruction, ceilingAllows, decideBuildLine, recentClosingsBlock, type RecentClosing } from '@/lib/social/captions/build-line';
import { CAPTION_EMOJI_MAX, countEmoji } from '@/lib/social/captions/emoji';
import { CAPTION_SHARED_RULES, HELIOS_CONTEXT, HELIOS_NAME } from '@/lib/social/captions/helios-context';

const row = (buildLine: boolean, i = 0): RecentClosing => ({ closing: `closing ${i}`, buildLine, createdAt: new Date(2026, 9, 19 - i) });

test('HELIOS_CONTEXT names the four readers and excludes training', () => {
  for (const re of [/forward-deployed/, /agentic marketing and sales/, /Founder/, /Operator/, /Technical lead/]) assert.match(HELIOS_CONTEXT, re);
  assert.doesNotMatch(HELIOS_CONTEXT, /train|upskill/i);
});

test('CAPTION_SHARED_RULES bans pitches', () => {
  assert.match(CAPTION_SHARED_RULES, /DM us/);
  assert.match(CAPTION_SHARED_RULES, /Helios once/);
});

test('CAPTION_SHARED_RULES: every caption ends on the Helios line (Task 8b, per-format comps)', () => {
  assert.match(CAPTION_SHARED_RULES, /the body, then the question or call to action, then the Helios line, then any credits, Source line or hashtags/i);
  assert.match(CAPTION_SHARED_RULES, /one or two sentences/);
  assert.match(CAPTION_SHARED_RULES, /may end by inviting the reader to follow/);
  assert.match(CAPTION_SHARED_RULES, /A short, specific question is the usual choice/);
  assert.match(CAPTION_SHARED_RULES, /never "what do you think\?"/i);
  assert.match(CAPTION_SHARED_RULES, /so-what line in the body is fine, but it does not name Helios/);
  assert.match(CAPTION_SHARED_RULES, /Name Helios once, in the Helios line/);
  assert.doesNotMatch(CAPTION_SHARED_RULES, /Close with the builder's read/);
  assert.ok(!CAPTION_SHARED_RULES.includes('\u2014'), 'no em dashes');
});

test('ceilingAllows counts only the 6 most recent closings', () => {
  assert.equal(ceilingAllows([]), true);
  assert.equal(ceilingAllows([row(true, 0), row(false, 1), row(true, 2), row(false, 3)]), false);
  const beyond = [...Array.from({ length: 6 }, (_, i) => row(false, i)), row(true, 6), row(true, 7)];
  assert.equal(ceilingAllows(beyond), true);
});

test('decideBuildLine applies threshold and ceiling', () => {
  assert.equal(decideBuildLine(0.59, []), false);
  assert.equal(decideBuildLine(0.6, []), true);
  assert.equal(decideBuildLine(null, []), false);
  assert.equal(decideBuildLine(0.9, [row(true, 0), row(true, 1), row(false, 2)]), false);
});

test('recentClosingsBlock lists closings and tells the model not to reuse them', () => {
  assert.equal(recentClosingsBlock([]), '');
  const block = recentClosingsBlock([row(false, 0), row(true, 1)]);
  assert.match(block, /closing 0/);
  assert.match(block, /closing 1/);
  assert.match(block, /do not reuse/i);
});

test('buildLineInstruction switches on include', () => {
  assert.match(buildLineInstruction(true), /what Helios builds/);
  assert.match(buildLineInstruction(true), /only place Helios is named/i);
  assert.match(buildLineInstruction(true), /In the Helios line/);
  assert.match(buildLineInstruction(false), /In the Helios line/);
  assert.match(buildLineInstruction(false), /do not describe what Helios builds/i);
});

test('exactly one build-line row in the window still allows', () => {
  assert.equal(ceilingAllows([row(true, 0), row(false, 1), row(false, 2)]), true);
});

test('buildFitState puts the headline and the text under untrusted_content, each capped', () => {
  const st = buildFitState({ headline: 'H'.repeat(500), text: 'x'.repeat(7000) }) as {
    helios: string;
    story: { untrusted_content: { headline: string; text: string } };
  };
  assert.deepEqual(Object.keys(st.story), ['untrusted_content'], 'nothing from the story sits outside untrusted_content');
  assert.equal(st.story.untrusted_content.text.length, 6000);
  assert.equal(st.story.untrusted_content.headline.length, 300);
  assert.ok(st.helios.includes('forward-deployed'));
});

test('BUILD_FIT version', () => {
  assert.equal(BUILD_FIT.version, 'helios-build-fit@1');
});

test('Task 8b part 2: at most two emoji, never in the Helios line; the Helios line prefers a named industry', () => {
  assert.match(CAPTION_SHARED_RULES, /at most two emoji/i);
  assert.match(CAPTION_SHARED_RULES, /one may lead the hook, and one may follow the question or call to action/);
  assert.match(CAPTION_SHARED_RULES, /Never put one in the Helios line, the credits, the Source line or the hashtags/);
  assert.match(CAPTION_SHARED_RULES, /Name the industry from the context above that best matches this story/);
  assert.match(CAPTION_SHARED_RULES, /only when none (fits|does)/);
  assert.match(CAPTION_SHARED_RULES, /inside what Helios builds/);
  assert.equal(CAPTION_EMOJI_MAX, 2);
  assert.equal(countEmoji('No emoji here.'), 0);
  assert.equal(countEmoji('🚀 Launch. Which would you pick? 👇'), 2);
  assert.equal(countEmoji('👩‍💻 one joined emoji, ❤️ one with a selector, 👍🏽 one with a skin tone'), 3);
});

test('fix round 1: no fixed list of example industries in any caption prompt', async () => {
  const { CAPTION_INSTRUCTIONS } = await import('@/lib/explainers/caption');
  const { COPY_SKILL } = await import('@/lib/reels/copy/skill');
  const { CAPTIONER_SYSTEM } = await import('@/lib/social/captioner/prompt');
  for (const [name, text] of Object.entries({ CAPTION_SHARED_RULES, CAPTION_INSTRUCTIONS, COPY_SKILL, CAPTIONER_SYSTEM })) {
    assert.doesNotMatch(text, /a real estate team|a med spa|an HVAC company|a consumer brand\)/, name);
    assert.match(text, /best matches this story/, name);
    assert.match(text, /not (the one|one) (the )?recent closings used/, name);
  }
});

test('HELIOS_NAME: one case-sensitive brand check for every caption type', () => {
  assert.equal(HELIOS_NAME.source, '\\bHelios\\b');
  assert.equal(HELIOS_NAME.flags, '', 'case-sensitive and stateless (no g flag)');
  assert.ok(HELIOS_NAME.test('At Helios we build.'));
  assert.ok(!HELIOS_NAME.test('at helios we build.'));
  assert.ok(!HELIOS_NAME.test('the heliosphere'));
});
