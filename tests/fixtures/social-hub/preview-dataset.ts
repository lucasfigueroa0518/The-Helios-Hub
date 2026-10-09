/**
 * Fixture dataset for the development-only preview at /social/preview
 * (DECISIONS_LOG D10) and for screen tests. Deterministic rows for every
 * vertical, run through the real adapters and the real cost model, so the
 * preview draws exactly what live data would draw. No database, no calls.
 */
import { buildDataset, type HubDataset } from '@/lib/social-hub/dataset';
import type { CarouselsRead } from '@/lib/social-hub/queries/carousels';
import type { CostReads } from '@/lib/social-hub/queries/costs';
import type { ExplainersRead } from '@/lib/social-hub/queries/explainers';
import type { InsightRow, ReelsRead } from '@/lib/social-hub/queries/reels';
import type { StoriesRead } from '@/lib/social-hub/queries/stories';
import { addDays, nyDayStart } from '@/lib/social-hub/time';

/** The preview's "now": Thursday 2026-10-08, 3:00 PM New York. */
export const FIXTURE_NOW = new Date('2026-10-08T19:00:00Z');
const TODAY = '2026-10-08';
const FIRST = '2026-08-24';
const LAST = '2026-10-21';

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const rand = lcg(20261008);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

let counter = 0;
function uuid(prefix: number): string {
  counter += 1;
  return `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

/** An instant `minutes` after New York midnight of `day`. */
function at(day: string, minutes: number): string {
  return new Date(nyDayStart(day).getTime() + minutes * 60_000).toISOString();
}

function days(): string[] {
  const out: string[] = [];
  for (let d = FIRST; d <= LAST; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Lifetime totals growing over the first days after posting. */
function insightHistory(mediaId: string, day: string, base: number, reel: boolean): InsightRow[] {
  const rows: InsightRow[] = [];
  const settle = [0.35, 0.7, 0.85, 0.93, 1];
  for (let i = 0; i < settle.length; i++) {
    const d = addDays(day, i);
    if (d > TODAY) break;
    const f = settle[i]!;
    const views = Math.round(base * f);
    rows.push({
      media_id: mediaId,
      ny_date: d,
      views,
      reach: Math.round(views * 0.78),
      likes: Math.round(views * 0.045),
      comments: Math.round(views * 0.006),
      saved: Math.round(views * 0.018),
      shares: Math.round(views * 0.022),
      reposts: reel ? Math.round(views * 0.002) : null,
      total_interactions: Math.round(views * 0.09),
      ...(reel
        ? { avg_watch_time_ms: 3500 + Math.round(rand() * 6000), total_watch_time_ms: views * 5200, skip_rate: 0.18 + rand() * 0.35 }
        : {}),
    });
  }
  return rows;
}

const HEADLINES = [
  'OpenAI ships a model that writes its own tests',
  'Nvidia’s new chip doubles inference per watt',
  'The EU’s AI Act enforcement starts this week',
  'Anthropic’s Haiku 5.5 undercuts rivals on price',
  'A startup trained a model on 1/100th the data',
  'Google folds Gemini into every Workspace app',
  'Meta open-sources a 400B parameter model',
  'Apple quietly buys an on-device AI startup',
  'Microsoft says AI agents will run Windows support',
  'Robotics startup raises $1B for humanoids',
  'Crusoe raises $3.9B for AI data centers',
  'Newsom pushes an AI kill switch for California',
];
const TOPICS = [
  'What is a webhook?', 'What is a context window?', 'Why databases need primary keys', 'What does “running locally” mean?',
  'What is a Git branch?', 'How vector search finds similar ideas', 'Authentication vs. authorization', 'Why AI agents need tools',
  'What actually happens when you call an API?', 'What is a cron job?', 'What is an embedding?', 'Frontend vs. backend',
];
const SOURCES = ['https://www.theverge.com/ai/1', 'https://techcrunch.com/ai/2', 'https://arstechnica.com/ai/3', 'https://www.anthropic.com/news/4', 'https://openai.com/index/5', 'https://www.bloomberg.com/tech/6'];

function reels(): { read: ReelsRead; cost: Pick<CostReads, 'reelEvents' | 'reelKling' | 'reelWeights' | 'reelProduced'> } {
  const read: ReelsRead = { attempts: [], schedules: [], insights: [], ideas: [], sources: [], requireApproval: true };
  const cost = { reelEvents: [] as CostReads['reelEvents'], reelKling: [] as CostReads['reelKling'], reelWeights: [] as CostReads['reelWeights'], reelProduced: [] as CostReads['reelProduced'] };
  const slots: Array<[string, number]> = [['morning', 9 * 60 + 20], ['midday', 11 * 60 + 50], ['evening', 19 * 60 + 15]];
  for (const day of days()) {
    const runId = uuid(1);
    const slateId = uuid(1);
    const count = rand() < 0.4 ? 3 : 2;
    cost.reelEvents.push(
      { id: uuid(1), run_id: runId, component: 'scoring-pass1', usd: (0.4 + rand() * 0.3).toFixed(6), ny_date: day },
      { id: uuid(1), run_id: runId, component: 'grouping', usd: (0.1 + rand() * 0.1).toFixed(6), ny_date: day },
      { id: uuid(1), run_id: runId, component: 'copy-caption', usd: (0.15 + rand() * 0.1).toFixed(6), ny_date: day },
      { id: uuid(1), run_id: runId, component: 'reel-scene', usd: (0.05 + rand() * 0.05).toFixed(6), ny_date: day },
    );
    for (let i = 0; i < count; i++) {
      const [slot, minute] = slots[i]!;
      const ideaId = uuid(1);
      const videoId = uuid(1);
      const headline = pick(HEADLINES);
      const framework = pick(['curiosity', 'arousal', 'identity']);
      const bucket = pick(['ball_knowledge', 'the_number', 'the_saga', 'the_warning', 'the_callout']);
      const publishAt = at(day, minute + int(-20, 20));
      const base = {
        chosen_framework: framework, chosen_bucket: bucket, net: (1 + rand() * 4).toFixed(2),
        on_screen_copy: headline.toUpperCase(), headline,
      };
      cost.reelWeights.push({ run_id: runId, post_idea_id: ideaId, slate_id: slateId, usd: (0.1 + rand() * 0.2).toFixed(6) });
      cost.reelProduced.push({ run_id: runId, run_day: day, post_idea_id: ideaId, slate_id: slateId });
      cost.reelKling.push({ id: videoId, post_idea_id: ideaId, slate_id: slateId, usd: '0.560000', ny_date: day });
      read.sources.push({ post_idea_id: ideaId, url: pick(SOURCES), headline });
      const future = publishAt > FIXTURE_NOW.toISOString();
      const roll = rand();
      if (future || (day === TODAY && i === count - 1)) {
        read.schedules.push({
          schedule_id: uuid(1), post_idea_id: ideaId, video_job_id: videoId, ny_date: day, slot, publish_at: publishAt,
          status: 'scheduled', source: 'auto', error: null, approved_at: rand() < 0.5 ? at(day, 6 * 60) : null, created_at: at(day, 60),
          video_storage_path: `videos/${videoId}.mp4`, video_finished_at: at(day, 120), video_slate_id: slateId, ...base,
        });
        continue;
      }
      if (roll < 0.06) {
        read.schedules.push({
          schedule_id: uuid(1), post_idea_id: ideaId, video_job_id: videoId, ny_date: day, slot, publish_at: publishAt,
          status: 'cancelled', source: 'auto', error: 'not approved before its slot', approved_at: null, created_at: at(day, 60),
          video_storage_path: `videos/${videoId}.mp4`, video_finished_at: at(day, 120), video_slate_id: slateId, ...base,
        });
        continue;
      }
      const attemptId = uuid(1);
      const failed = roll < 0.09;
      const mediaId = `rm-${attemptId.slice(-6)}`;
      read.attempts.push({
        attempt_id: attemptId, status: failed ? 'failed' : 'published', trigger: rand() < 0.1 ? 'force' : 'auto',
        media_id: failed ? null : mediaId, post_idea_id: ideaId, video_job_id: videoId, requested_at: publishAt,
        finished_at: at(day, minute + 3), permalink: failed ? null : `https://www.instagram.com/reel/${mediaId}`,
        error: failed ? 'Container never reached FINISHED' : null, caption: `${headline}. Full story in the caption.`,
        song_title: pick(['Midnight City', 'Glue', 'Nights']), song_artist: pick(['M83', 'Bicep', 'Frank Ocean']),
        graduation_strategy: 'MANUAL', motion_prompt: `Hook: ${pick(['glitch', 'vhs', 'invert', 'none'])}\nHook SFX: ${pick(['whoosh', 'none'])}`,
        video_storage_path: `videos/${videoId}.mp4`, video_finished_at: at(day, 120), video_slate_id: slateId,
        visual_render: { colorProfile: pick(['noir', 'paper', 'orange']) }, audio_type: pick(['music', 'original_sound']),
        genre: pick(['Electronic', 'Hip-Hop', 'Pop']), schedule_id: uuid(1), schedule_slot: slot, schedule_publish_at: publishAt,
        approved_at: at(day, 6 * 60), blockbuster: rand() < 0.2 ? 1 : 0, origin: rand() < 0.75 ? 'timely' : 'carryover',
        full_story_below: rand() < 0.5, ...base,
      });
      if (!failed) read.insights.push(...insightHistory(mediaId, day, int(800, 9000), true));
    }
  }
  for (let i = 0; i < 18; i++) {
    read.ideas.push({
      post_idea_id: uuid(1), headline: pick(HEADLINES), net: (4.5 - i * 0.2).toFixed(2), rank: i + 1, selected: i < 3,
      origin: i % 4 === 0 ? 'carryover' : 'timely', scored_at: at(TODAY, 330), published: false, scheduled: i < 2, has_video: i < 3,
      video_count: i < 3 ? 1 : 0, last_video_at: i < 3 ? at(TODAY, 120) : null,
    });
  }
  return { read, cost };
}

