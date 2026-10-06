/**
 * M7 mechanical guarantees (spec §6): one test per fix and per check.
 * Pure functions, offline.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { briefSuperIntelligenceForce } from '@/fixtures/social/briefs';
import { sifDraft } from '@/fixtures/social/drafts';
import {
  applySilentFixes, checkBackground, checkCaption, checkDroppedText, checkLimits, checkPhotoCredit, checkQuoteMarks, checkVoice,
  expectedSlideText, fixDashes, fixQuoteMarks, fixTrailingComma, fixWhitespace, LIMITS, quotedSpans,
} from '@/lib/social/mechanical/checks';
import { voiceHits } from '@/lib/social/mechanical/voice-lists';
import type { Photo } from '@/lib/social/photos/find';
import { fillDraft, type FilledDraft } from '@/lib/social/writer/draft';

const brief = briefSuperIntelligenceForce;
const draft = (edit?: (d: FilledDraft) => void): FilledDraft => {
  const d = fillDraft(sifDraft(), brief());
  d.caption.text = 'Trump announced a Super Intelligence Force on Sunday.\n\nSource: TechCrunch, October 4, 2026.';
  edit?.(d);
  return d;
};
const ids = (f: Array<{ id: string }>) => f.map((x) => x.id);

// ── A. Silent fixes ──────────────────────────────────────────────────────

test('F1 dashes: em dash → comma, numeric en dash → hyphen, spaced double hyphen → comma; hyphens kept', () => {
  assert.equal(fixDashes('Le Chonk is live — the weights are not.'), 'Le Chonk is live, the weights are not.');
  assert.equal(fixDashes('2024–2025 results'), '2024-2025 results');
  assert.equal(fixDashes('fast -- and cheap'), 'fast, and cheap');
  assert.equal(fixDashes('AI-driven, open-weight'), 'AI-driven, open-weight');
});

test('F2 quote marks: straight → typographic; apostrophes → ’', () => {
  assert.equal(fixQuoteMarks(`He said "no" and it's done`), 'He said “no” and it’s done');
  assert.equal(fixQuoteMarks("the 'duct tape' line"), 'the ‘duct tape’ line');
});

test('F3 whitespace and markdown leftovers', () => {
  assert.equal(fixWhitespace('**Bold**  claim .\n\n\n\n- item'), 'Bold claim.\n\nitem');
});

test('F4 trailing comma stripped from a displayed quote; words unchanged', () => {
  assert.equal(fixTrailingComma('of all Americans,'), 'of all Americans');
  assert.equal(fixTrailingComma('of all Americans , '), 'of all Americans');
  assert.equal(fixTrailingComma('a, b'), 'a, b');
});

test('applySilentFixes: fixes the stages’ text, never a quote’s words, and logs each fix', () => {
  const d = draft((x) => {
    x.slides[0]!.body!.text = 'Trump announced it — on Truth Social.';
    x.slides[2]!.quote!.text = 'coordinating — the effort,';
  });
  const r = applySilentFixes(d);
  assert.equal(r.draft.slides[0]!.body!.text, 'Trump announced it, on Truth Social.');
  assert.equal(r.draft.slides[2]!.quote!.text, 'coordinating — the effort', 'quote: only the trailing comma');
  assert.ok(ids(r.fixes).includes('F1') && ids(r.fixes).includes('F4'));
  assert.ok(r.fixes.every((f) => f.before !== f.after));
});

// ── B. Checks ────────────────────────────────────────────────────────────

test('C1 limits: over the limit fails with the exact overage; never trimmed', () => {
  const long = 'x'.repeat(LIMITS.headline + 7);
  const d = draft((x) => (x.slides[1]!.headline.text = long));
  const f = checkLimits(d);
  assert.deepEqual(ids(f), ['C1']);
  assert.match(f[0]!.detail, /67 chars, limit 60 \(7 over\)/);
  assert.equal(d.slides[1]!.headline.text, long);
  assert.deepEqual(checkLimits(draft()), []);
});

test('C2 quote marks: allowed only around a QUOTES entry word for word', () => {
  assert.deepEqual(quotedSpans('He called it “freaking insane” and ‘bad’, but it’s fine'), ['freaking insane', 'bad']);
  const ok = draft((x) => (x.slides[0]!.body!.text = 'Clayton said it was about “not being first.”'));
  assert.deepEqual(checkQuoteMarks(ok, brief()), []);
  const bad = draft((x) => (x.slides[0]!.body!.text = 'Critics called it “extremely reckless”.'));
  const f = checkQuoteMarks(bad, brief());
  assert.deepEqual(ids(f), ['C2']);
  assert.match(f[0]!.detail, /extremely reckless/);
});

test('C3 voice list: banned words, phrases, openers, "!" and emoji in the stages’ words; quoted speech exempt', () => {
  assert.deepEqual(voiceHits('A groundbreaking step').map((h) => h.match), ['groundbreaking']);
  assert.deepEqual(voiceHits('It reshapes the AI space').map((h) => h.kind).sort(), ['phrase', 'word']);
  assert.deepEqual(voiceHits('It rose. Meanwhile, rivals fell!').map((h) => h.kind).sort(), ['exclamation', 'opener']);
  assert.deepEqual(voiceHits('Transformers are a model design'), [], '"transformer" is not "transform"');
  const quoted = draft((x) => (x.slides[0]!.body!.text = 'He called it “a revolutionary moment”.'));
  assert.deepEqual(checkVoice(quoted), []);
  const own = draft((x) => (x.slides[0]!.body!.text = 'A revolutionary moment, experts say.'));
  assert.deepEqual(checkVoice(own).map((f) => f.detail).sort(), ['phrase: "experts say"', 'word: "revolutionary"']);
});

test('C4 caption: exactly one Source line naming a brief source, no links, no hashtags', () => {
  assert.deepEqual(checkCaption(draft(), brief()), []);
  assert.match(checkCaption(draft((x) => (x.caption.text = 'Trump announced it.')), brief())[0]!.detail, /0 "Source:" lines/);
  assert.match(checkCaption(draft((x) => (x.caption.text = 'x\n\nSource: The Ledger, March 4.')), brief())[0]!.detail, /names no outlet/);
  assert.match(checkCaption(draft((x) => (x.caption.text = 'x\n\nSource: TechCrunch, https://techcrunch.com')), brief())[0]!.detail, /link/);
  assert.match(checkCaption(draft((x) => (x.caption.text += '\n#AI #Trump')), brief())[0]!.detail, /hashtags: #AI #Trump/);
});

test('C5 at most 2 background slides (slides resting only on B# entries)', () => {
  assert.deepEqual(checkBackground(draft()), []);
  const d = draft((x) => {
    for (const i of [0, 1, 4]) {
      x.slides[i]!.headline.facts = ['B1'];
      if (x.slides[i]!.body) x.slides[i]!.body!.facts = ['B2'];
    }
  });
  assert.match(checkBackground(d)[0]!.detail, /4 background slides/, 'the fixture already has one (B2)');
});

test('C6 photo credit: present, allowed licence, no agency credit', () => {
  const p = (credit: string, source: Photo['source'] = 'stock'): Photo => ({ url: 'u', credit, source, width: 1, height: 1, qid: null, subject: null });
  const b = brief();
  assert.deepEqual(checkPhotoCredit(p('Jane Doe, CC BY · via flickr'), 'slide 2', b), []);
  assert.deepEqual(checkPhotoCredit(p('NASA (public domain) · Wikimedia Commons', 'starter'), 'slide 2', b), []);
  assert.match(checkPhotoCredit(p(''), 'slide 2', b)[0]!.detail, /without a credit/);
  assert.match(checkPhotoCredit(p('Jane Doe · via flickr'), 'slide 2', b)[0]!.detail, /no allowed licence/);
  assert.match(checkPhotoCredit(p('Kevin Dietsch / Getty Images, CC BY'), 'slide 2', b)[0]!.detail, /agency/);
  assert.deepEqual(checkPhotoCredit(p('Official White House Photo by Daniel Torok', 'article'), 'slide 2', b), []);
  assert.match(checkPhotoCredit(p('Photo: John Smith', 'article'), 'slide 2', b)[0]!.detail, /not allowed/);
});

test('C7 dropped text: every draft field must appear on its rendered slide', () => {
  const d = draft();
  const rendered = expectedSlideText(d).map((f) => f.join(' ').toUpperCase());
  assert.deepEqual(checkDroppedText(d, rendered), [], 'case and quote marks are ignored');
  // The frozen quote layout drops the slide's headline.
  const quoteSlide = 1 + d.slides.findIndex((s) => s.type === 'quote');
  rendered[quoteSlide] = `${d.slides[quoteSlide - 1]!.quote!.text} ${d.slides[quoteSlide - 1]!.quote!.speaker}`;
  const f = checkDroppedText(d, rendered);
  assert.deepEqual(ids(f), ['C7']);
  assert.match(f[0]!.detail, /His pitch/);
});
