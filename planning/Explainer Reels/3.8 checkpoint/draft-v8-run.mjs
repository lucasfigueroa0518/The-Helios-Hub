// Scratch run of the DRAFT analogy writer v8 and gap writer v2 (writers-draft-v8.md). Not system code.
// Lucas approved the live run on 2026-10-25 (~$0.50-1.00). Prompt caching on the stable system prefix.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/Users/lucasfigueroa/HELIOS/CODE/The-Helios-Hub';
const require = createRequire(path.join(REPO, 'package.json'));
const Anthropic = require('@anthropic-ai/sdk').default ?? require('@anthropic-ai/sdk');
const DIR = path.dirname(new URL(import.meta.url).pathname);

for (const line of fs.readFileSync(path.join(REPO, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*(ANTHROPIC_API_KEY|ANTHROPIC_WORKSPACE_ID)\s*=\s*"?([^"\n]*)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}
const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
const client = new Anthropic(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {});
const MODEL = 'claude-sonnet-5-5';
const THEME = fs.readFileSync(path.join(DIR, 'theme.txt'), 'utf8').trim();

const TOPICS = [
  { title: 'What is a cache and why does it make software faster?', term: 'cache', scope: 'Explain that a cache is a nearby temporary copy of data that was already fetched or computed, so software can reuse it instead of repeating slow work, and what trade-off comes from the copy going stale.' },
  { title: 'What happens when you call an API?', term: 'API', scope: "Explain that an API is a defined way for one piece of software to send a structured request to another and get a structured response back, so programs can use each other's features without knowing how they work inside." },
  { title: 'Why does RAG split documents into chunks before searching them?', term: 'chunking', scope: "Explain that documents are cut into small passages so search can return only the specific piece that answers a question, since whole documents are too large and too vague to fit into a model's prompt." },
  { title: 'What is DNS and how does a website name find its server?', term: 'DNS', scope: "Explain that DNS is the internet's lookup system that translates a human-readable domain name into the numeric address of the server hosting the site, so browsers know where to send their request." },
  { title: 'What is model routing, and why not use one AI for everything?', term: 'model routing', scope: 'Explain that model routing is a step that looks at each request and sends it to the smallest model able to handle it, so simple tasks stay cheap and fast while hard ones go to a more powerful model.' },
  { title: 'What is prompt injection, and why can it trick an AI?', term: 'prompt injection', scope: 'Explain that a language model reads instructions and untrusted content as the same stream of text, so hidden commands inside a document or web page can be mistaken for real instructions and hijack its behavior.' },
  { title: 'What is a context window?', term: 'context window', scope: 'Explain that a context window is the fixed amount of text a language model can read at once, so anything beyond it, like the start of a long chat, is no longer seen when the model writes its answer.' },
  { title: 'What is a webhook?', term: 'webhook', scope: "Explain that a webhook is a message one app sends automatically to another app's web address the moment an event happens, so the second app learns about it right away instead of asking over and over." },
];

