import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  parseBrief,
  parseCaption,
  parseDraft,
  parseEditedPost,
  parseFactCheck,
} from '@/lib/social/editorial/v2/parse';

describe('parseBrief', () => {
  test('parses the full labeled-lines format', () => {
    const raw = `SINGLE STORY: no, Bloomberg Tech video roundup

THE NEWS:
Anthropic says Claude drives 26% of its own R&D as of September 2026.

THE STORY:
Anthropic told reporters on 2026-09-17 that Claude now writes 26% of its research code, up from 1% in March.

TERMS:
- Anthropic: an AI safety company that develops the Claude model family.
- Claude: Anthropic's family of AI models.

IMAGES:
IMAGE 1: Anthropic CEO Dario Amodei at a Senate hearing. Credit: AP Photo. Link: https://example.com/dario.jpg

SOURCES:
- Bloomberg, 2026-09-17, https://www.bloomberg.com/news/articles/anthropic-claude-rd
- The Information, 2026-09-18, https://www.theinformation.com/anthropic-follow-up`;

    const brief = parseBrief(raw);
    assert.equal(brief.singleStory.yes, false);
    assert.match(brief.singleStory.sourceNote, /Bloomberg Tech video roundup/);
    assert.match(brief.news, /Anthropic says Claude drives 26%/);
    assert.match(brief.story, /26% of its research code/);
    assert.equal(brief.terms.length, 2);
    assert.equal(brief.terms[0]!.name, 'Anthropic');
    assert.match(brief.terms[0]!.description, /AI safety company/);
    assert.equal(brief.images.length, 1);
    assert.equal(brief.images[0]!.number, 1);
    assert.match(brief.images[0]!.description, /Anthropic CEO Dario Amodei/);
    assert.equal(brief.images[0]!.credit, 'AP Photo');
    assert.equal(brief.images[0]!.link, 'https://example.com/dario.jpg');
    assert.equal(brief.sources.length, 2);
    assert.equal(brief.sources[0]!.outlet, 'Bloomberg');
    assert.equal(brief.sources[0]!.publishedAt, '2026-09-17');
    assert.equal(brief.sources[0]!.url, 'https://www.bloomberg.com/news/articles/anthropic-claude-rd');
  });

  test('IMAGES "None found" yields empty images array', () => {
    const raw = `SINGLE STORY: yes

THE NEWS: OpenAI opened a new data center.
THE STORY: OpenAI announced a new data center in Iowa.
TERMS:
IMAGES: None found
SOURCES:
- The Verge, 2026-09-10, https://theverge.com/openai`;
    const brief = parseBrief(raw);
    assert.equal(brief.images.length, 0);
    assert.equal(brief.singleStory.yes, true);
  });

  test('missing labels return empty, not error', () => {
    const raw = `SINGLE STORY: yes\n\nTHE NEWS:\nSomething happened.\n\nSOURCES:\n- Outlet, 2026-01-01, https://x.example.com`;
    const brief = parseBrief(raw);
    assert.equal(brief.story, '');
    assert.equal(brief.terms.length, 0);
    assert.equal(brief.images.length, 0);
    assert.equal(brief.sources.length, 1);
  });
});

