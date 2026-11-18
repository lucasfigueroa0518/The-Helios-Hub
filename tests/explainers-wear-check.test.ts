// The wear check (VISUAL_SYSTEM_6.md § 4, § 6; D89). The model is
// always a stub: the real call runs only inside a render a human started (CLAUDE.md Rule 1).
import assert from 'node:assert/strict';
import test from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { CONFUSING_PIECE_MAX, READS_AS_ROLE_MIN, WEAR_CHECK, WEAR_QUESTIONS, wearPasses } from '@/lib/explainers/jev/questions/wear-check';
import { bareCritter, runWearCheck, WEAR_CHECK_INSTRUCTIONS, wearCheckParams, type WearCritter } from '@/lib/explainers/render/job';
import type { PictureVision } from '@/lib/explainers/render/picture';

const ROLES = ['chef', 'barista', 'mail carrier', 'office worker'];
const PLAN = [
  '## Anchor scene',
  '',
  '- hero: barista — critter',
  '- entities:',
  '  - barista — the barista — stands for the app — critter: orange body, barista — beats 1, 4',
  '  - courier — a courier — stands for the webhook sender — critter: ink body — beats 4',
  '  - cook — the cook — stands for the server — critter: white body, chef — beats 4, 5',
  '  - clerk — a clerk — stands for the cache — critter: green body, bare — beats 5',
  '  - till — the till — stands for the queue — a mustard box — beats 4',
  '',
  '## Hook',
  '',
].join('\n');

/** A stub vision model: records the request, replies with `reply`. */
function stubVision(reply: object | string) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const vision: PictureVision = async (params) => {
    calls.push(params);
    return { text: typeof reply === 'string' ? reply : JSON.stringify(reply), model: 'claude-haiku-stub', usage: { input_tokens: 900, output_tokens: 80 }, usd: 0.002 };
  };
  return { vision, calls };
}
const sheet = async () => Buffer.from('jpeg');

test('the wear check questions are the spec wording, and code holds the thresholds', () => {
  assert.equal(WEAR_CHECK.id, 'explainers-wear-check');
  assert.deepEqual(Object.keys(WEAR_CHECK.questions), ['reads_as_role', 'confusing_piece']);
  assert.equal(WEAR_QUESTIONS.reads_as_role.question, 'Looking only at this character, would most viewers say it is a {role} (or a close synonym)?');
  assert.equal(WEAR_QUESTIONS.confusing_piece.question, 'Is any item on this character hard to identify, or does anything look like a mouth, teeth, eyebrows or another face part?');
  assert.deepEqual([READS_AS_ROLE_MIN, CONFUSING_PIECE_MAX], [0.6, 0.4]);
  assert.equal(wearPasses({ reads_as_role: 0.6, confusing_piece: 0.39 }), true);
  assert.equal(wearPasses({ reads_as_role: 0.59, confusing_piece: 0 }), false);
  assert.equal(wearPasses({ reads_as_role: 1, confusing_piece: 0.4 }), false);
});

test('one vision call per reel: the stable instructions are the cached prefix; the sheet and the roles follow', () => {
  const critters: WearCritter[] = [{ id: 'barista', body: 'orange', role: 'barista' }, { id: 'cook', body: 'white', role: 'chef' }];
  const p = wearCheckParams('claude-haiku-5-5', critters, Buffer.from('jpeg'));
  assert.equal(p.model, 'claude-haiku-5-5');
  const system = p.system as Anthropic.TextBlockParam[];
  assert.equal(system.length, 1);
  assert.equal(system[0].text, WEAR_CHECK_INSTRUCTIONS);
  assert.ok(system[0].cache_control, 'the instructions carry the cache breakpoint (CLAUDE.md prompt caching)');
  for (const q of Object.values(WEAR_QUESTIONS)) assert.ok(WEAR_CHECK_INSTRUCTIONS.includes(q.question));
  assert.ok(!/barista|chef/.test(WEAR_CHECK_INSTRUCTIONS), 'no reel-specific word in the cached prefix');
  const content = p.messages[0].content as Anthropic.ContentBlockParam[];
  assert.equal(content[0].type, 'image');
  assert.equal((content[1] as Anthropic.TextBlockParam).text, 'The roles, by number:\n1: barista\n2: chef');
});