function explainers(): { read: ExplainersRead; cost: Pick<CostReads, 'explainerEvents' | 'explainerRendered'> } {
  const read: ExplainersRead = { jobs: [], attempts: [], schedules: [], insights: [], topics: [], requireApproval: true };
  const cost = { explainerEvents: [] as CostReads['explainerEvents'], explainerRendered: [] as CostReads['explainerRendered'] };
  const topicIds = TOPICS.map(() => uuid(2));
  TOPICS.forEach((title, i) => {
    read.topics.push({
      topic_id: topicIds[i]!, title, scope: 'One idea, one analogy, one example.', status: i < 8 ? 'rendered' : 'pool',
      origin: pick(['generated', 'seeded', 'manual']), weighted_score: (88 - i * 3.1).toFixed(1), created_at: at('2026-08-20', 600),
      ok_jobs: i < 8 ? 1 : 0, last_render_at: i < 8 ? at('2026-09-20', 400) : null, published: i < 6, scheduled: i === 6,
      job_id: null, job_status: null, job_stage: null, job_error: null, job_requested_at: null, job_started_at: null,
    });
  });
  let topic = 0;
  for (const day of days()) {
    if (day > addDays(TODAY, 6) || rand() < 0.35) continue;
    const t = topic++ % TOPICS.length;
    const jobId = uuid(2);
    const spend = (2.4 + rand() * 1.6).toFixed(6);
    const renderDay = addDays(day, -1);
    read.jobs.push({
      job_id: jobId, topic_id: topicIds[t]!, status: 'ok', trigger: 'auto', mode: 'production', spend_usd: spend,
      requested_at: at(renderDay, 360), finished_at: at(renderDay, 420), error: null, title: TOPICS[t]!, scope: 'One idea, one analogy, one example.',
      source_url: pick(SOURCES), origin: pick(['generated', 'seeded']), audience_fit: (2 + rand() * 2).toFixed(3),
      teachability_45s: (2 + rand() * 2).toFixed(3), analogy_potential: (2 + rand() * 2).toFixed(3), visual_potential: (2 + rand() * 2).toFixed(3),
      accuracy_under_simplification: (2 + rand() * 2).toFixed(3), hook_strength: (2 + rand() * 2).toFixed(3), weighted_score: (60 + rand() * 35).toFixed(1),
      verdict: 'approved', tags: rand() < 0.6 ? [pick(['hook', 'pacing', 'visuals', 'voice'])] : [], feedback_at: at(renderDay, 700),
      video_artifact_id: uuid(2), video_location: 'bucket',
    });
    cost.explainerEvents.push({ id: uuid(2), job_id: jobId, component: 'render', usd: spend, ny_date: renderDay });
    cost.explainerEvents.push({ id: uuid(2), job_id: null, component: 'idea-generator', usd: (0.2 + rand() * 0.2).toFixed(6), ny_date: renderDay });
    cost.explainerRendered.push({ job_id: jobId, ny_date: renderDay, spend_usd: spend });
    const publishAt = at(day, 15 * 60 + int(5, 85));
    if (publishAt > FIXTURE_NOW.toISOString()) {
      read.schedules.push({ schedule_id: uuid(2), job_id: jobId, ny_date: day, slot: 'afternoon', publish_at: publishAt, status: 'scheduled', source: 'auto', error: null });
      continue;
    }
    const attemptId = uuid(2);
    const mediaId = `em-${attemptId.slice(-6)}`;
    read.attempts.push({
      attempt_id: attemptId, job_id: jobId, status: 'published', trigger: 'auto', requested_at: publishAt, finished_at: publishAt,
      media_id: mediaId, permalink: `https://www.instagram.com/reel/${mediaId}`, error: null, caption: TOPICS[t]!,
      schedule_id: uuid(2), slot: 'afternoon', publish_at: publishAt,
    });
    read.insights.push(...insightHistory(mediaId, day, int(1500, 14000), true));
  }
  // Two renders waiting: one not reviewed yet, one approved without a slot.
  for (const [k, verdict] of [[9, null], [10, 'approved']] as const) {
    const jobId = uuid(2);
    read.jobs.push({
      ...read.jobs[0]!, job_id: jobId, topic_id: topicIds[k]!, title: TOPICS[k]!, requested_at: at(TODAY, 360), finished_at: at(TODAY, 420),
      verdict, tags: [], feedback_at: verdict ? at(TODAY, 500) : null, video_artifact_id: uuid(2),
    });
    cost.explainerEvents.push({ id: uuid(2), job_id: jobId, component: 'render', usd: '2.900000', ny_date: TODAY });
    cost.explainerRendered.push({ job_id: jobId, ny_date: TODAY, spend_usd: '2.900000' });
  }
  return { read, cost };
}