describe('parseDraft / parseEditedPost', () => {
  const draftRaw = `COVER OPTIONS:
1. [Shock number] Anthropic says its own AI writes 26% of the code its researchers ship.
2. [Frame shift] Anthropic went from 1% to 26% AI-written R&D code in six months.
3. [Authority vs. hype] Anthropic's own numbers say AI is doing a quarter of its research work.
CHOSEN: 1
COVER HIGHLIGHT: 26% of the code
COVER IMAGE: brief image 1

SLIDE 2
HEADLINE: Anthropic's own AI writes a quarter of its R&D code
BODY: Anthropic told reporters on September 17 that Claude now writes 26% of the code its researchers ship, up from 1% in March.
HIGHLIGHT: 26% of the code
IMAGE: brief image 1

SLIDE 3
BODY: The company said it measured the share by tracking which pull requests were opened by Claude vs. human engineers.
HIGHLIGHT: pull requests were opened by Claude
IMAGE: type only

FOLLOW: Follow Helios to keep up with how AI companies are actually using their own tools.`;

  test('parses cover options, chosen, and highlight', () => {
    const p = parseDraft(draftRaw);
    assert.equal(p.cover.kind, 'draft');
    if (p.cover.kind === 'draft') {
      assert.equal(p.cover.options.length, 3);
      assert.equal(p.cover.options[0]!.framework, 'Shock number');
      assert.equal(p.cover.chosen, 1);
      assert.equal(p.cover.text, 'Anthropic says its own AI writes 26% of the code its researchers ship.');
      assert.equal(p.cover.highlight, '26% of the code');
      assert.equal(p.cover.image, 'brief image 1');
    }
  });

  test('parses slides with headline, body, highlight, image', () => {
    const p = parseDraft(draftRaw);
    assert.equal(p.slides.length, 2);
    assert.equal(p.slides[0]!.position, 2);
    assert.equal(p.slides[0]!.headline, "Anthropic's own AI writes a quarter of its R&D code");
    assert.match(p.slides[0]!.body ?? '', /Claude now writes 26%/);
    assert.equal(p.slides[0]!.highlight, '26% of the code');
    assert.equal(p.slides[0]!.image, 'brief image 1');
  });

  test('parses FOLLOW', () => {
    const p = parseDraft(draftRaw);
    assert.match(p.follow, /Follow Helios/);
    assert.equal(p.editNotes, null);
  });

  test('parses EDIT NOTES on edited post', () => {
    const editedRaw = `COVER: Anthropic says its own AI writes 26% of R&D code.
COVER HIGHLIGHT: 26% of R&D code
COVER IMAGE: brief image 1

SLIDE 2
BODY: Anthropic said Claude wrote 26% of its R&D code as of September 2026.
HIGHLIGHT: 26% of its R&D code
IMAGE: type only

FOLLOW: Follow Helios for how AI companies use their own tools.

EDIT NOTES:
- Tightened cover: dropped "the code its researchers ship" — redundant with "R&D code."
- Cut a slide that repeated the pull-request measurement point.`;
    const p = parseEditedPost(editedRaw);
    assert.equal(p.cover.kind, 'edited');
    if (p.cover.kind === 'edited') {
      assert.match(p.cover.text, /Anthropic says its own AI writes 26%/);
    }
    assert.equal(p.editNotes?.length, 2);
    assert.match(p.editNotes?.[0] ?? '', /Tightened cover/);
  });
});

describe('parseCaption', () => {
  test('treats "AI:" inside caption as text, not a label', () => {
    const raw = `CAPTION:
Anthropic says Claude — its own AI — writes 26% of the code its researchers ship, up from 1% in March. The company said Sam Altman wrote AI: powered dev tools have finally arrived.

Would you trust AI-written code in your bank's software?

Follow Helios to keep up with how AI companies are actually using their own tools.

Source: Bloomberg, September 17, 2026. Additional reporting: The Information.`;
    const caption = parseCaption(raw);
    assert.match(caption, /AI: powered dev tools have finally arrived/);
    assert.match(caption, /Source: Bloomberg/);
  });
});

describe('parseFactCheck', () => {
  test('parses PASS verdict with no flags', () => {
    const raw = `VERDICT: PASS\n\nFLAGS:\n`;
    const r = parseFactCheck(raw);
    assert.equal(r.verdict, 'PASS');
    assert.equal(r.flags.length, 0);
  });

  test('parses FLAGGED with multiple flags of both sizes', () => {
    const raw = `VERDICT: FLAGGED

FLAGS:
WHERE: SLIDE 3 / BODY
TEXT: SoftBank is betting on the same loop with $21 billion.
PROBLEM: Sources do not mention SoftBank in the context of this story.
SOURCES SAY: Nothing
SIZE: BIG

WHERE: CAPTION / TEXT
TEXT: The rise from 1% is unprecedented.
PROBLEM: "unprecedented" is a banned voice word and the claim is not in the sources.
SOURCES SAY: Sources describe the rise as "significant."
SIZE: SMALL
`;
    const r = parseFactCheck(raw);
    assert.equal(r.verdict, 'FLAGGED');
    assert.equal(r.flags.length, 2);
    assert.equal(r.flags[0]!.size, 'BIG');
    assert.equal(r.flags[0]!.where, 'SLIDE 3 / BODY');
    assert.match(r.flags[0]!.text, /SoftBank is betting/);
    assert.equal(r.flags[1]!.size, 'SMALL');
    assert.equal(r.flags[1]!.where, 'CAPTION / TEXT');
  });
});