test('pass and fallback: a critter that does not read as its role is drawn bare for the whole reel, with the reason', async () => {
  const { vision, calls } = stubVision({
    critters: [
      { n: 1, reads_as_role: 0.9, confusing_piece: 0.1, why: 'a barista with a cup' },
      { n: 2, reads_as_role: 0.35, confusing_piece: 0.55, why: 'reads as a baker; the hat brim looks like a brow' },
    ],
  });
  const r = await runWearCheck({ projectDir: '/nowhere', storyboard: PLAN, model: 'claude-haiku-5-5', vision, sheet, roles: ROLES });
  assert.equal(calls.length, 1, 'one call for the whole cast');
  // only critters that wear a role are judged: the courier names none, the clerk is bare
  assert.equal(((calls[0].messages[0].content as Anthropic.ContentBlockParam[])[1] as Anthropic.TextBlockParam).text, 'The roles, by number:\n1: barista\n2: chef');
  assert.equal(r.ran, true);
  assert.deepEqual(r.vision, { model: 'claude-haiku-stub', usage: { input_tokens: 900, output_tokens: 80 }, usd: 0.002 });
  assert.deepEqual(r.bare.map((b) => [b.id, b.role]), [['cook', 'chef']]);
  assert.match(r.bare[0].reason, /it reads as a chef at 0\.35 \(needs 0\.6\); a confusing piece at 0\.55 \(under 0\.4\) \(reads as a baker; the hat brim looks like a brow\)/);
  // the storyboard says bare on the cook's look line; everything else is kept
  assert.ok(r.storyboard.includes('  - cook — the cook — stands for the server — critter: white body, bare — beats 4, 5'), r.storyboard);
  assert.equal(r.storyboard.replace('white body, bare', 'white body, chef'), PLAN);
});

test('fallback: a critter the reply leaves out is drawn bare; an unreadable reply throws (the job fails open)', async () => {
  const left = await runWearCheck({ projectDir: '/nowhere', storyboard: PLAN, model: 'm', vision: stubVision({ critters: [{ n: 1, reads_as_role: 0.8, confusing_piece: 0 }] }).vision, sheet, roles: ROLES });
  assert.deepEqual(left.bare, [{ id: 'cook', role: 'chef', reason: 'the wear check gave no reading for it' }]);
  await assert.rejects(runWearCheck({ projectDir: '/nowhere', storyboard: PLAN, model: 'm', vision: stubVision({ nope: 1 }).vision, sheet, roles: ROLES }), /no critters/);
});

test('nothing to judge: no critter wears a role, or the sheet cannot be drawn, and no call is made', async () => {
  const none = stubVision({ critters: [] });
  const bare = PLAN.replace('orange body, barista', 'orange body, bare').replace('white body, chef', 'white body, bare');
  assert.deepEqual(await runWearCheck({ projectDir: '/nowhere', storyboard: bare, model: 'm', vision: none.vision, sheet, roles: ROLES }), { storyboard: bare, bare: [], ran: false });
  assert.equal((await runWearCheck({ projectDir: '/nowhere', storyboard: PLAN, model: 'm', vision: none.vision, sheet: async () => null, roles: ROLES })).ran, false);
  assert.equal(none.calls.length, 0);
});

test('bareCritter: the role in the look goes bare; a look with no role named gets bare added before its beats', () => {
  const line = (look: string) => `## Anchor scene\n\n- entities:\n  - post — a mail carrier — stands for the mail carrier service — ${look} — beats 1, 4\n`;
  assert.equal(bareCritter(line('critter: ink body, mail carrier'), 'post', 'mail carrier'), line('critter: ink body, bare'));
  // the "stands for" part names the real thing and keeps its words
  assert.ok(bareCritter(line('critter: ink body, mail carrier'), 'post', 'mail carrier').includes('stands for the mail carrier service'));
  assert.equal(bareCritter(line('critter: ink body'), 'post', 'mail carrier'), line('critter: ink body — bare (its role did not read in the wear check)'));
  assert.equal(bareCritter(line('critter: ink body, mail carrier'), 'other', 'mail carrier'), line('critter: ink body, mail carrier'));
});
