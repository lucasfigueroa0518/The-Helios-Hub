# Last Few Days: video slides (plan, not started)

Status: research draft, 2026-11-09. Blocked on the ingestion / photo-finder workflow running in
another session. Do not build until that lands; the seams below are chosen so this plugs in after it.

## Goal

Where a story has a good clip, its Last Few Days slide becomes a video: the same headline and body on
top, the clip playing in the media box. Where no clip passes, the slide stays a photo. A missing video
never blocks or delays a post.

## How the accounts in the examples do it

Most of them are not clever scrapers. The clip is almost always the **first-party launch video**: the
company's or founder's launch post on X, the official YouTube upload, or the MP4 on the product or blog
page. Their "launch views 6.7M" chips show they rank by the launch post's engagement. The clip shows
the thing doing the thing, so the headline's claim is proven on screen. We can automate that same
logic: find the official clip first, check it shows the claim, and trim to the best few seconds.

## What we already have

- `lib/reel-ai-drama/harvest/live.ts` `ytDlpFrames`: yt-dlp + ffmpeg download of an official video
  section (frames only today). `sources/video.ts` wraps it as a harvest source.
- `lib/reel-ai-drama/harvest/look.ts`: watermark / TV-bug check on frames (MD-16), reusable on
  sampled video frames.
- `lib/lfd/lead-image.ts` + `lib/social/reporter/read-page.ts`: the article page is already read for
  its lead image. This is the main seam for video embeds (and the part the other workflow is touching).
- `lib/lfd/vision.ts` `checkSlide`: Haiku 5.5 check of the rendered slide. Can run on a poster frame.
- `lib/explainers/publish/meta.ts`, `lib/reels/music/meta.ts`: Instagram video upload with
  container polling. `lib/social/overnight/meta.ts` builds carousels from images only today.
- Social VM bootstrap installs ffmpeg. yt-dlp and Deno (which yt-dlp now needs for YouTube) are not
  installed.

## Pipeline

### 1. Find candidates (free, no Claude calls)

In order of trust; stop collecting at about 4 candidates per story:

1. **Embeds in the story's own article.** `<video>` / `<source>` MP4s, `og:video`, YouTube and Vimeo
   iframes, and embedded X posts (`blockquote.twitter-tweet` status URLs). The outlet already chose
   them, so relevance is high. Extend the page read; no extra fetch.
2. **The first-party page.** The company blog post or product page the article links to: the same
   embed extraction. Launch demos usually live here.
3. **The official YouTube channel.** YouTube Data API v3 (free key): the channel's recent uploads at
   1 quota unit, filtered to `publishedAt` within 3 days of the story. `videos.list` gives view counts.
4. **X posts, only when an article already embeds them.** No X search, no X API. yt-dlp downloads
   public X videos from a status URL. The unofficial syndication endpoint gives view counts but can
   break at any time, so treat it as a bonus signal.

Each candidate records its source, owner (first-party or not), publish date, duration, resolution and
view count when known.

### 2. Gate (code, free)

- Duration 3 s or more. Short side 720 px or more. Published no earlier than 7 days before the story.
- No watermark or TV-network bug on 3 sampled frames (reuse `look.ts`).
- Not already used in the last 7 days (extend `social.used_photos` to clips).
- Rights rule (see question 1).

### 3. Pick the segment (code, free)

ffmpeg scene detection plus a motion score per second. Skip the first logo and title cards and any
end card. Choose a window of 6 to 15 s with the most motion and no full-screen text card. Keep the
original speed. Credit line: "Video: <owner>" in the existing credit spot.

### 4. Judge the best clip (one cheap vision call per candidate)

Build a contact sheet (3×3 frames from the chosen window) and send it with the slide's headline and
body to Haiku 5.5: "Does this show what the headline claims, in action? Score 0–10 and give a reason."
Rank by vision score, then first-party, then views, then resolution. Below 7 means photo fallback.

Cost: about $0.003 per contact sheet, so 3 candidates × 7 stories is about $0.06 per post. Prompt
caching on the static system and tool prefix. Tests stub this call (Rule 1).

### 5. Render the slide (ffmpeg, on the social VM)

Render the slide as now, with the media box left empty, to a 1080×1350 PNG. Then ffmpeg overlays the
clip scaled and cropped into the box at the template's coordinates, with rounded corners from a mask.
Output: H.264 High, yuv420p, 30 fps, AAC, at most 15 s, about 8 MB. A poster JPEG (the best frame) goes
to the review UI and to `checkSlide`.

### 6. Publish

Carousel children become `media_type=VIDEO`, `video_url`, `is_carousel_item=true` for video slides.
Poll each child container until `FINISHED` before the CAROUSEL parent is created (reuse the reels
polling). All children share the first slide's 4:5 ratio, and the cover stays an image. The Social Hub
preview needs a `<video>` for those slides.

## Where it plugs in

