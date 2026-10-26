/**
 * AI Events This Week, the pure post builder (plan M5): hook and look draws, the bank's exact text, copy,
 * city order and skips, the CTAs, the caption and the title cleaner. Offline, no model, no network.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_EVENTS_FIXTURES, SAMPLE_MAX, SAMPLE_MIN, SAMPLE_WEEK, posterCityInput, sampleCityInput, sampleInput } from '@/fixtures/social/ai-events-posts';
import { BIG_GOING, CAPTION_LINK_LINE, CAPTION_MAX_CHARS, RANKED_LINK_LINE, buildCaption, buildRankedCaption, captionHashtags, topTrait, type TopTrait } from '@/lib/ai-events/caption';
import { HOOKS, HOOK_HISTORY, HOOK_KEYS, hookByKey, hookLines, pickHook } from '@/lib/ai-events/hooks';
import { LOOKS, LOOK_HISTORY, pickLook } from '@/lib/ai-events/looks';
import { COVER_CTA, MAX_RANKED, RANKED, spotlightRanks, buildAiEventsCityPost, buildAiEventsPost, rankedCoverLead, citySubline, eventIcon, eventMention, eventPlace, eventWhen, weekRangeLabel } from '@/lib/ai-events/post';
import { cleanEventTitle, clipText } from '@/lib/ai-events/title';
import type { AiEventsPostInput, PickedEvent } from '@/lib/ai-events/types';
import type { AeSlide, Post } from '@/lib/social/render/types';

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;

/** Every string an AI Events slide draws. */
function slideText(s: AeSlide): string[] {
  if (s.role === 'cover') return [s.lead, s.lit, s.week, s.cta, ...s.cities.map((c) => c.short)];
  if (s.role === 'city') {
    const p = s.pick;
    return [s.city, s.label, p.when, p.title, p.host ?? '', p.place ?? '', s.mentionsLabel, ...s.mentions.flatMap((m) => [m.day, m.title]), s.more, s.cta];
  }
  if (s.role === 'rank') {
    const p = s.pick;
    return [`#${s.rank}`, p.when, p.title, p.host ?? '', p.place ?? ''];
  }
  if (s.role === 'tease') return [s.lead, s.lit, s.rank, s.label, s.cta];
  return [s.eyebrow, s.lead, s.lit, s.site, s.line, s.cta, s.handle];
}
const ae = (post: Post, i: number) => post.slides[i]!.aiEvents!;

const event = (o: Partial<PickedEvent> & Pick<PickedEvent, 'title' | 'start' | 'metro'>): PickedEvent => ({
  id: o.title,
  end: null,
  timezone: null,
  organizer: null,
  venue: null,
  city: null,
  price: { free: true, minCents: 0, maxCents: 0, currency: 'USD' },
  access: 'open',
  soldOut: false,
  waitlist: false,
  going: null,
  rsvpUrl: 'https://example.com/e',
  ...o,
});

test('the hook bank holds the 8 approved lines, byte for byte', () => {
  const approved: Record<string, string> = {
    one_event: 'Your city has one AI event this week you shouldn’t skip.',
    everyones_story: 'The AI events you’ll see on everyone’s story next week.',
    rsvps_close: 'Where the AI crowd is going this week, before the RSVPs close.',
    dragging_friend: 'Send this to the friend you’re dragging to an AI event.',
    group_chat: 'The AI events your group chat should already be planning around.',
    find_your_city: 'Find your city. RSVP before it’s gone. →',
    week_planned: 'Your AI week, already planned. Swipe for your city.',
    best_this_week: 'Best AI networking events this week.',
  };
  assert.deepEqual(Object.fromEntries(HOOKS.map((h) => [h.key, h.text])), approved);
  assert.equal(HOOK_HISTORY, 4);
  assert.ok(Object.isFrozen(HOOKS) && HOOKS.every((h) => Object.isFrozen(h)));
  for (const h of HOOKS) {
    const { lead, lit } = hookLines(h);
    assert.ok(h.text.endsWith(h.lit), h.key);
    assert.equal(`${lead} ${lit}`, h.text, h.key);
    assert.ok(lead.length > 0 && lit.length > 0, h.key);
    assert.doesNotMatch(h.text, /!/);
    assert.doesNotMatch(h.text, EMOJI);
  }
  assert.equal(hookByKey('nope'), null);
});

