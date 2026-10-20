import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BUILD_FIT, buildFitState, buildLineInstruction, ceilingAllows, decideBuildLine, recentClosingsBlock, type RecentClosing } from '@/lib/social/captions/build-line';
import { CAPTION_EMOJI_MAX, countEmoji } from '@/lib/social/captions/emoji';
import { CAPTION_VERSION as EXPLAINER_CAPTION_VERSION } from '@/lib/explainers/caption';
import { LFD_CAPTION_VERSION } from '@/lib/lfd/caption-lines';
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
  assert.match(CAPTION_SHARED_RULES, /one or two plain sentences/);
  assert.match(CAPTION_SHARED_RULES, /Keep paragraphs short, one or two sentences each/);
  assert.doesNotMatch(CAPTION_SHARED_RULES, /may end by inviting the reader to follow/);
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
  assert.match(buildLineInstruction(false), /no separate sentence on what Helios builds or offers in general/i);
  assert.match(buildLineInstruction(false), /one concrete point/);
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
  assert.match(CAPTION_SHARED_RULES, /Usually one comes before the hook and one after the question or call to action/);
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

test('prompt registries name the caption versions in code', () => {
  const explainers = readFileSync('planning/Explainer Reels/DECISIONS.md', 'utf8');
  const current = explainers.split('\n').find((l) => l.startsWith('| Post caption | `lib/explainers/caption.ts`'));
  assert.ok(current?.includes(`\`${EXPLAINER_CAPTION_VERSION}\``), current);
  const lfd = readFileSync('docs/superpowers/specs/2026-10-13-last-few-days-design.md', 'utf8');
  assert.match(lfd, new RegExp(`\\| Caption \\| \`lib/lfd/caption-lines\\.ts\` \\| \`${LFD_CAPTION_VERSION}\` \\|`));
});

// Copy fix after the first live check (Tommy, 2026-10-20): the Helios line had converged on
// stock tags ("the kind of thing we think about at Helios", a trailing follow invite).
const STOCK_TAGS = ['the kind of thing we think about', 'how we think about it', 'we post more takes like this', "that's where Helios comes in"];

test('copy fix: the shared Helios line makes one concrete point with Helios doing something specific, and bans the stock tags', () => {
  assert.match(CAPTION_SHARED_RULES, /one or two plain sentences that make one concrete point about this story for the industry it names/);
  assert.match(CAPTION_SHARED_RULES, /Helios is the subject and does something specific it builds/);
  assert.match(CAPTION_SHARED_RULES, /"Helios builds \.\.\." or "At Helios we \.\.\." followed by a concrete action/);
  assert.match(CAPTION_SHARED_RULES, /Never a generic tag about how Helios thinks/);
  for (const tag of STOCK_TAGS) assert.ok(CAPTION_SHARED_RULES.includes(`"${tag}"`), tag);
  assert.match(CAPTION_SHARED_RULES, /A follow invite is rare: at most a short clause, now and then, never the default/);
  assert.doesNotMatch(CAPTION_SHARED_RULES, /lightly/);
});

test('copy fix: every caption prompt describes the Helios line as one concrete point and never defaults to a follow invite', async () => {
  const { CAPTION_INSTRUCTIONS } = await import('@/lib/explainers/caption');
  const { COPY_SKILL } = await import('@/lib/reels/copy/skill');
  const { CAPTIONER_CAROUSEL_RULES } = await import('@/lib/social/captioner/prompt');
  const { LFD_CAPTION_SYSTEM } = await import('@/lib/lfd/caption-lines');
  const lfdOwn = LFD_CAPTION_SYSTEM.slice(LFD_CAPTION_SYSTEM.indexOf(CAPTION_SHARED_RULES) + CAPTION_SHARED_RULES.length);
  const explainerOwn = CAPTION_INSTRUCTIONS.slice(CAPTION_INSTRUCTIONS.indexOf(CAPTION_SHARED_RULES) + CAPTION_SHARED_RULES.length);
  const skill = readFileSync('.cursor/skills/explainer-caption/SKILL.md', 'utf8');
  for (const [name, text] of Object.entries({ CAPTIONER_CAROUSEL_RULES, COPY_SKILL, explainerOwn, lfdOwn, skill })) {
    const flat = text.replace(/\s+/g, ' ');
    assert.match(flat, /one concrete point/i, name);
    assert.match(flat, /Helios is the subject doing something specific it builds/, name);
    assert.match(flat, /"At Helios we \.\.\." with a concrete action/, name);
    assert.match(flat, /never a generic tag|Never a generic tag/, name);
    assert.match(flat, /never the default|never by default/, name);
    assert.doesNotMatch(flat, /may end by inviting|It may end by inviting|may close it by inviting/, name);
    assert.doesNotMatch(flat, /names Helios once, lightly|Name Helios once, lightly|Helios is named once, lightly/, name);
  }
});

test('copy fix: usually one emoji before the hook and one after the question, still at most two', async () => {
  const { CAPTION_INSTRUCTIONS } = await import('@/lib/explainers/caption');
  const { COPY_SKILL } = await import('@/lib/reels/copy/skill');
  const { CAPTIONER_CAROUSEL_RULES } = await import('@/lib/social/captioner/prompt');
  const { LFD_CAPTION_SYSTEM } = await import('@/lib/lfd/caption-lines');
  for (const [name, text] of Object.entries({ CAPTION_SHARED_RULES, CAPTIONER_CAROUSEL_RULES, COPY_SKILL, CAPTION_INSTRUCTIONS, LFD_CAPTION_SYSTEM })) {
    assert.match(text, /[Uu]sually one/, name);
    assert.match(text, /at most two emoji|At most two emoji|At most 2 emoji/, name);
  }
});

test('copy fix: Reels, Explainers and LFD keep paragraphs to one or two sentences and cut secondary facts', async () => {
  const { CAPTION_INSTRUCTIONS } = await import('@/lib/explainers/caption');
  const { COPY_SKILL } = await import('@/lib/reels/copy/skill');
  const { LFD_CAPTION_SYSTEM } = await import('@/lib/lfd/caption-lines');
  for (const [name, text] of Object.entries({ COPY_SKILL, CAPTION_INSTRUCTIONS, LFD_CAPTION_SYSTEM })) {
    assert.match(text, /one or two sentences/, name);
    assert.match(text, /[Cc]ut (a|the) secondary (fact|detail)|cut secondary (facts|details)/, name);
  }
});