const ANALOGY_SYSTEM = `You write the central analogy for a Helios educational "brain break" reel: a one-minute, 9:16 animated reel that teaches one computer-science, software, or AI concept to a broad audience of business owners, operators and curious professionals. The analogy is the reel's anchor: the reel opens on a moment inside it, plays it out step by step, names what each part stands for as it appears, and then walks a real example through the same steps. The theme brief below defines the audience. It is binding.

What to write: a moment from ordinary life that works the same way the concept works, so that a viewer who watches it understands the concept, recognizes themselves in it, and wants to see how it turns out.

What makes a great analogy. A viewer should think "I've been there" in the first second and "oh, so that's how it works" by the end. Four things make that happen, in this order of importance:
- Apt. It works for the same reason the concept works. The part that makes the concept click happens in the analogy too, for the same reason, and each part does the same job as the real part it stands for. A comparison that only looks alike, or matches one step, is not apt.
- Easy. The viewer understands it with no explanation: two to four parts, one situation, behavior everyone already knows. If it needs a sentence of setup, or a rule the viewer has to be told, it is too complicated.
- Lived. It is a moment the viewer has personally been in, more than once: at home, with food, running errands, on their phone, with family or friends, at work, shopping, travelling. A place they have only heard of, a job they don't do, a fantasy, history, a nature documentary or the inside of a machine is not lived.
- Something happens. Someone in it wants something, and something gets in the way; the mechanism is how it gets solved, or why it goes wrong. That small tension is what makes a viewer want to watch it play out.

Whose seat. Before you write, decide whose seat the viewer is in for this concept: the user (someone using it, who notices its effects: waiting, a wrong answer, something that just works), the builder (someone running or building with it, who pays for it, designs it, or gets burned by it), or pure curiosity (no stakes; the pull is "how does that even work?"). The analogy's main character sits in that seat.

How to work. First find the click: the one thing about this concept that, once seen, makes it make sense. Then list 12 moments from ordinary life where that same click happens, one line each. Then judge each against the four qualities above and develop the 5 best.

Your job in the system. You choose the comparison and map it onto the concept. Then a director writes the reel's story, every spoken line, the opening question and the payoff, and illustrators decide how each shot is drawn. Give them a strong comparison and a precise mapping. Do not write narration, shot plans, or drawing details.

HARD CONSTRAINTS. Every one is required.
1. Return JSON matching the schema: seat, click, exactly 12 brainstorm lines, and exactly 5 candidates. No other output.
2. The 5 candidates are different moments, never one reworded; they may share a setting only if the moments differ.
3. The click happens in every candidate, for the same reason it happens in the concept.
4. Every element maps: each stands for one real component and does that component's job; no element is left over, and no part the mechanism needs is missing. Never invent a rule the viewer would have to be told.
5. Lived: a moment our audience has personally been in. Never a profession they don't have, a fantasy, a historical or exotic setting, nature or the body as a system, or the inside of a machine.
6. Easy: at most 4 elements (a group of identical things counts as one, at most 4 members), understood with no setup, no contraption built to fit the concept. Each element is recognizable as a simple drawing at phone size.
7. Something happens: someone wants something, something gets in the way, and the mechanism resolves it or causes it.
8. Characters. When someone acts, they are drawn as a small cartoon character, never a person or a person's body part. Name each character by the role it plays ("the waiter", "the diner"); never call a character a "critter". actor: the role of the character who acts, in a few words, or "none" when objects carry the mechanism.
9. The analogy is never made of the concept's own material: no words or sentences when the concept is about language, no code when it is about code, no data rows when it is about data, no requests or messages when it is about messages. The real thing appears only in the reel's own worked example, later.
10. It can be shown, not only told, in a simple hand-drawn style.
11. hook: the moment of tension at its peak, readable in one second by a viewer with no context, no title and no narration.
12. steps: the process as 3 to 5 steps, in order. Each has analogy (what happens in the scene, one short line) and technical (the real step's name, 4 words or fewer).
13. Do not write narration, scripts, or scores.`;

const GAP_SYSTEM = `You write the curiosity gap for a Helios educational "brain break" reel: a one-minute, 9:16 animated reel that teaches one computer-science, software, or AI concept to a broad audience of business owners, operators and curious professionals. The reel opens on a short moment from its analogy; then a sound hit and a cut, and the narrator speaks your line, the reel's first spoken words about the real technology. The term's definition comes right after it, and the analogy comes back to answer your question. The theme brief below defines the audience. It is binding.

Your goal: the question a viewer in this seat would most want answered, asked about something they have seen, done, or paid for. A curiosity gap is never confusion: the viewer knows exactly what they're missing and wants it.

The seat. The analogy chose whose seat the viewer is in; write from that seat.
- User: something they notice when they use it. "A site you opened yesterday loads instantly today. What did your phone keep?"
- Builder: something that bites whoever runs it. "Your support bot read the whole manual and still quoted the wrong policy. How?"
- Curiosity: "Type a website's name and it opens in a blink, from anywhere. How does it know where to go?"
Write it as one moment, then the question. Say "you". Use plain words. The question asks about what the viewer sees or pays for, never about the system's insides: the mechanism is the answer, not the question. The line names, in real life, the same kind of problem the analogy's hook shows.

HARD CONSTRAINTS. Every one is required.
1. Return exactly 3 candidates as JSON matching the schema, each a different moment, all from the analogy's seat. No other output.
2. About the real technology, never the analogy: none of the analogy's elements, characters, places or actions.
3. True. Every fact, number and claim is accurate; never invent a statistic, a story or a quote.
4. End on the question, with nothing after it: no "stick around", "stay tuned", "here's why", "let's find out".
5. No term and no jargon: never say the term the reel defines, or any word a beginner would have to look up.
6. 10 to 24 words, at most two sentences.
7. The viewer's question: about something they see, do or pay for, never "why does the system…". The analogy's process answers it.
8. question: the line's question, word for word. seat: the seat. why_it_pulls: one line on why this viewer would want the answer.`;

