import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { joinBriefFromTurns } from '@/lib/social/editorial/v2/reporter';
import { parseBrief } from '@/lib/social/editorial/v2/parse';

/**
 * Mocks the real interleaved shape of a Sonnet response when server-side
 * web_search is enabled: text blocks split at citation breakpoints, mixed
 * with server_tool_use and web_search_tool_result blocks. This exercises
 * the exact bug that made the first live Bloomberg run fail — the reporter
 * kept only the first text block and lost everything after the first
 * web_search fired.
 */

// Cast is fine — these fixtures only need to satisfy `block.type === 'text'`.
type AnyBlock = { type: string; [k: string]: unknown };

describe('joinBriefFromTurns — server-web_search interleaving', () => {
  test('joins every text block in order across an interleaved single-turn response', () => {
    const turn: AnyBlock[] = [
      { type: 'text', text: 'SINGLE STORY: no, Bloomberg Tech video roundup\n\nTHE NEWS:\nAnthropic says Claude writes 26% of its own R&D code.\n\nTHE STORY:\n\nWhat Anthropic disclosed\n\n' },
      { type: 'server_tool_use', id: 'srvtool_1', name: 'web_search', input: { query: 'anthropic claude R&D code 26 percent september 2026' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtool_1', content: [{ type: 'web_search_result', url: 'https://bloomberg.example.com/x', title: 't' }] },
      { type: 'text', text: 'Anthropic told reporters on September 17 that Claude now writes 26% of the code its researchers ship, up from 1% in March.\n\n' },
      { type: 'server_tool_use', id: 'srvtool_2', name: 'web_search', input: { query: 'anthropic press page september 2026' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtool_2', content: [{ type: 'web_search_result', url: 'https://anthropic.example.com/press', title: 't' }] },
      { type: 'text', text: 'TERMS:\n- Anthropic: an AI safety company.\n- Claude: Anthropic\'s model family.\n\nIMAGES:\nIMAGE 1: Dario Amodei at a Senate hearing. Credit: AP Photo. Link: https://x.example.com/dario.jpg\n\nSOURCES:\n- Bloomberg, 2026-09-17, https://bloomberg.example.com/x\n- Anthropic press, 2026-09-17, https://anthropic.example.com/press' },
    ];
    const joined = joinBriefFromTurns([turn as never]);
    const brief = parseBrief(joined);

    // The bug: the old code would grab only the first text block and lose
    // everything after "What Anthropic disclosed" — brief.sources.length
    // would be 0 and the orchestrator would bail. Post-fix, sources are
    // parsed from the third text block.
    assert.equal(brief.sources.length, 2);
    assert.equal(brief.sources[0]!.outlet, 'Bloomberg');
    assert.equal(brief.images.length, 1);
    assert.equal(brief.terms.length, 2);
    assert.match(brief.story, /26%/);
  });

  test('joins text blocks across a pause_turn → end_turn split', () => {
    // Model paused mid-answer after the story section (long web_search chain).
    // Turn 1 ended with pause_turn; turn 2 continued and ended with end_turn.
    // The joined text must read as one continuous brief.
    const turn1: AnyBlock[] = [
      { type: 'text', text: 'SINGLE STORY: no, Bloomberg Tech video roundup\n\nTHE NEWS:\nAnthropic says Claude writes 26% of its R&D code.\n\nTHE STORY:\nAnthropic told reporters ' },
      { type: 'server_tool_use', id: 'srvtool_a', name: 'web_search', input: { query: 'anthropic 26 percent code' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtool_a', content: [{ type: 'web_search_result', url: 'https://bloomberg.example.com/x', title: 't' }] },
    ];
    const turn2: AnyBlock[] = [
      { type: 'text', text: 'on September 17 that Claude now writes 26% of the code its researchers ship, up from 1% in March.\n\nTERMS:\n- Anthropic: an AI safety company.\n\nIMAGES: None found\n\nSOURCES:\n- Bloomberg, 2026-09-17, https://bloomberg.example.com/x' },
    ];
    const joined = joinBriefFromTurns([turn1 as never, turn2 as never]);
    const brief = parseBrief(joined);
    assert.match(brief.story, /Anthropic told reporters on September 17 that Claude/);
    assert.equal(brief.sources.length, 1);
  });

  test('drops preamble before the last SINGLE STORY: label', () => {
    const turn: AnyBlock[] = [
      { type: 'text', text: 'I now have enough information to write the brief. Let me start:\n\nSINGLE STORY: yes\n\nTHE NEWS:\nOne line.\n\nTHE STORY:\nBody.\n\nTERMS:\n- Foo: bar.\n\nIMAGES: None found\n\nSOURCES:\n- The Ledger, 2026-01-01, https://x.example.com' },
    ];
    const joined = joinBriefFromTurns([turn as never]);
    assert.ok(joined.startsWith('SINGLE STORY:'), `expected to start with SINGLE STORY:, got: ${joined.slice(0, 60)}`);
    const brief = parseBrief(joined);
    assert.equal(brief.sources.length, 1);
  });

  test('empty response yields empty string, not a crash', () => {
    assert.equal(joinBriefFromTurns([]), '');
    assert.equal(joinBriefFromTurns([[]]), '');
  });
});