function carousels(): { read: CarouselsRead; cost: Pick<CostReads, 'carouselRuns'> } {
  const read: CarouselsRead = { posts: [], attempts: [], schedules: [], insights: [], ideas: [], requireApproval: true };
  const cost = { carouselRuns: [] as CostReads['carouselRuns'] };
  for (const day of days()) {
    if (day > addDays(TODAY, 1)) continue;
    const runId = uuid(3);
    const storyId = `story-${day}`;
    const postId = uuid(3);
    const title = pick(HEADLINES);
    const createdAt = at(day, 3 * 60 + 40);
    const slides = Array.from({ length: int(8, 11) }, (_, i) => ({
      layoutVariant: i === 0 ? 'cover' : i === 1 ? 'story_beat' : pick(['story_beat', 'data_block', 'quote']),
      headline: [{ text: i === 0 ? title : pick(['The number that matters', 'Why now', 'What changes', 'The catch']), role: 'narrative' }],
      body: i === 0 ? undefined : [{ text: 'One plain sentence that carries the story forward.', role: 'narrative' }],
    }));
    read.posts.push({
      post_id: postId, run_id: runId, slug: `post-${day}`, story_id: storyId, title, status: 'review', caption: `${title}.\nThe details inside.`,
      created_at: createdAt, published_at: null, render: { source: pick(['TechCrunch', 'The Verge', 'Bloomberg']), sourceUrl: pick(SOURCES), slides },
      slide_count: slides.length, has_slide_objects: false, hook_pass: rand() < 0.7, photo_sources: [pick(['wikimedia', 'logo', 'og'])],
      checks: rand() < 0.4 ? { warnings: [{ detail: 'Slide 4 text sits close to the edge' }], fixes: ['Em dash removed'] } : { warnings: [], fixes: [] },
    });
    const storyCost = 0.5 + rand() * 0.4;
    const total = (storyCost + 0.25).toFixed(6);
    cost.carouselRuns.push({ id: runId, kind: 'daily', total_usd: total, claude_usd: (Number(total) - 0.02).toFixed(6), jev_usd: '0.02', ny_date: day, posts: [{ storyId, costUsd: Number(storyCost.toFixed(6)) }] });
    const publishAt = at(day, 7 * 60 + int(5, 70));
    if (day === TODAY) continue; // today's carousel waits in review (Content ready)
    if (day > TODAY) {
      read.schedules.push({ schedule_id: uuid(3), post_id: postId, ny_date: day, slot: 'morning', publish_at: publishAt, status: 'scheduled', source: 'auto', error: null, approved_at: null });
      continue;
    }
    if (rand() < 0.25) {
      read.schedules.push({ schedule_id: uuid(3), post_id: postId, ny_date: day, slot: 'morning', publish_at: publishAt, status: 'cancelled', source: 'auto', error: 'not approved before its slot', approved_at: null });
      continue;
    }
    const attemptId = uuid(3);
    const mediaId = `cm-${attemptId.slice(-6)}`;
    read.posts[read.posts.length - 1]!.status = 'published';
    read.attempts.push({
      attempt_id: attemptId, post_id: postId, status: 'published', trigger: 'approve', requested_at: publishAt, finished_at: publishAt,
      media_id: mediaId, permalink: `https://www.instagram.com/p/${mediaId}`, error: null, schedule_id: uuid(3), slot: 'morning',
      publish_at: publishAt, approved_at: at(day, 6 * 60 + 30),
    });
    read.insights.push(...insightHistory(mediaId, day, int(600, 6000), false));
  }
  read.ideas = HEADLINES.slice(0, 8).map((title, i) => ({
    story_id: `idea-${i}`, title, url: pick(SOURCES), score: (2.6 - i * 0.15).toFixed(2), outlet_count: int(1, 20),
    run_started_at: at(TODAY, 180), post_count: i === 0 ? 1 : 0, last_post_at: i === 0 ? at(TODAY, 220) : null, published: false, scheduled: false,
  }));
  return { read, cost };
}