- New `lib/lfd/video/` (find, gate, segment, judge, compose), called from `run.ts` after photos are
  found, as an upgrade per slide: the photo is always found first, so a failure on any video step
  leaves a finished photo slide.
- The embed extraction goes into the shared page reader. **This is the overlap with the other
  workflow; build it after that lands.**
- `lib/social/overnight/meta.ts`: video children. `lib/lfd/publish.ts`: record clips.
- VM: add yt-dlp and Deno to `remote-bootstrap-social.sh`; redeploy with `deploy-social-worker.sh`.

## Build order

0. **Hit-rate spike (no Claude calls, about an hour).** Run the candidate finder and gates over the
   stories of the last 3 Last Few Days posts and count how many have a passing first-party clip. If
   fewer than about 1 in 3 stories do, rethink sources before building more.
1. Finder, gates, segment picker and compose, in review only (no publish). Photo fallback.
2. Carousel video publish and the hub preview.
3. Later, if wanted: the same clips as Morning Download Story frames (Stories accept video).

## Hit-rate spike (2026-11-09, no Claude calls)

Script and data in the session scratchpad, not the repo. It ran on the 18 stories of the last 3 posts
(Nov 1, 3, 6), using article embeds, first-party pages linked from the article and a YouTube search
(8 results, official channel only), gated on length, resolution, date and source.

- **Ours: 1 of 18.** The only clip was a 20-minute Game Maker's Toolkit essay embedded by The Verge
  (Claude Code game clones). 17 of 18 articles were read fine, so this is not a fetch problem. The
  linked first-party pages had no video, and every embedded X post was text-only. The stories were
  policy, funding, lawsuit and terms news, which have no demo footage.
- **Control: 8 launches from the reference posts, YouTube search only.** Official clips exist for
  about 5 of 8 (Genie 4, ChatGPT Images, GPT-6.1 Terra, Google Playground, and Grok under the "Grok"
  channel). Mistral and Simulon launched on X only. The method works for launch stories.
- **Conclusion:** the bottleneck is story mix, not finding. Video slides will be rare unless story
  selection gives weight to stories that have an official clip.

- **Builder lane (central-intake run, 2026-11-09): 6 of 24 builder stories scoring 0.60+, and 4 of
  the 13 at or above the 0.65 bar.** Clips: OpenAI customer-story videos (Kuken, Merge, CodeRabbit,
  "A thousand fewer paths to root", all Vimeo embeds), Simon Willison's mystery-beep post (4 short
  screen recordings) and Genie 4 (17 official demo MP4s on the DeepMind page). The HN, GitHub and
  Google News stories had none. The finder reached 4 of them only through a Google News redirect
  it could not read, so their real hit rate is unknown.
- **Conclusion, revised:** builder and launch stories are where the clips are. Builder stories hit
  about 1 in 3, against 1 in 18 for the policy and business mix.

Build fixes the spike surfaced:
1. Gate on the story's event date (from the source), not the post date. Most control misses were
   only a wrong date.
2. Map org names to official channels (xAI → "Grok", Google → DeepMind / Labs / Developers):
   Wikidata P2397 channel IDs, plus a small hand alias list.
3. Grab frames by downloading a short section with yt-dlp. ffmpeg reading the googlevideo stream
   URL directly gets 403.
4. Long videos (talks, essays) need the segment picker to find the relevant part (chapters or
   transcript), not just motion.
5. Vimeo embeds (OpenAI's customer stories) need the privacy hash from the embed URL
   (`player.vimeo.com/video/<id>?h=<hash>`, often inside page JSON) plus the page as referer.
   Without the hash they return 404 or 403.
6. Probe direct MP4s with ffprobe and cut their frames with ffmpeg; yt-dlp gives no duration for
   them. Such clips have no upload date, so trust them by page (first-party page = recent enough).
7. Ignore site-wide videos on first-party pages: openai.com pages carry the same ~19 YouTube links
   in their chrome. Take only embeds inside the article body.
8. Resolve Google News redirect URLs to the publisher URL before reading the page. The intake
   should store the resolved URL.
9. X-first launches are reachable only when an article embeds the post (decision 3). That is
   where many demo clips live; revisit if hit rates stay low.

## Decisions (Lucas, 2026-11-09)

1. **Rights.** "No watermark = fair game" extends to video: official company and founder clips plus
   clips the article embeds, always credited. No TV news footage. Creators' clips only when the
   article embeds them.
2. **Sound.** Keep the clip's own audio (demos and voice), lowered. Mute clips that are mostly music.
3. **X.** Only X posts the article already embeds, via yt-dlp. No X API and no X scraping.
4. **Media priority: meme > video > photo.** A video is the second-best thing a slide can show,
   behind only a meme. The finder must work hard for a clip that scores 7 or more before falling
   back to a photo: exhaust every source tier and widen the candidate count (not stop at 4) when
   the first candidates miss. The cover stays an image.