test('pickHook never repeats one of the last 4 hooks and draws among the rest', () => {
  const recent = ['group_chat', 'one_event', 'find_your_city', 'week_planned', 'rsvps_close'];
  const free = HOOK_KEYS.filter((k) => !recent.slice(0, 4).includes(k));
  assert.deepEqual(free, ['everyones_story', 'rsvps_close', 'dragging_friend', 'best_this_week']);
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const k = pickHook(recent, { rand: () => i / 100 });
    assert.ok(free.includes(k), k);
    seen.add(k);
  }
  assert.deepEqual([...seen].sort(), [...free].sort(), 'every free hook can be drawn');
  assert.equal(pickHook(recent, { rand: () => 0 }), 'everyones_story');
  assert.equal(pickHook(recent, { rand: () => 0.9999 }), 'best_this_week');
  // The 5th most recent is free again.
  assert.ok(free.includes('rsvps_close'));
  // Unknown keys in the history block nothing.
  assert.ok(HOOK_KEYS.includes(pickHook(['x', 'y', 'z', 'w'], { rand: () => 0.5 })));
  // No history: anything; a longer window than the bank falls back to the one used longest ago.
  assert.ok(HOOK_KEYS.includes(pickHook(null)));
  assert.equal(pickHook([...HOOK_KEYS], { history: 8 }), HOOK_KEYS[7]);
});

test('pickLook never repeats one of the last 2 looks', () => {
  assert.deepEqual([...LOOKS], ['spotlight', 'glass', 'daylight', 'orb']);
  assert.equal(LOOK_HISTORY, 2);
  for (let i = 0; i < 50; i++) {
    const look = pickLook(['orb', 'spotlight', 'glass'], { rand: () => i / 50 });
    assert.ok(look === 'glass' || look === 'daylight', look);
  }
  assert.equal(pickLook(['orb', 'spotlight'], { rand: () => 0 }), 'glass');
  assert.equal(pickLook(['orb', 'spotlight'], { rand: () => 0.99 }), 'daylight');
  assert.equal(pickLook(['orb', 'glass', 'daylight', 'spotlight'], { history: 4 }), 'spotlight');
});

