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
  // Fix round 1 (controller, 2026-10-20): the build-line distinction stays. False: Helios's view, no build or service claim.
  // Fix round 2: a content description, no example shapes (they become templates and invite service claims).
  // Fix round 3 (Tommy, 2026-10-20, live Reels check): no label noun ("Helios's call") the model can echo as an opener.
  assert.match(buildLineInstruction(false), /say what a business in that industry should start, stop, or watch because of this story, said in Helios's voice/);
  assert.doesNotMatch(buildLineInstruction(false), /Helios's call|Helios's view/);
  assert.match(buildLineInstruction(false), /with no description of anything Helios builds or does for clients/);
  assert.doesNotMatch(buildLineInstruction(false), /what we would tell|in its place/);
  assert.match(buildLineInstruction(false), /No service claims/);
  assert.match(buildLineInstruction(true), /may say what Helios builds/);
  assert.match(buildLineInstruction(true), /drawn only from the Helios context/);
  assert.match(buildLineInstruction(true), /If you do, that sentence is the only place Helios is named/);
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
  assert.match(CAPTION_SHARED_RULES, /only when none (fits|does)|If none fits, speak to marketing or sales teams in general/);
  assert.match(CAPTION_SHARED_RULES, /inside the work Helios knows/);
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

test("copy fix: the shared Helios line makes one concrete point as Helios's view, hands over no opener, and bans the stock tags", () => {
  assert.match(CAPTION_SHARED_RULES, /one or two plain sentences that make one concrete point about this story for the industry it names/);
  assert.match(CAPTION_SHARED_RULES, /It says what a business in that industry should start, stop, or watch because of this story, said in Helios's voice/);
  assert.match(CAPTION_SHARED_RULES, /The task says whether it may also say what Helios builds/);
  assert.match(CAPTION_SHARED_RULES, /Do not start it the way any recent closing starts, and vary where "Helios" sits in the sentence/);
  // Fix round 1: describe the content, never hand the model an opener.
  assert.doesNotMatch(CAPTION_SHARED_RULES, /"Helios builds|"At Helios we/);
  const tagLine = CAPTION_SHARED_RULES.split('\n').find((l) => l.includes('No stock tags'));
  assert.ok(tagLine, 'one compact stock-tag line');
  for (const tag of STOCK_TAGS) assert.ok(tagLine!.includes(`"${tag}"`), tag);
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
    assert.match(flat, /should start, stop, or watch because of (this story|this concept|that story), said in Helios's voice/, name);
    assert.match(flat, /says whether it may also say what Helios builds/, name);
    assert.match(flat, /the way any recent closing starts/, name);
    assert.match(flat, /vary where "Helios" sits in the sentence/, name);
    assert.match(flat, /stock tag/i, name);
    assert.doesNotMatch(flat, /"Helios builds \.\.\."|"At Helios we \.\.\."|Helios is the subject/, name);
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

// Fix round 3 (Tommy, 2026-10-20, after the live Reels check): the Helios line opened "Our call at
// Helios for any ...", echoing the prompt's own "Helios's call"; a Reels caption ran 1,947 characters
// with a staged "Here's the catch:"; a Lego story was pinned to "apparel or footwear".
const PROMPT_TEXTS = async () => {
  const { CAPTION_INSTRUCTIONS } = await import('@/lib/explainers/caption');
  const { COPY_SKILL } = await import('@/lib/reels/copy/skill');
  const { CAPTIONER_CAROUSEL_RULES } = await import('@/lib/social/captioner/prompt');
  const { LFD_CAPTION_SYSTEM } = await import('@/lib/lfd/caption-lines');
  const lfdOwn = LFD_CAPTION_SYSTEM.slice(LFD_CAPTION_SYSTEM.indexOf(CAPTION_SHARED_RULES) + CAPTION_SHARED_RULES.length);
  const explainerOwn = CAPTION_INSTRUCTIONS.slice(CAPTION_INSTRUCTIONS.indexOf(CAPTION_SHARED_RULES) + CAPTION_SHARED_RULES.length);
  const skill = readFileSync('.cursor/skills/explainer-caption/SKILL.md', 'utf8');
  return { CAPTION_SHARED_RULES, CAPTIONER_CAROUSEL_RULES, COPY_SKILL, explainerOwn, lfdOwn, skill };
};

test('fix round 3: no caption prompt names the Helios line with a label noun the model can copy', async () => {
  for (const [name, text] of Object.entries(await PROMPT_TEXTS())) {
    const flat = text.replace(/\s+/g, ' ');
    // "Helios's view" / "Helios's call" may appear only inside the quoted list of banned openers.
    const outsideBanList = flat.replace(/\("Our call"[^)]*\)|such as "Our call"[^;]*;/g, '');
    assert.doesNotMatch(outsideBanList, /Helios's (view|call)/, name);
  }
  assert.doesNotMatch(buildLineInstruction(false), /Helios's (view|call)/);
});

test('fix round 3: the Helios line never opens on a label or framing phrase', async () => {
  assert.match(
    CAPTION_SHARED_RULES,
    /Do not open the Helios line with a label or framing phrase, such as "Our call", "Our take", "Helios's view" or "Here's our advice"; open on the industry, the action, or the stakes\./,
  );
  for (const [name, text] of Object.entries(await PROMPT_TEXTS())) {
    const flat = text.replace(/\s+/g, ' ');
    assert.match(flat, /label or framing phrase/, name);
    assert.match(flat, /open on the industry, the action, or the stakes/, name);
  }
});

test('fix round 3: staged reveal and run-up phrases are banned for every format', () => {
  assert.match(
    CAPTION_SHARED_RULES,
    /No staged reveal or run-up phrase, such as "Here's the catch", "Here's the thing", "The twist\?" or "Plot twist"; fold the point into a plain sentence\./,
  );
});

test('fix round 3: a reasonable industry match never stretches to an adjacent industry', async () => {
  const rule = /A reasonable match means (the story's own business is in, or plainly close to, that industry|the concept plainly shows up in that industry's own work); never stretch to an adjacent one\. If none fits, speak to marketing or sales teams in general\./;
  for (const [name, text] of Object.entries(await PROMPT_TEXTS())) {
    assert.match(text.replace(/\s+/g, ' '), rule, name);
  }
});