function svgFrame(backdrop: string, label: string): string {
  const fill = { black: '#111111', white: '#fafafa', orange: '#ff5e1a', green: '#138510' }[backdrop] ?? '#111111';
  const ink = backdrop === 'white' ? '#171717' : '#ffffff';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="270" height="480" viewBox="0 0 270 480"><rect width="270" height="480" fill="${fill}"/><text x="24" y="250" font-family="Helvetica,Arial" font-size="22" font-weight="700" fill="${ink}">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function stories(): { read: StoriesRead; cost: Pick<CostReads, 'storyEvents' | 'storySets'> } {
  const read: StoriesRead = { sets: [], frames: [], insights: [], candidates: [] };
  const cost = { storyEvents: [] as CostReads['storyEvents'], storySets: [] as CostReads['storySets'] };
  const series = (day: string): string[] => {
    const w = new Date(`${day}T12:00:00Z`).getUTCDay();
    return ['morning_download', ...(w === 1 || w === 4 ? ['guess_the_number'] : []), ...(w === 2 || w === 6 ? ['free_vs_paid'] : [])];
  };
  for (const day of days()) {
    if (day > addDays(TODAY, 1)) continue;
    for (const s of series(day)) {
      const setId = uuid(4);
      const frames = s === 'morning_download' ? 5 : 4;
      const publishAt = at(day, 8 * 60 + 30 + int(0, 80));
      const past = publishAt <= FIXTURE_NOW.toISOString();
      const status = day > TODAY ? 'ready' : past ? (rand() < 0.08 ? 'skipped' : 'published') : 'approved';
      const headline = pick(HEADLINES);
      read.sets.push({
        set_id: setId, series: s, ny_date: day, status, trigger: 'auto', style: pick(['polished', 'homemade']),
        payload: s === 'morning_download' ? { stories: [{ key: 'k', headline, url: pick(SOURCES) }] } : s === 'guess_the_number' ? { question: 'How many GPUs did it take?' } : { pair: { free: 'Ollama', paid: 'ChatGPT Plus' } },
        publish_at: status === 'skipped' ? null : publishAt, flagged: rand() < 0.1, error: null, spend_usd: '0.140000',
        approved_at: status === 'published' || status === 'approved' ? at(day, 7 * 60) : null, published_at: status === 'published' ? publishAt : null,
        built_at: at(day, 4 * 60 + 20), created_at: at(day, 4 * 60), feedback_verdict: null, feedback_tags: null,
        chosen_origins: [pick(['reels', 'carousel', 'catalog', 'github'])],
      });
      cost.storySets.push({ set_id: setId, ny_date: day, spend_usd: '0.140000' });
      cost.storyEvents.push({ id: uuid(4), set_id: setId, component: 'writer', usd: '0.140000', ny_date: day });
      let reach = int(300, 1600);
      for (let seq = 1; seq <= frames; seq++) {
        const frameId = uuid(4);
        const backdrop = pick(['black', 'white', 'orange', 'green']);
        read.frames.push({ frame_id: frameId, set_id: setId, seq, role: seq === 1 ? 'opener' : seq === frames ? 'closer' : 'story', template: null, backdrop, storage_path: `sets/${setId}/${seq}.jpg`, flagged: false, ig_media_id: status === 'published' ? `sm-${frameId.slice(-6)}` : null, published_at: status === 'published' ? publishAt : null });
        if (status === 'published') {
          const exits = Math.round(reach * (0.06 + rand() * 0.08));
          read.insights.push({ frame_id: frameId, captured_at: at(day, 22 * 60), final: true, reach, views: Math.round(reach * 1.08), replies: int(0, 4), shares: int(0, 6), follows: int(0, 3), profile_visits: int(0, 9), total_interactions: int(1, 12), taps_forward: Math.round(reach * 0.3), taps_back: int(0, 20), exits, swipe_forward: int(0, 15) });
          reach = Math.max(0, reach - exits - int(5, 40));
        }
      }
    }
    cost.storyEvents.push({ id: uuid(4), set_id: null, component: 'sources', usd: '0.030000', ny_date: day });
  }
  read.candidates = HEADLINES.slice(0, 5).map((title, i) => ({ candidate_id: uuid(4), set_id: read.sets[read.sets.length - 1]!.set_id, series: 'morning_download', ny_date: addDays(TODAY, 1), origin: pick(['reels', 'carousel', 'catalog']), ref: `ref-${i}`, payload: { headline: title }, score: (0.9 - i * 0.07).toFixed(3), created_at: at(TODAY, 250) }));
  return { read, cost };
}

/** Swap fixture media for inline images so the preview never asks a session route for a file. */
function offlineMedia(dataset: HubDataset): HubDataset {
  const posts = dataset.posts.map((post) => {
    if (post.media.kind === 'video') return { ...post, media: { ...post.media, src: null } };
    if (post.media.kind === 'frames') {
      const backdrops = ['black', 'orange', 'white', 'green'];
      return { ...post, media: { kind: 'frames' as const, frames: post.media.frames.map((f, i) => ({ ...f, src: svgFrame(backdrops[i % 4]!, f.label) })) } };
    }
    return post;
  });
  return { ...dataset, posts };
}

let cached: HubDataset | null = null;

export function previewDataset(): HubDataset {
  if (cached) return cached;
  counter = 0;
  const r = reels();
  const e = explainers();
  const c = carousels();
  const s = stories();
  const costs: CostReads = { ...r.cost, ...e.cost, ...c.cost, ...s.cost };
  cached = offlineMedia(buildDataset({ reels: r.read, explainers: e.read, carousels: c.read, stories: s.read }, costs, FIXTURE_NOW, {
    text: 'The Instagram account has 62 of 100 posts left in its 24-hour quota.',
    at: '2026-10-08T15:10:00Z',
  }));
  return cached;
}

/** The same dataset with account rows, as the `social_hub` tables will hold them after Phase 2. */
export function previewDatasetWithAccount(): HubDataset {
  const base = previewDataset();
  const days = [];
  for (let d = '2026-09-01'; d <= TODAY; d = addDays(d, 1)) {
    const reach = 2000 + Math.round(rand() * 3000);
    days.push({
      ny_date: d, reach, reach_followers: Math.round(reach * 0.32), reach_non_followers: Math.round(reach * 0.68),
      views: reach * 3, accounts_engaged: Math.round(reach * 0.08), total_interactions: Math.round(reach * 0.12),
      profile_links_taps: int(2, 30), follows: int(5, 40), unfollows: int(0, 12), follower_count: 4200 + days.length * 9,
    });
  }
  const demo = (breakdown: string, keys: string[]) => keys.map((key, i) => ({ ny_date: TODAY, metric: 'follower_demographics', timeframe: 'this_month', breakdown, key, value: 1000 / (i + 1) }));
  const online = [];
  for (let d = addDays(TODAY, -29); d <= TODAY; d = addDays(d, 1)) {
    for (let hour = 0; hour < 24; hour++) online.push({ ny_date: d, hour, value: Math.round(200 + 300 * Math.sin(((hour - 6) / 24) * Math.PI) ** 2 + rand() * 40) });
  }
  return {
    ...base,
    account: {
      present: true,
      days,
      demographics: [...demo('age', ['25-34', '35-44', '18-24', '45-54', '55-64']), ...demo('gender', ['M', 'F', 'U']), ...demo('country', ['US', 'GB', 'CA', 'IN', 'DE']), ...demo('city', ['New York, New York', 'Los Angeles, California', 'London, England'])],
      online,
      lastRefresh: '2026-10-08T09:45:00Z',
    },
  };
}