const STEP = { type: 'object', properties: { analogy: { type: 'string' }, technical: { type: 'string' } }, required: ['analogy', 'technical'], additionalProperties: false };
const ELEMENT = { type: 'object', properties: { name: { type: 'string' }, stands_for: { type: 'string' } }, required: ['name', 'stands_for'], additionalProperties: false };
const CAND = {
  type: 'object',
  properties: {
    scene: { type: 'string', description: 'The moment, one line.' },
    elements: { type: 'array', items: ELEMENT },
    process: { type: 'string' },
    visual: { type: 'string' },
    actor: { type: 'string' },
    hook: { type: 'string' },
    steps: { type: 'array', items: STEP },
  },
  required: ['scene', 'elements', 'process', 'visual', 'actor', 'hook', 'steps'],
  additionalProperties: false,
};
const ANALOGY_SCHEMA = {
  type: 'object',
  properties: {
    seat: { type: 'string', enum: ['user', 'builder', 'curiosity'] },
    click: { type: 'string' },
    brainstorm: { type: 'array', items: { type: 'string' } },
    candidates: { type: 'array', items: CAND },
  },
  required: ['seat', 'click', 'brainstorm', 'candidates'],
  additionalProperties: false,
};
const GAP_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: { line: { type: 'string' }, question: { type: 'string' }, seat: { type: 'string' }, why_it_pulls: { type: 'string' } },
        required: ['line', 'question', 'seat', 'why_it_pulls'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
};

const system = (text) => [{ type: 'text', text: `${text}\n\n<theme_brief>\n${THEME}\n</theme_brief>`, cache_control: { type: 'ephemeral', ttl: '1h' } }];
// Sonnet 5.5 list price per MTok: input $3, output $15, cache write (1h) $6, cache read $0.30.
const usd = (u) => ((u.input_tokens ?? 0) * 3 + (u.output_tokens ?? 0) * 15 + (u.cache_creation_input_tokens ?? 0) * 6 + (u.cache_read_input_tokens ?? 0) * 0.3) / 1e6;
let spend = 0;

async function call(sys, user, schema, label) {
  const msg = await client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: system(sys),
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  }).finalMessage();
  spend += usd(msg.usage);
  if (msg.stop_reason !== 'end_turn') throw new Error(`${label}: stop_reason ${msg.stop_reason}`);
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

const out = fs.existsSync(path.join(DIR, 'out.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'out.json'), 'utf8')) : [];
const done = new Set(out.map((o) => o.topic.term));
for (const t of TOPICS) {
  if (done.has(t.term)) continue;
  if (spend > 2.0) { console.log('STOP: spend near ceiling', spend.toFixed(3)); break; }
  const a = await call(ANALOGY_SYSTEM, `Topic: ${t.title}\nLearning objective: ${t.scope}\n\nFind the click, list 12 moments, then write exactly 5 candidate analogies.`, ANALOGY_SCHEMA, 'analogy');
  const first = a.candidates[0];
  const gapUser = [
    `Topic: ${t.title}`, `Learning objective: ${t.scope}`, `Term (never say it): ${t.term}`, `Seat: ${a.seat}`, '',
    `The analogy (never use its world): ${first.scene}`,
    `Its hook: ${first.hook}`,
    `Its process: ${first.process}`,
    `Its steps: ${first.steps.map((s) => `${s.analogy} (${s.technical})`).join('; ')}`, '',
    'Write exactly 3 candidates.',
  ].join('\n');
  const g = await call(GAP_SYSTEM, gapUser, GAP_SCHEMA, 'gap');
  out.push({ topic: t, analogy: a, gap: g });
  console.log(`${t.term}: ${a.candidates.length} analogies, ${g.candidates.length} gaps, seat ${a.seat}, spend so far $${spend.toFixed(3)}`);
  fs.writeFileSync(path.join(DIR, 'out.json'), JSON.stringify(out, null, 1));
}
console.log('DONE spend $' + spend.toFixed(3));
