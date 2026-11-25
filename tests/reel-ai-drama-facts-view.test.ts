import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SUBMIT_FACT_SHEET_TOOL } from '@/lib/reel-ai-drama/reporting/report';
import { validateFactSheet } from '@/lib/reel-ai-drama/reporting/validate';
import type { FactSheet } from '@/lib/reel-ai-drama/types';
import { factTimeline, stripNotes } from '@/lib/reel-ai-drama/writing/timeline';

// The writer's view of the fact sheet (MD-119, MD-120). Generic fixtures; nothing calls a model.

const base = (): FactSheet => ({
  summary: 'A lab promised to open up.',
  timeline: [{ date: '2020-05-01', event: 'The memo', fact_ids: ['F1'] }],
  facts: [
    { id: 'F1', text: "The founder wrote that the lab would 'share everything it builds from now on'.", source_ids: ['S1'], key: true, confidence: 'confirmed' },
  ],
  sources: [
    { id: 'S1', url: 'https://example.com/a', title: 'A', publisher: 'Example Times', date: '2020-05-02', kind: 'report' },
    { id: 'S2', url: 'https://relay.example.org/b', title: 'B', publisher: 'Relay Blog (relaying Daily Wire)', date: '2020-05-03', kind: 'report' },
  ],
  quotes: [{ id: 'Q1', speaker: 'Jane Roe', text: 'We will share everything it builds from now on', source_id: 'S1', date: '2020-05-01', context: 'in a memo' }],
  artifacts: [{ id: 'A1', kind: 'post', text: 'The lab will share everything it builds from now on. Join us', source_id: 'S1', url: null, date: '2020-05-01' }],
  cast: [{ name: 'Jane Roe', role: 'founder of the lab', kind: 'person', player_id: null, qid: null }],
  places: [],
  verdict: { holds: true, reason: 'confirmed' },
});

test('a fact, the quote of it and the artifact with the same words are one line carrying every id', () => {
  const t = factTimeline(base());
  const lines = t.split('\n').filter((l) => l.startsWith('- 2020'));
  assert.equal(lines.length, 1, t);
  assert.match(lines[0]!, /^- 2020-05-01: The founder wrote .*\. The post read: "The lab will share everything it builds from now on\. Join us" \(F1, Q1, A1\)$/);
  assert.ok(!lines[0]!.includes('Jane Roe said'), 'the quote is covered by the line already');
});

test('unrelated items stay apart; a line never holds two facts', () => {
  const s = base();
  s.facts.push({ id: 'F2', text: 'The lab will share everything it builds from now on, a second outlet wrote.', source_ids: ['S1'], key: false, confidence: 'confirmed' });
  s.artifacts.push({ id: 'A2', kind: 'headline', text: 'Founder leaves', source_id: 'S1', url: null, date: '2021-01-01' });
  const t = factTimeline(s);
  assert.equal((t.match(/\(F1[,)]/g) ?? []).length, 1);
  assert.ok(t.split('\n').some((l) => /F2/.test(l) && !/F1/.test(l)), t);
  assert.ok(t.includes('- 2021-01-01: A headline read: "Founder leaves" (A2)'));
});

test('working notes are stripped; a one-source fact names its source, the original behind a relay', () => {
  assert.equal(
    stripNotes('Correction to the pitch: it was Max Doe who said it, as printed by Relay Blog. Other Paper prints the same quote.'),
    'It was Max Doe who said it.',
  );
  assert.equal(stripNotes('The report, relayed by Relay Blog, says the lab had 40 staff (the pitch said 50).'), 'The report says the lab had 40 staff.');
  assert.equal(stripNotes('Models ran 4.5 times faster. Our copies come from two relays.'), 'Models ran 4.5 times faster.');
  const s = base();
  s.timeline = [];
  s.quotes = [];
  s.artifacts = [];
  s.facts = [
    { id: 'F1', text: 'The lab had 40 staff, the newspaper reported.', source_ids: ['S2'], key: false, confidence: 'single_source' },
    { id: 'F2', text: 'Sources differ on the day: Example Times says Monday, Relay Blog says Tuesday.', source_ids: ['S1', 'S2'], key: false, confidence: 'disputed' },
  ];
  const t = factTimeline(s);
  assert.ok(t.includes('- The lab had 40 staff, the newspaper reported. (one source: Daily Wire) (F1)'), t);
  assert.ok(t.includes('Relay Blog says Tuesday. (disputed) (F2)'), t);
});

test("Who's who carries then, before, after and want with the context facts, told once; places and relations follow", () => {
  const s = base();
  s.facts.push(
    { id: 'F2', text: 'Jane Roe studied physics before founding the lab.', source_ids: ['S1'], key: false, confidence: 'confirmed' },
    { id: 'F3', text: 'Jane Roe now runs a robotics company.', source_ids: ['S2'], key: false, confidence: 'single_source' },
  );
  s.cast[0] = { ...s.cast[0]!, want: 'to recruit researchers', background: 'a physicist', later: 'runs a robotics company', context_fact_ids: ['F2', 'F3'] };
  s.places = [{ name: 'The lab', address: 'Main Street', lat: null, lon: null, role: 'where the memo was written', fact_ids: ['F1'] }];
  s.relations = [{ a: 'Jane Roe', relation: 'founded', b: 'The lab', fact_ids: ['F1'] }];
  const t = factTimeline(s);
  assert.ok(
    t.includes("Who's who:\n- Jane Roe — then: founder of the lab. Before: a physicist. After: runs a robotics company. Wanted: to recruit researchers. (F2, F3 (one source: Daily Wire))"),
    t,
  );
  assert.ok(!t.includes('studied physics'), 'a context fact off the timeline is told once, in Who\'s who');
  assert.ok(t.includes('Places:\n- The lab (Main Street): where the memo was written (F1)'));
  assert.ok(t.includes('How they connect:\n- Jane Roe founded The lab (F1)'));
});

test('validation: context ids must exist; before/after with no remaining fact is dropped; old sheets unchanged', () => {
  const s = base();
  s.facts.push({ id: 'F2', text: 'Jane Roe now runs a robotics company.', source_ids: ['S1'], key: false, confidence: 'confirmed' });
  s.cast.push(
    { name: 'Jane Roe 2', role: 'x', kind: 'person', player_id: null, qid: null, background: null, later: 'now runs a company', context_fact_ids: ['F2', 'F404'] },
    { name: 'Max Doe', role: 'y', kind: 'person', player_id: null, qid: null, background: 'a banker', later: null, context_fact_ids: ['F404'] },
  );
  s.places = [{ name: 'The lab', address: null, lat: null, lon: null, role: 'r', fact_ids: ['F1', 'F9'] }];
  const { sheet: out, problems } = validateFactSheet(s);
  assert.deepEqual(out.cast[1]!.context_fact_ids, ['F2']);
  assert.equal(out.cast[1]!.later, 'now runs a company');
  assert.equal(out.cast[2]!.background, null);
  assert.deepEqual(out.places[0]!.fact_ids, ['F1']);
  assert.ok(problems.some((p) => /Max Doe.*rests on no remaining fact; dropped/.test(p)));
  assert.ok(problems.some((p) => /unknown context facts F404/.test(p)));
  assert.deepEqual(validateFactSheet(base()).sheet.cast, base().cast, 'an old sheet gains no field');
  const props = (SUBMIT_FACT_SHEET_TOOL.input_schema as { properties: { cast: { items: { properties: Record<string, unknown> } } } }).properties;
  for (const k of ['background', 'later', 'context_fact_ids']) assert.ok(props.cast.items.properties[k], k);
});
