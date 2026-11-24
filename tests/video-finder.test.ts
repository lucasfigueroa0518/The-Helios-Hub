/**
 * Video finder (lab, 2026-11-23): embed extraction and the frame → verdict → window → tier rules.
 * Offline: no network, no Jev, no Claude.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyVideoUrl, extractEmbeds } from '@/lib/video-finder/embeds';
import { clipTier, judgeFrames, pickWindow, type FrameAnswers } from '@/lib/video-finder/grade';
import { frameTimes } from '@/lib/video-finder/media';
import { choosePostsWithVideo, type VideoVerdict } from '@/lib/video-finder/promote';
import { coverage, cropExpr, decideVideoFit, shotsFrom, type Box } from '@/lib/video-finder/vertical';

const F = (o: Partial<FrameAnswers> = {}): FrameAnswers => ({ news: 0.1, commentary: 0.1, card: 0.1, raw: 0.9, speaker: 0.1, specific: 0.9, ...o });
const OFF = F({ specific: 0.1 });
const NEWS = F({ news: 0.9, raw: 0.2 });

test('classifyVideoUrl normalises YouTube, Vimeo (keeps hash), X and files', () => {
  assert.equal(classifyVideoUrl('https://www.youtube.com/embed/abcdefghijk?rel=0')?.url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(classifyVideoUrl('https://youtu.be/abcdefghijk')?.kind, 'youtube');
  assert.equal(classifyVideoUrl('https://player.vimeo.com/video/123?h=9f3a&title=0')?.url, 'https://player.vimeo.com/video/123?h=9f3a');
  assert.equal(classifyVideoUrl('https://twitter.com/acme/status/42?s=20')?.url, 'https://x.com/acme/status/42');
  assert.equal(classifyVideoUrl('https://cdn.example.com/a/clip.mp4?x=1')?.kind, 'file');
  assert.equal(classifyVideoUrl('https://example.com/story'), null);
});

test('extractEmbeds reads the article body, og:video and X blockquotes, de-duplicated', () => {
  const html = `<html><head><meta property="og:video" content="/v/hero.mp4"></head><body>
    <nav><iframe src="https://www.youtube.com/embed/zzzzzzzzzzz"></iframe></nav>
    <article><p>text</p>
      <video src="/v/hero.mp4"></video>
      <iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>
      <blockquote class="twitter-tweet"><p>hi</p><a href="https://twitter.com/acme/status/42">Nov 1</a></blockquote>
      <a href="https://youtu.be/abcdefghijk">same video</a>
    </article></body></html>`;
  const got = extractEmbeds(html, 'https://news.example.com/story');
  assert.deepEqual(got.map((e) => e.kind), ['file', 'youtube', 'x']);
  assert.equal(got[0]!.url, 'https://news.example.com/v/hero.mp4');
  assert.ok(!got.some((e) => e.url.includes('zzzz')), 'site chrome outside <article> is skipped');
});

test('judgeFrames finds the longest on-subject run; report frames are never in it', () => {
  const pkg = judgeFrames([NEWS, NEWS, F(), F(), F(), F(), F(), F()]);
  assert.deepEqual(pkg.run, [2, 7], 'raw footage inside a news package is still usable');
  assert.equal(pkg.reports, 2);
  assert.ok(judgeFrames([NEWS, NEWS, NEWS, NEWS]).reject);
  const v = judgeFrames([OFF, F(), OFF, F(), F(), F(), OFF, NEWS]);
  assert.equal(v.reject, null);
  assert.deepEqual(v.run, [3, 5]);
  assert.equal(v.onSubject, 4);
  assert.ok(judgeFrames([OFF, OFF, OFF, OFF]).reject);
});

test('captioned real footage is footage; a matched title lowers the subject bar', () => {
  const CAPTIONED = F({ news: 0.9, raw: 0.9 });
  assert.equal(judgeFrames([CAPTIONED, CAPTIONED, CAPTIONED, F()]).reject, null);
  const TALK = F({ speaker: 0.9 });
  assert.deepEqual(judgeFrames([TALK, TALK, F(), F()]).run, [2, 3], 'talking heads are not footage');
  assert.ok(judgeFrames([TALK, TALK, TALK, TALK]).reject);
  const weak = F({ specific: 0.35 });
  assert.ok(judgeFrames([weak, weak, weak, weak]).reject);
  assert.deepEqual(judgeFrames([weak, weak, weak, weak], 0.3).run, [0, 3]);
});

test('pickWindow centres a 5–10 s clip on the run, inside the video', () => {
  const times = frameTimes(0, 80, 8); // 5, 15, … 75
  assert.deepEqual(pickWindow(times, [3, 5], 80), { start: 40, len: 10 });
  assert.deepEqual(pickWindow(frameTimes(0, 4, 8), [0, 7], 4), { start: 0, len: 4 });
  const w = pickWindow(times, [7, 7], 80);
  assert.ok(w.start + w.len <= 80 && w.len >= 5);
});

test('clipTier judges the trimmed clip: golden needs every check frame clean and on-subject', () => {
  const v = judgeFrames([OFF, F(), F(), OFF, OFF, OFF, OFF, OFF]);
  assert.equal(clipTier(v, [F(), F(), F()]), 'golden', 'a short run is enough when the clip itself is clean');
  assert.equal(clipTier(v, [F(), OFF, F()]), 'good');
  assert.equal(clipTier(v, [F(), NEWS, F()]), 'good', 'one borderline frame: good, not golden');
  assert.equal(clipTier(v, [NEWS, NEWS, F()]), 'none');
  assert.equal(clipTier(v, [F(), OFF, OFF]), 'none');
  assert.equal(clipTier(v, [F(), F(), null]), 'none', 'needs all three check frames graded');
  assert.equal(clipTier(judgeFrames([OFF, OFF, OFF, OFF]), [F(), F(), F()]), 'none');
});

test('shotsFrom merges flashes and samples long shots twice', () => {
  const s = shotsFrom([2, 2.2, 6], 10);
  assert.deepEqual(s.map((x) => [x.start, x.end]), [[0, 2.2], [2.2, 6], [6, 10]]);
  assert.equal(s[1]!.samples.length, 2);
  assert.equal(s[0]!.samples.length, 1);
  assert.deepEqual(shotsFrom([], 4).map((x) => [x.start, x.end]), [[0, 4]]);
});

test('decideVideoFit: crop only when every shot shows at least half its subject', () => {
  const W = 1280, H = 720; // 9:16 window = 31.6% of the width
  const two = shotsFrom([5], 10);
  const narrow = (c: number): Box => ({ left: c - 0.1, right: c + 0.1 });
  const crop = decideVideoFit(W, H, two, [[narrow(0.3)], [narrow(0.7)]]);
  assert.equal(crop.mode, 'crop');
  assert.ok(crop.mode === 'crop' && crop.shots[0]!.left! < crop.shots[1]!.left!, 'each shot gets its own window');
  const wide: Box = { left: 0.05, right: 0.95 }; // window shows ~35% of it
  const blur = decideVideoFit(W, H, two, [[narrow(0.5)], [wide]]);
  assert.equal(blur.mode, 'blur', 'one uncroppable shot blurs the whole clip');
  assert.equal(decideVideoFit(W, H, two, [[narrow(0.5)], [null]]).mode, 'blur', 'no subject found means blur');
  const half: Box = { left: 0.2, right: 0.8 }; // 0.316 / 0.6 = 53% shown
  assert.equal(decideVideoFit(W, H, shotsFrom([], 4), [[half]]).mode, 'crop');
  assert.equal(decideVideoFit(720, 1280, two, [[], []]).mode, 'vertical');
});

test('coverage and cropExpr', () => {
  assert.ok(Math.abs(coverage({ left: 0.2, right: 0.4 }, 0.3, 0.3) - 0.5) < 1e-9);
  const fit = decideVideoFit(1280, 720, shotsFrom([5], 10), [[{ left: 0.1, right: 0.3 }], [{ left: 0.7, right: 0.9 }]]);
  assert.match(cropExpr(fit, 1280), /^if\(lt\(t\\,5\)\\,\d+\\,\d+\)$/);
});

test('choosePostsWithVideo: golden clips in the top 8 promote; good clips do not; cap 5', () => {
  const S = (id: string, top = true) => ({ id, duplicate_of: null, top_tier: top, crowds: null });
  const ranked = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((id, i) => S(id, i < 2));
  const v = (m: Record<string, VideoVerdict>) => (s: { id: string }) => m[s.id] ?? 'none';
  const posts = choosePostsWithVideo(ranked, ['a', 'b'], v({ f: 'golden', g: 'good', i: 'golden' }));
  assert.deepEqual(posts.map((p) => p.id), ['a', 'b', 'f'], 'rank 9 is outside the top 8; good does not promote');
  assert.deepEqual(posts.find((p) => p.id === 'f'), { id: 'f', media: 'video', promoted: true });
  assert.equal(posts.find((p) => p.id === 'a')!.media, 'photo');
  const full = choosePostsWithVideo(ranked, ['a', 'b', 'c', 'd', 'e'], v({ h: 'golden', b: 'golden' }));
  assert.deepEqual(full.map((p) => p.id), ['a', 'b', 'c', 'd', 'h'], 'golden takes a slot from the lowest photo pick');
  assert.equal(full.find((p) => p.id === 'b')!.media, 'video');
  const dup = [S('a'), { ...S('x'), duplicate_of: 'a' }, S('b')];
  assert.deepEqual(choosePostsWithVideo(dup, ['a'], v({ x: 'golden' })).map((p) => p.id), ['a'], 'duplicates never post');
});