test('the post: cover, one slide per city with picks in Miami, Boston, NYC, SF order, then the CTA slide', () => {
  const shuffled = [...SAMPLE_MAX].reverse();
  const post = buildAiEventsPost({ ...sampleInput('orb', 'one_event'), cities: shuffled });
  assert.equal(post.format, 'carousel');
  assert.ok(post.slides.length <= 6);
  assert.deepEqual(post.slides.map((s) => s.layoutVariant), ['ae_orb_cover', 'ae_orb_city', 'ae_orb_city', 'ae_orb_city', 'ae_orb_city', 'ae_orb_cta']);
  assert.deepEqual(post.slides.map((s) => s.position), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(post.slides.slice(1, 5).map((s) => (s.aiEvents as Extract<AeSlide, { role: 'city' }>).city), ['Miami', 'Boston', 'New York', 'SF Bay Area']);
  const cover = ae(post, 0) as Extract<AeSlide, { role: 'cover' }>;
  assert.equal(cover.week, 'OCT 26–NOV 1');
  assert.equal(cover.cta, 'Free AI Events Calendar · Link in bio');
  assert.equal(`${cover.lead} ${cover.lit}`, hookByKey('one_event')!.text);
  assert.deepEqual(cover.cities.map((c) => c.short), ['Miami', 'Boston', 'NYC', 'SF']);
  for (const s of post.slides) assert.ok(s.altText.length > 0);
});

test('a city with no picks is skipped everywhere; extra picks past 3 count toward "+N more"', () => {
  const four = [0, 1, 2, 3].map((i) => event({ metro: 'nyc', title: `Night ${i}`, start: `2026-10-${27 + i}T22:00:00Z` }));
  const input: AiEventsPostInput = {
    ...SAMPLE_WEEK,
    hookKey: 'week_planned',
    look: 'glass',
    cities: [
      { metro: 'miami', picks: [], remainingCount: 9 },
      { metro: 'nyc', picks: [four[3]!, four[1]!, four[0]!, four[2]!], remainingCount: 5 },
    ],
  };
  const post = buildAiEventsPost(input);
  assert.equal(post.slides.length, 3);
  const cover = ae(post, 0) as Extract<AeSlide, { role: 'cover' }>;
  assert.deepEqual(cover.cities, [{ label: 'New York', short: 'NYC', picks: 3 }]);
  const city = ae(post, 1) as Extract<AeSlide, { role: 'city' }>;
  // The first by rank is the top pick, even when it is not the earliest; the next 2 by rank are the mentions, in time order.
  assert.equal(city.label, 'TOP PICK');
  assert.equal(city.pick.title, 'Night 3');
  assert.equal(city.pick.when, 'FRI · 6 PM');
  assert.equal(city.mentionsLabel, 'ALSO THIS WEEK');
  assert.deepEqual(city.mentions, [{ day: 'TUE', title: 'Night 0' }, { day: 'WED', title: 'Night 1' }]);
  assert.equal(city.more, '+6 more NYC events on our free calendar');
  assert.doesNotMatch(post.caption, /Miami/);
  assert.throws(() => buildAiEventsPost({ ...input, cities: [{ metro: 'boston', picks: [], remainingCount: 3 }] }), /at least one city/);
  assert.throws(() => buildAiEventsPost({ ...input, hookKey: 'nope' as never }), /no hook/);
  assert.throws(() => buildAiEventsPost({ ...input, look: 'neon' as never }), /no look/);
});

test('every slide but a rank slide points to the site: cover, city, tease and CTA slides say "Link in bio"', () => {
  for (const [id, post] of Object.entries(AI_EVENTS_FIXTURES)) {
    const roles = post.slides.map((s) => s.aiEvents!.role);
    assert.equal(roles[0], 'cover', id);
    assert.equal(roles[roles.length - 1], 'cta', id);
    assert.ok(post.slides.length <= 6, id);
    for (const s of post.slides) {
      const d = s.aiEvents!;
      const text = slideText(d).join(' ');
      assert.equal(text.match(/Link in bio/g)?.length ?? 0, d.role === 'rank' ? 0 : 1, `${id} slide ${s.position}: ${text}`);
      assert.equal(s.layoutVariant, `ae_${d.look}_${d.role}`);
    }
  }
  const max = buildAiEventsPost(sampleInput('spotlight', 'group_chat'));
  const boston = ae(max, 2) as Extract<AeSlide, { role: 'city' }>;
  assert.equal(`${boston.more} · ${boston.cta}`, '+27 more Boston events on our free calendar · Link in bio');
  const min = buildAiEventsPost(sampleInput('spotlight', 'group_chat', 'min'));
  const bostonMin = ae(min, 1) as Extract<AeSlide, { role: 'city' }>;
  assert.equal(`${bostonMin.more} · ${bostonMin.cta}`, 'Full calendar · Link in bio');
  const final = ae(max, max.slides.length - 1) as Extract<AeSlide, { role: 'cta' }>;
  assert.deepEqual(
    { eyebrow: final.eyebrow, headline: `${final.lead} ${final.lit}`, site: final.site, cta: final.cta, line: final.line },
    { eyebrow: 'FREE TOOL', headline: 'Free AI events calendar', site: 'heliosgroup.ai', cta: 'Link in bio', line: 'Every pick, every RSVP link, four cities, updated weekly.' },
  );
  assert.equal(COVER_CTA, 'Free AI Events Calendar · Link in bio');
});

test('no emoji and no exclamation marks anywhere on the slides or in the caption', () => {
  for (const [id, post] of Object.entries(AI_EVENTS_FIXTURES)) {
    for (const s of post.slides) {
      for (const t of slideText(s.aiEvents!)) {
        assert.doesNotMatch(t, EMOJI, `${id}: ${t}`);
        assert.doesNotMatch(t, /!/, `${id}: ${t}`);
      }
    }
    assert.doesNotMatch(post.caption, EMOJI, id);
    assert.doesNotMatch(post.caption, /!/, id);
  }
});

test('copy: week range, subline, day and time in the metro zone, mentions, places, icons', () => {
  assert.equal(weekRangeLabel('2026-10-26', '2026-11-01'), 'OCT 26–NOV 1');
  assert.equal(weekRangeLabel('2026-11-02', '2026-11-08'), 'NOV 2–8');
  assert.equal(citySubline(['Miami', 'Boston', 'NYC', 'SF']), 'In Miami, Boston, NYC & SF');
  assert.equal(citySubline(['Boston', 'SF']), 'In Boston & SF');
  assert.equal(citySubline(['Boston']), 'In Boston');

  // 22:30Z on Oct 27 is 6:30 PM in New York; 01:30Z on Oct 28 is 6:30 PM in San Francisco.
  assert.equal(eventWhen({ metro: 'boston', start: '2026-10-27T22:30:00Z', end: null }), 'TUE · 6:30 PM');
  assert.equal(eventWhen({ metro: 'sf', start: '2026-10-28T01:30:00Z', end: null }), 'TUE · 6:30 PM');
  assert.equal(eventWhen({ metro: 'nyc', start: '2026-10-28T23:00:00Z', end: '2026-10-29T02:00:00Z' }), 'WED · 7 PM');
  assert.equal(eventWhen({ metro: 'sf', start: '2026-10-28T16:00:00Z', end: '2026-10-30T00:30:00Z' }), 'WED–THU · 9 AM');

  const mention = { id: 'x', end: null, timezone: null, organizer: null, venue: null, city: null, price: { free: true, minCents: 0, maxCents: 0, currency: null }, access: 'open' as const, soldOut: false, waitlist: false, going: null, rsvpUrl: 'https://example.com' };
  assert.deepEqual(eventMention({ ...mention, metro: 'boston', title: '🚀 Demo Night | Boston', start: '2026-10-28T22:00:00Z' }), { day: 'WED', title: 'Demo Night' });
  assert.deepEqual(eventMention({ ...mention, metro: 'sf', title: 'Applied AI Summit', start: '2026-10-28T16:00:00Z', end: '2026-10-30T00:30:00Z' }), { day: 'WED–THU', title: 'Applied AI Summit' });

  assert.equal(eventPlace({ metro: 'boston', venue: 'Kendall Square Commons, 1 Main St', city: 'Cambridge' }), 'Kendall Square Commons, Cambridge');
  assert.equal(eventPlace({ metro: 'boston', venue: 'Fort Point Hall', city: 'Boston' }), 'Fort Point Hall');
  assert.equal(eventPlace({ metro: 'nyc', venue: null, city: 'Brooklyn' }), 'Brooklyn');
  assert.equal(eventPlace({ metro: 'nyc', venue: null, city: 'New York' }), undefined);

  assert.equal(eventIcon({ title: 'AI Hack Night' }), 'code');
  assert.equal(eventIcon({ title: 'Founders Dinner' }), 'utensils');
  assert.equal(eventIcon({ title: 'Demo Night' }), 'presentation');
  assert.equal(eventIcon({ title: 'Applied AI Summit' }), 'ticket');
  assert.equal(eventIcon({ title: 'Fireside Chat with a Founder' }), 'mic');
  assert.equal(eventIcon({ title: 'Generative AI Mixer' }), 'users');
  assert.equal(eventIcon({ title: 'Evaluation Night', signals: { format: 'workshop' } }), 'graduation');
  assert.equal(eventIcon({ title: 'Applied LLM Research Night' }), 'calendar');
});

test('the caption: hook, one line per pick, the link line, 4 to 6 hashtags, at most 2,200 characters', () => {
  const post = buildAiEventsPost(sampleInput('daylight', 'rsvps_close'));
  const parts = post.caption.split('\n\n');
  assert.equal(parts[0], hookByKey('rsvps_close')!.text);
  assert.equal(parts[2], CAPTION_LINK_LINE);
  assert.equal(CAPTION_LINK_LINE, 'All RSVP links and the full calendar: link in bio (heliosgroup.ai)');
  const lines = parts[1]!.split('\n');
  assert.equal(lines.length, 12);
  assert.equal(lines[0], 'Miami — Tue: Founders & Funders: Applied AI in Healthcare, Fintech and Real Estate (South Florida Applied AI Collective)');
  assert.match(lines[11]!, /^SF — Thu: AI Founders Dinner for Second-Time Founders Building in Applied AI \(Sand Hill Second Founders\)$/);
  assert.match(lines[9]!, /^SF — Wed–Thu: /);
  const tags = parts[3]!.split(' ');
  assert.ok(tags.length >= 4 && tags.length <= 6, parts[3]);
  assert.ok(tags.every((t) => /^#[A-Za-z]+$/.test(t)));
  assert.ok(post.caption.length <= CAPTION_MAX_CHARS);

  const min = buildAiEventsPost(sampleInput('daylight', 'find_your_city', 'min'));
  assert.match(min.caption, /\nBoston — Wed: AI Builders Breakfast\n/);
  assert.equal(captionHashtags([{ name: 'Boston', hashtag: '#BostonTech', events: [] }]).length, 4);

  // Far over the limit: event lines go from the end; the hook, link line and tags stay whole.
  const long = buildCaption({
    hook: 'Hook line.',
    cities: [{ name: 'Boston', hashtag: '#BostonTech', events: Array.from({ length: 60 }, (_, i) => ({ day: 'Tue', title: `An event title that runs long on purpose number ${i}`, organizer: 'A Long Organizer Name' })) }],
  });
  assert.ok(long.length <= CAPTION_MAX_CHARS, String(long.length));
  assert.ok(long.startsWith('Hook line.\n\nBoston — Tue: An event title that runs long on purpose number 0'));
  assert.ok(long.includes(CAPTION_LINK_LINE));
  assert.ok(long.endsWith('#AIEvents #AINetworking #BostonTech #StartupEvents'));
});

test('the title cleaner takes the clutter out of real-world listing titles', () => {
  const cases: Array<[string, string]> = [
    ['🚀 AI Builders Night | Boston | Oct 28', 'AI Builders Night'],
    ['Generative AI Mixer • NYC • 10/29/2026', 'Generative AI Mixer'],
    ['Oct 28: Founders & Funders Breakfast (Boston)', 'Founders & Funders Breakfast'],
    ['AI Tinkerers Boston - October 2026', 'AI Tinkerers Boston'],
    ['GENERATIVE AI HAPPY HOUR!!! 🍻', 'Generative AI Happy Hour'],
    ['  LLM   Ops   Meetup  ', 'LLM Ops Meetup'],
    ['[SF] Agents Hack Night', 'Agents Hack Night'],
    ['Demo Night @ San Francisco', 'Demo Night'],
    ['AI Breakfast @ CIC Cambridge', 'AI Breakfast'],
    ['AI x Healthcare Summit 2026 (In-Person) | Miami', 'AI x Healthcare Summit 2026'],
    ['Thursday, October 30th - AI Product Meetup', 'AI Product Meetup'],
    ['AI Meetup | Thu Oct 30, 6:30 PM', 'AI Meetup'],
    ['The AI Collective: Miami Chapter Launch 🌴🎉', 'The AI Collective: Miami Chapter Launch'],
    ['Data Driven NYC', 'Data Driven NYC'],
    ['ai builders breakfast', 'AI Builders Breakfast'],
    ['AI Demo Night (Boston) (Free)', 'AI Demo Night'],
    ['Boston AI Week: Opening Night', 'Boston AI Week: Opening Night'],
    ['10/28 AI Breakfast', 'AI Breakfast'],
    ['AI Breakfast Oct 28', 'AI Breakfast'],
    ['NYC | Fireside Chat with a Founder', 'Fireside Chat with a Founder'],
    ['AI & Robotics Meetup – Wed, Oct 29', 'AI & Robotics Meetup'],
    ['**Startup Pitch Night** ✨', 'Startup Pitch Night'],
    ['AI Tinkerers | Demo Night', 'AI Tinkerers: Demo Night'],
    ['AI Happy Hour | Hosted by The AI Collective', 'AI Happy Hour'],
    ['🇺🇸 AI Summit NYC 2026 ⭐️', 'AI Summit NYC 2026'],
    ['NEW YORK AI & ML MEETUP - MANHATTAN EDITION', 'New York AI & ML Meetup'],
    ['Boston', 'Boston'],
  ];
  for (const [raw, clean] of cases) assert.equal(cleanEventTitle(raw), clean, raw);
  assert.equal(clipText('Short', 10), 'Short');
  assert.equal(clipText('Founders and Funders Breakfast in the Seaport', 30), 'Founders and Funders…');
});

test('the sample fixtures cover every look at max and min copy', () => {
  assert.deepEqual(Object.keys(AI_EVENTS_FIXTURES).sort(), [
    'ae-daylight', 'ae-daylight-min', 'ae-glass', 'ae-glass-min', 'ae-orb', 'ae-orb-min',
    'ae-ranked-daylight', 'ae-ranked-daylight-min', 'ae-ranked-glass', 'ae-ranked-orb', 'ae-ranked-spotlight', 'ae-ranked-spotlight-min',
    'ae-spotlight', 'ae-spotlight-min',
  ]);
  for (const look of LOOKS) assert.ok(Object.values(AI_EVENTS_FIXTURES).some((p) => p.slides.some((x) => x.aiEvents?.role === 'tease' && x.aiEvents.look === look)), look);
  assert.equal(SAMPLE_MAX.length, 4);
  assert.ok(SAMPLE_MAX.every((c) => c.picks.length === 3));
  assert.equal(SAMPLE_MIN.length, 2);
  assert.ok(SAMPLE_MIN.every((c) => c.picks.length >= 1 && c.picks.length <= 2));
});

// ── Ranked city posts (AE-29) ───────────────────────────────────────────────

test('a ranked city post: cover, spotlights from #2 to the last gated event, the locked #1 tease, the closing slide', () => {
  const input = posterCityInput('spotlight', 'miami', 'poster');
  const post = buildAiEventsCityPost(input);
  const expected = spotlightRanks(input.picks.length);
  assert.deepEqual(post.slides.map((x) => x.aiEvents!.role), ['cover', ...expected.map(() => 'rank'), 'tease', 'cta']);
  const cover = ae(post, 0);
  assert.ok(cover.role === 'cover');
  assert.equal(cover.lead, rankedCoverLead(input.totalCount, 'Miami'));
  assert.equal(`${cover.lead} ${cover.lit}`, `${input.totalCount} AI Networking Events in Miami this week. Ranked.`);
  assert.equal(rankedCoverLead(1, 'Boston'), '1 AI Networking Event in Boston this week.');
  const ranks = post.slides.slice(1, 1 + expected.length).map((x) => x.aiEvents!);
  assert.deepEqual(ranks.map((r) => (r.role === 'rank' ? r.rank : null)), expected);
  // Each spotlight is its rank's event, and the panorama numeral names the next spotlight.
  ranks.forEach((r, i) => {
    assert.ok(r.role === 'rank');
    assert.equal(r.layout, 'poster');
    assert.deepEqual(r.treat, ['panorama']);
    assert.equal(r.next, expected[i + 1]);
    assert.ok(cleanEventTitle(input.picks[r.rank - 1]!.title).startsWith(r.pick.title.replace(/…$/, '')), r.pick.title);
    assert.equal(r.pick.image, input.picks[r.rank - 1]!.image);
  });
  const tease = ae(post, 1 + expected.length);
  assert.ok(tease.role === 'tease');
  assert.deepEqual([tease.lead, tease.lit, tease.rank, tease.label, tease.cta], [RANKED.tease.lead, RANKED.tease.lit, '#1', "MIAMI'S #1 THIS WEEK", 'Revealed on our free calendar · Link in bio']);
  const final = ae(post, 2 + expected.length);
  assert.ok(final.role === 'cta');
  assert.equal(final.line, 'Every ranked Miami event, every RSVP link, updated weekly.');
  assert.equal(final.site, 'heliosgroup.ai');
});

test('the #1 is held back: its title is nowhere on the slides, in the alt text or the caption', () => {
  for (const metro of ['miami', 'boston'] as const) {
    const input = sampleCityInput('glass', metro);
    const post = buildAiEventsCityPost(input);
    const top = cleanEventTitle(input.picks[0]!.title);
    const everything = [...post.slides.flatMap((x) => [...slideText(x.aiEvents!), x.altText ?? '']), post.caption].join('\n');
    assert.ok(!everything.includes(top), `${metro}: ${top}`);
    assert.ok(!everything.includes(input.picks[0]!.organizer ?? '@@'), metro);
  }
});

test('spotlights start at #2 and span the gated list (AE-33)', () => {
  assert.deepEqual(spotlightRanks(2), [2]);
  assert.deepEqual(spotlightRanks(3), [2, 3]);
  assert.deepEqual(spotlightRanks(4), [2, 3, 4]);
  assert.deepEqual(spotlightRanks(5), [2, 4, 5]);
  assert.deepEqual(spotlightRanks(8), [2, 4, 6, 8]);
  assert.deepEqual(spotlightRanks(14), [2, 6, 10, 14]);
  for (let n = 2; n <= MAX_RANKED; n++) {
    const r = spotlightRanks(n);
    assert.equal(r[0], 2);
    assert.equal(r[r.length - 1], n);
    assert.ok(r.length >= 1 && r.length <= 4);
    if (n >= 6) assert.equal(r.length, 4, `${n}: ${r.join('-')}`);
    else if (n >= 4) assert.equal(r.length, 3, `${n}: ${r.join('-')}`);
    assert.deepEqual(r, [...r].sort((a, b) => a - b));
    assert.ok(r.every((rank, i) => i === 0 || rank > r[i - 1]!));
  }
});

test('a ranked post needs #1 and at least one spotlight; ranks past MAX_RANKED are dropped; N is never under the picks', () => {
  const max = sampleCityInput('orb', 'boston');
  assert.throws(() => buildAiEventsCityPost({ ...max, picks: max.picks.slice(0, 1) }), /at least 2 picks/);
  const min = buildAiEventsCityPost(sampleCityInput('orb', 'boston', 'min'));
  assert.deepEqual(min.slides.map((x) => x.aiEvents!.role), ['cover', 'rank', 'tease', 'cta']);
  const four = buildAiEventsCityPost(max);
  assert.deepEqual(four.slides.flatMap((x) => (x.aiEvents!.role === 'rank' ? [x.aiEvents!.rank] : [])), [2, 3, 4]);
  const deep = posterCityInput('orb', 'boston', 'poster');
  const extra = buildAiEventsCityPost({ ...deep, picks: [...deep.picks, ...deep.picks, ...deep.picks] });
  const shown = extra.slides.flatMap((x) => (x.aiEvents!.role === 'rank' ? [x.aiEvents!.rank] : []));
  assert.equal(shown.length, 4);
  assert.equal(shown[0], 2);
  assert.equal(shown[shown.length - 1], MAX_RANKED);
  assert.ok(shown.every((r) => r <= MAX_RANKED));
  const low = buildAiEventsCityPost({ ...max, totalCount: 1 });
  const cover = ae(low, 0);
  assert.ok(cover.role === 'cover' && cover.lead.startsWith(`${max.picks.length} AI Networking Events`));
  assert.throws(() => buildAiEventsCityPost({ ...max, look: 'neon' as never }), /no look/);
});

test('the ranked caption: the city total, what #1 is and its day, the link line, the city tags', () => {
  const input = posterCityInput('daylight', 'boston', 'poster');
  const post = buildAiEventsCityPost(input);
  const parts = post.caption.split('\n\n');
  assert.equal(parts.length, 3);
  assert.match(parts[0]!, new RegExp(`^We ranked the ${input.totalCount} AI networking events happening in Boston this week\\. #1 `));
  assert.equal(parts[1], RANKED_LINK_LINE);
  assert.match(parts[2]!, /#BostonTech/);
  assert.ok(post.caption.length <= CAPTION_MAX_CHARS);
  assert.ok(!post.caption.includes('—') && !post.caption.includes('!'));
});

test('the ranked caption names #1 by selling out, then free, then big, else only the day', () => {
  const base = { soldOut: false, waitlist: false, going: null, signals: null, price: { free: false, minCents: 2500, maxCents: 2500, currency: 'USD' } };
  assert.equal(topTrait({ ...base, soldOut: true, price: { ...base.price, free: true } }), 'selling out');
  assert.equal(topTrait({ ...base, waitlist: true }), 'selling out');
  assert.equal(topTrait({ ...base, price: { ...base.price, free: true }, signals: { format: 'conference' } }), 'free');
  assert.equal(topTrait({ ...base, signals: { format: 'conference' } }), 'big');
  assert.equal(topTrait({ ...base, going: BIG_GOING }), 'big');
  assert.equal(topTrait({ ...base, going: BIG_GOING - 1 }), null);

  const make = (trait: TopTrait | null, days: string) => buildRankedCaption({ total: 14, city: 'Miami', hashtag: '#MiamiTech', top: { trait, days } });
  assert.equal(
    make('free', 'Thu').split('\n\n')[0],
    "We ranked the 14 AI networking events happening in Miami this week. #1 is free and it's on Thursday.",
  );
  assert.match(make('selling out', 'Tue'), /#1 is selling out and it's on Tuesday\./);
  assert.match(make('big', 'Tue–Thu'), /#1 is big and it runs Tuesday to Thursday\./);
  assert.match(make(null, 'Sat'), /this week\. #1 is on Saturday\.\n\n/);
  assert.match(make(null, 'Tue–Thu'), /#1 runs Tuesday to Thursday\./);
});
