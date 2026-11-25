# MD + LFD Revisions — living plan (Bald-Eagle, started 2026-11-22)

Branch: `revisions/md-lfd`. Stage: 1 Align.

## Trello card (Morning Download Revisions)
1. Story selection dedup (stuff recently reported)
2. Story selection quality
3. Headline and body writing quality
4. Photo selection quality

## Lucas's qualms (his words), mapped in flow order

| Part | Lucas said | Today |
|---|---|---|
| Source | "Both should absolutely be using the central intake." | MD reads intake (with fallback); LFD reads reels.* + social.runs directly |
| Ranking | "shouldn't be loss-averse. It should be looking for the most interesting stories. Stuff that the viewer would think is cool." | MD final rank asks "most annoyed to have missed"; LFD orders slides by Jev `lfd-lead@1` |
| Repeats | "only a MASSIVE development should be allowed." | MD lets a run story back for any `new_event` ≥ DEVELOPMENT_BAR; LFD never repeats its own; no cross-check between MD and LFD |
| Prompts | "Check the prompts for example pollution and contradicting instructions." | Not audited yet |
| Architecture | "Dependencies should be centralized. LFD shouldn't depend on MD. They should both depend on a central News Ranker." | LFD imports scores/bars from `lib/stories/build/morning-download.ts` |

## Decisions
- D1 (2026-11-22): News Ranker owns intake read, scoring, "most interesting" order and ONE shared memory of what we said. MD/LFD own only count, format, writing, photos. ("yes")
- D2: LFD may recap MD's stories; neither repeats its OWN stories without a massive development. ("yes")
- D3: Writing and photo quality → second round. ("Leave that for a second round")
- D4: Picking/ranking logic is "the most important lever". Build a lab to see which stories score highest under different Jev logic choices; "I believe the current logic is weak".

- D5: Lab ground truth = Lucas tags ~60 recent intake stories; variants scored against his tags. Not only "cool": "it's also about 'valuable' or 'need to know/affects our audience'." Same applies to every variant tried (question sets, weights, 1–10 score, Sonnet rank wording).
- D6: Lab is local (`/news-ranker/lab`), read-only on intake, $1 total cap on live calls. Live calls run from Lucas's clicks OR from the agent when Lucas asks it to ("you (agent) should also be able to trigger stuff within the lab if I ask you to").

- D7: Tagging = two independent switches per story, Cool and Need-to-know; lab reports each separately. ("sure")
- D8: Audience is broad: "General public is affected by tech/AI news as well in many ways." AI-at-work users are one part, not the whole. (Cross-content-type audience docs: planning/Memes/AUDIENCE_SITUATIONS.md, Field Notes, AI Trivia plans.)
- D9: Cool/valuable mix not fixed up front; lab tries mixes, Lucas picks from results; MD and LFD may get different mixes. ("yes")

- D10: Eligibility gate loosened "big time": "This isn't a relevant way to filter stories." Gate fails only what is clearly not news.
- D11: Massive development = Jev question, bar calibrated from Lucas-tagged real repeats. ("Yes")
- D12: Flow approved. Anything decided that doesn't depend on lab grading builds WHILE Lucas grades. Contract: CONTRACT.md.
- D13: Grading set = 80 stories, "OPTIMIZE the selection for our end goal… should tell you as much as possible about what kinds of stories are good." Built as information strata (lib/news-ranker/lab/freeze.ts): top 20% (today's picks), major-only 15%, builder-only 15%, wide coverage 12.5%, niche 12.5%, today's rejects 25%; ≤3 headlines per name, ≤8 per source; shown shuffled, never in score order.
- D15: "Need" is renamed **Value**: "things that people actually would find valuable." The next Need/Value question is written around value to people, not urgency. The lab now shows Value (the stored field is still `needToKnow`).
- D16 (2026-11-23): Media ladder, one media item per story. The best media the story has wins. MD: golden video, then photo, then good video (only when no photo is usable), otherwise the story drops. LFD: golden video, then a meme that clears the 92% gate, then photo, otherwise the story drops (Lucas, 2026-11-24: "LFD: Golden video, then a meme that clears the 92% gate, then photo"). LFD keeps its one-meme-story scan. (MD order: Lucas picked the recommendations.)
- D17: Media boosts only inside the rank window the editorial order already allows (MD's top 8; LFD's existing scan depth). A golden video posts its story ahead of photo-only stories in that window. A good video never promotes, it only saves a story that has no photo. Photos get no boost. Memes keep the current meme-story scan.
- D18: Media decides which stories get in; editorial rank decides their order. A promoted video story sits where its rank puts it.
- D19: LFD uses video too. When a story has both a golden video and a meme that clears the gate, the video wins; the meme guarantee fills another slot. A meme that clears the gate beats the story's photo (D16).
- D16–D19 build (2026-11-24, local, uncommitted; Lucas: "wire it all up", full production):
  - Ladder + boost: `lib/news-ranker/media-ladder.ts` (mdMedia, lfdMedia, promoteGolden, keepWithMedia), tests/media-ladder.test.ts.
  - Finder in production form: `lib/video-finder/find.ts` (the lab's v12 logic, clients injected, spend cap per finder). The lab script stays as it is.
  - Clip in the photo band: `lib/video-finder/band.ts` (crop when every shot shows ≥50% of its subject in the band's shape, else blur-fit; Jev boxes; no upscaling), composited between the frame's under / matte / over layers (`layers()` in lib/stories/render/render.ts).
  - MD: `buildMorningDownload` checks the editorial top 8 plus every pick (3 at a time, $0.50 cap), promotes golden stories, applies the ladder, and drops stories with no media unless the day falls under 2. The render stage posts a video frame as an MP4, falling back to the still on any failure. Wiring: lib/stories/video.ts and scripts/stories_worker.ts. It is ON only where yt-dlp, ffmpeg, SERPER_API_KEY and TYPESAFE_API_KEY exist. Tests: tests/stories-md-video.test.ts.
  - VM: scripts/gcp/deploy-social-worker.sh installs ffmpeg plus yt-dlp in its own venv (Node as its JS runtime). Not deployed. The VM's datacenter IP will meet YouTube's bot wall sooner; the finder backs off and never evades it.
- Video finder evidence (lab, 2026-11-23): 24/35 stories with a real clip (86% of those with any b-roll), about $0.02 per story. Notes: side-session video-finder.md; page https://claude.ai/artifact/FhxAqv4FBtX1LAuN9Trb8s
- Correction (2026-11-22): LFD already reads the central intake in prod (`intake.settings.consumers.lfd = "intake"`) but mirrors the legacy reels/carousel lanes; the work is to replace those lanes with the ranker, not to switch sources.

## Flow (Stage 5, approved)
```
central intake (stored stories + stored Jev scores)
      │
NEWS RANKER (lib/news-ranker/)
  1 candidates   intake stories in the format's window
  2 memory       drop what this format already ran unless MASSIVE development
  3 score        Jev: Cool score + Need-to-know score (+ eligibility gate: real event, not speculation)
  4 mix          score = w·cool + (1−w)·valuable   (w per format)
  5 final order  Sonnet side-by-side: "most interesting / most worth knowing" (not loss-averse)
      │                                   │
  MORNING DOWNLOAD (2–5, daily)      LAST FEW DAYS (≤?, Tue/Fri)
  write → ground → photos            write → ground → photos
```
Lab (/news-ranker/lab) runs steps 1–5 on recent intake days with swappable variants and scores each against Lucas's tags.

## Diagnosis of today's ranking logic (Stage 2 input)
1. major-news@3 asks *is this eligible, important news* (happened, news_kind, blockbuster, global, political, not speculative). None of its questions asks whether it's interesting or cool.
2. story-builder@2 is closer (pushes_limits, general_interest) but punishes big-company launches outright.
3. All yes/no: many stories saturate the same score → ties, order decided by noise.
4. Two lanes compared by margin over different bars: different rulers, one queue.
5. Final Sonnet rank is loss-averse ("most annoyed to have missed").

## Open questions
See latest conversation turn.
- D16 (2026-11-22): Morning Download posting.
  - Order: B R8 shortlists each day; Opus 5.5 at low effort reranks, using the logic in `scripts/news-ranker-rerank.ts`. Lucas: "This reranker worked."
  - Depth: 2–5 stories a day ("5. On a bad day, two stories").
  - Before the walk, merge duplicates and resolve crowding: group crowding stories and keep the strongest of each group ("when a crowding story comes up, the walk should skip it"). A group is one running story, company or product, or government action ("one step is good").
  - The walk goes down the ranked list and stops at the first story that is not top tier ("Once I reach a bad story, I stop").
- D17 (2026-11-22): Photo check before the walk, for the top 7 stories left after cleanup. Only those 7 can post.
  - The walk skips a top-tier story without a good photo. It is not counted as posted, so it may compete again on a later day.
  - A missing photo never pulls in a story below the bar.
  - If the day still has fewer than 2: fill with the best checked stories that have a good photo, then "it just uses whatever photo for stories it can."
  - Judging a good photo is a later lab; it is stubbed as `PhotoVerdict` in `choosePosts`.
- D18 (2026-11-22): What makes a good photo (rules for the photo lab).
  - A good photo shows the story's own specific subject, clearly, at phone size: no stock or generic AI imagery, the right product, person and version, no watermark, and no headline baked into the image.
  - The ideal photo depends on the kind of story:
    - an object: shown in action
    - a creation on a screen: the output itself
    - a person: that person
    - a discovery: what was found
    - government or safety news: the thing, the people or the place at issue
  - Tiers: good (the specific subject), usable (related but not specific, such as a file photo or an official product shot), none.
  - Lucas:
    - "real only": never an AI-generated image.
    - A good recent photo of a powerful figure counts as good ("yes that's enough").
    - "NO LOGOS": a logo is never good and never usable; it counts as none.
- D19 (2026-11-23): Photo grading split.
  - Jev grades every candidate on logo, overlay, specific subject, related and clarity. The AI-made question is not asked of Jev: its answers did not separate real from AI pictures (PHOTO-TEST.md).
  - Haiku then checks only each story's picked photo, and removes it only when it is blatantly AI-made ("LENIENT. Only get rid of something if it is blatantly AI"). On a fail, the next good photo for that story moves up.
  - The prompt is `REAL_CHECK_SYSTEM` in `scripts/photo-vision-test.ts`.
  - Production pads very wide images, wider than about 3.7 times their height, before sending them to Jev.
- D20 (2026-11-23): Vertical fit for the Morning Download story (1080×1920). Lucas: "Yes, use Jev".
  - Lucas's ask: "some horizontal photos can be cropped for vertical use (IG story). Others can't… if it's a photo that shouldn't be squeezed into a vertical frame, it can be positioned in the middle with a copy of it scaled up and blurred behind it".
  - Jev (`jev-preview`, a `box` question) boxes the photo's main subject. Code decides: if the box, plus a 4% margin, fits a full-height 9:16 slice, crop around it; otherwise blur-fit, with the whole photo centred over a scaled-up, blurred, darkened copy.
  - The prompt is `ESSENTIAL`; the geometry is `decideFit` and the renderer is `renderStory`, all in `scripts/story-crop.ts`.
  - Test on 40 landscape trial photos against Opus's calls: Jev matched 31/40 with no wrong crops; Haiku matched 31/40 with one wrong crop, at about 45× the cost. Both err toward blur-fit, which never cuts content. Page: https://claude.ai/artifact/FGbjbwbNGrwd9DHgZZy6ZA
  - Not yet wired into MD rendering; that goes in with the MD rewire onto the ranker.
- D20 update (2026-11-23): Lean into the vertical crop. Lucas: "If it's possible to have most of the subject in the frame, then it should do that. Because the vertical crop looks better". Crop when the 9:16 slice covers at least 45% of the subject's width (`MOST_OF_SUBJECT`), unless Jev says the picture carries text a viewer must read in full; then the whole subject must fit. On the 40 test photos, crops rose from 3 to 11, with no headlines cut.
- D21 (2026-11-23): Thumbnails are never used. Lucas: "thumbnails can NEVER be used". A thumbnail is a graphic built to win a click: pasted-in people or reaction faces, big bold title text, or panels and logos layered around a person. Plain collages stay allowed (D18). Jev's `thumbnail` question with a 0.7 cutoff makes a candidate `none`. On all 171 trial images it caught 17/17 of Opus's thumbnails with 3 false rejections. The old overlay question caught 12/17.
- D22 (2026-11-23): Upscaling ships. Lucas: "The upscaling is good! My eye is reviewing it and it looks good :). ship that upscaler". Rule: upscale exactly when the shown region is stretched 1.25× or more (`needsUpscale`, `UPSCALE_FROM_STRETCH`); no model question. Real-ESRGAN x4plus at native input, with the garble check; any failure falls back to the plain frame (`storyFrame` in `scripts/story-upscale.ts`). Production note: the binary is on Lucas's Mac; the worker that renders MD needs `realesrgan-ncnn-vulkan` too, or every upscale falls back. Test record: Real-ESRGAN (local, free) on photos stretched 1.25× or more, at native input: 11/20 cleaner, 6/20 unfaithful (waxy faces, garbled small text), 2/20 worse. Never upscale photos that already have the pixels; that hurt more than it helped. Neither Jev's nor Haiku's "looks soft" answer predicted when upscaling would help. Review page: https://claude.ai/artifact/NcvFRq2VSCS63krqvdkeyE
- Cost A/B (2026-11-23): The system costs about $0.10 a day; the Opus reranker is about $0.06 of that. With the same prompt, Sonnet ($0.03/day) kept 9 of Opus's 18 posted stories and Haiku ($0.036/day) kept 10/18, adding an opinion piece Lucas had flagged as a dud. Opus's posted picks reach rank 25 of the shortlist, so trimming its input loses stories. Opus stays. The other steps are already Jev or tiny Haiku calls.

## Writing (workshop opened 2026-11-23)
- Lucas: "it's important that this all be centralized, and it does not have dependencies from MD to LFD or LFD to MD. Everything that we're building should be used by both". Starting point is Field Notes writing: "A headline that tells the viewer what they care about. what grabs attention. Why it's cool or valuable. Frame the story in a way the makes the viewer have a reaction. They want to keep reading. Then, the body copy closes the loop. It tells them what they wanted to know. It fills them in with valuable or cool details."
- Today: two writers repeat the same hook-first rules: MD `md-headlines@5` (`lib/stories/prompts.ts`) and LFD `LFD_SYSTEM` (`lib/lfd/prompt.ts`). Both also write photo requests, which the shared Haiku photo brief now owns (D17–D19). Field Notes (`lib/field-notes/write/prompts.ts`) runs Writer, then cut-only Editor, then fact check, with the headline shaped by the reader's one "want".
- W1 (2026-11-23): One shared writer, but never the same words in MD and LFD. Lucas: "This unfortunately would lead to people saying 'I already saw this'... and we don't want that." The writer code and rules are shared; each format gets its own fresh copy.
- W2 (2026-11-23): Two independent angles. Lucas: "What if the reranker picks an angle. Separately, and BLIND to the reranker... the writer picks an angle. And then the reranker's angle is revealed and the writer picks between the two?" The reranker adds an angle per story. The writer proposes its own without seeing it, then sees the reranker's, picks one and writes.
- W3 (2026-11-23): Writer, then fact check; a cut-only Editor only if lengths keep overflowing. Lucas: "Sure".
- W4 (2026-11-23): No forced difference between formats. Lucas: "I don't want to FORCE IT to be different because morning download should be using the best angle... all I want is for it to run again and if it comes out SIMILAR that's fine but at least it won't be exactly the same in most cases." Each format runs the writer fresh and sees nothing of the other's copy.
- W5 (2026-11-23): The writer picks whichever angle makes a reader react more and is supported by the source. It may sharpen that angle but never blends the two. Lucas: "Yeah".
- W6 (2026-11-23): The writer runs on Opus at low effort, with a Sonnet A/B once the prompt is set. Lucas: "yes".
- Draft prompts for approval: WRITER-DRAFT.md.
- W7 (2026-11-23): Last Few Days takes Morning Download's shape: headline of at most 60 characters with a period, one body sentence of at most 140, no setup line. Lucas: "yes, make 1 and 2". Reason: the 55-character cap and the 190-character, two-sentence body made LFD copy flatter than MD.
- W8 (2026-11-23): Writer v2, reaction-first (WRITER-DRAFT.md v2). Lucas: "crank the dial all the way up on engineering the writing … to really get a reaction from the reader", then "Approve and run". It adds a reaction core, four lever candidates and a blind Opus reader who picks one. 5-day test cost $1.38. Page: https://claude.ai/artifact/WwDvMj9MHGDrTXWhvpjKS2. Winning levers: surprise 13, contrast 7, stakes 6, person 4. A few candidates ran 1–6 characters over their caps; code should enforce caps before judging.
- W9 (2026-11-23): v2 rejected. Lucas: "This was a step back. Restore the previous writing." `scripts/news-writer.ts` is back to v1, keeping W7's LFD shape and the quote-check fix. The v2 code is kept at `.memes-local/news-ranker-lab/writer/news-writer-v2.ts.snapshot`. Next: look at open-source writing skills for direction (Lucas's ask).
- Research (2026-11-23), open-source writing skills, for direction only:
  - coreyhaines31/marketingskills (copywriting, social): clarity over cleverness; the swap test (could another story use this line unchanged?); ration the punch to one device; blacklists "it's not X, it's Y", self-answered questions and em dashes.
  - Axios Smart Brevity ("headlines should teach readers something new"): the headline teaches one specific, memorable fact, in about 10 words or 60 characters; no hyperbole or clickbait.
  - neversight hook-and-headline-writing: generate many, select by criteria.
  - charlie947 social-media-skills: a two-line hook, facts only, keep the source's uncertainty. It calls its own output clickbait-style.
  - Reading of why v2 fell back: its levers pushed tease and contrast devices, close to what these sources warn against. Awaiting Lucas's direction.
- W10 (2026-11-23): Teach one fact, as a lab draft. Lucas: "Teach one fact". Headline: "carries the single most striking specific fact … states the fact outright … never teases", plus the swap test and "clarity beats cleverness". Run on Nov 18 ($0.17): clearer and more factual, but flatter than v1. It led with the basic event (who did what) and dropped v1's striking details ("up to 70 mph", "police came anyway"). Awaiting Lucas.
- W11 (2026-11-23): The headline is the story, framed for a reaction. Lucas: "The headline, which is the actual story, needs to be framed in a way that gives readers a reaction, but that doesn't mean that we should pivot what the headline is about." A striking detail colours the main event and never replaces it as the subject. Proposed wording is in chat, awaiting his OK.
- W11 applied in the lab (Lucas: "Sure, test it"). Nov 18 rerun `run-frame-2026-11-18.json`, $0.174. Every headline stays on the main story and pulls the vivid detail into it (70 mph drone, spy affair, 4 teens sue). Close to v1 overall, plainer than v1's twists, livelier than teach-one-fact. Awaiting Lucas's read.
- W11 five-day run (Lucas: "Yes, run 5 days"): other 4 days $0.463 (5 days ≈ $0.64 total), page https://claude.ai/artifact/A2nqF2aFCVhiEKZC9q7Wdu. Four stories ran a few characters over the 140-character body cap, which production code would send back.
- **W12 (2026-11-23): W11 writer LOCKED** (Lucas: "Lock it in"). The source of truth is WRITER_CORE plus the MD and LFD format blocks in `scripts/news-writer.ts`, the v1 flow with the W7 LFD shape and the W11 headline. Next is production wiring: the reranker's angle field, the shared writer replacing `md-headlines@5` and `LFD_SYSTEM`, and code sending over-cap copy back for one rewrite. This needs a VM redeploy.
- **Held-out run (2026-11-23):** Lucas asked for "a real morning download run" on two days never touched before. Nov 13 and Nov 16 went through the full chain for $0.43 (`scripts/md-held-render.ts`, page https://claude.ai/artifact/1PGLMjQzN7W3ybfvayRktr). Nov 13 posted 4 stories. Nov 16 posted 2, because three top-tier stories with only usable photos lost to a non-top-tier story with a good photo (the open photo-gate issue). The renderer's top-half photo band re-crops the D20 vertical frames, so the full-bleed or band question needs Lucas's call. "via Google" comes from a Google News link (a lab shortcut). No upscale was needed.

## Design profiles (2026-11-23)

- D23. MD and LFD share four profiles: black (LFD's light, now on MD too), green (MD's flood; LFD hook ends in orange), white (Explainers grid, made noticeable: ink at 10%), orange (direction A, Sunrise). Lucas: "Black looks great." "A, sunrise."
- D24. LFD rotates evenly post by post, starting on black: black, green, orange, white (`nextLfdCanvas`, lib/lfd/post.ts).
- D25. The "Helios" pill is gone from every LFD slide.
- Review page: design-profiles.html (artifact 5gJAZHu6QnE2iRiuSGTDEB). Built locally, not committed, not deployed.

## LFD cover: true hook (open, 2026-11-23)

Lucas: the hook text takes at least 35–40% of the cover; the cover image is AI-generated from reference photos, logos, people and products in that post's stories; an LLM writes the image prompt; "I don't want this to be gimmicky. I want it to really make people curious"; it sends a message, more than one element, more than a collage. Seven seeded hooks rotate. MD's cover comes later.
- **D23 (2026-11-23): photo quality gates, never ranks.** Lucas: "it's not reasonable for a significantly worse story to come in just because of the difference between the photo being best versus usable." `choosePosts`: top-tier stories post in rank order when they have a good or usable photo. A top story with no photo waits. The minimum fills in rank order from stories that have a photo. Held-out rerun: Nov 13 posts 5, Nov 16 posts 4 (was 2).
- **D24 (2026-11-23): band fit replaces the 9:16 fit for Morning Download.** Lucas: "the photos need to be fitted to the band… Jensen's face was only shown halfway off the frame. That can never happen." `decideBand` and `renderBand` (story-crop.ts) and `bandFrame` (story-upscale.ts): the 1080×1180 band, never cutting the subject, whose bottom edge may reach 0.8 of the band (0.62 when it has text to read). Where the subject doesn't allow cover, a blur fill sits in the fade. D20's "most of the subject" leniency no longer applies to Morning Download. Tests: `tests/story-band.test.ts` (6 pass). Open: the HAS_TEXT flag fires on livery and brand labels, which leaves short photos.
- C1 (2026-11-23): Lucas approved all five directions (Unaware, Aftermath, Scale, Standoff, Exhibit). Kept hooks: "Here's what happened in AI while you were busy.", "Do you realize what just happened in AI in the last few days?", "{N} things happened in AI you need to know." Asked for more hooks with "SERIOUS URGENCY", and to avoid live API costs.
- Lab: 10 covers, two per direction, on three windows of the ranker's picks (Nov 11–14, 14–18, 17–19). Image prompts were written in the Claude Code session (no API). Images are GPT Image 2.6 on Higgsfield with the stories' photos as references (~1.75 credits each, ~18 total). The layout is `lfdCover.image` + `lfdCover.hook` in SlideTemplate (image 740 px, hook block ≈45% of the slide). Page: lfd-ai-covers.html (artifact 1CpYbjSXiWBigt3Xf9shu3). Script: scripts/lfd-ai-cover-page.ts.
- **D23 corrected (2026-11-23).** Lucas: "Something with just a 'usable' photo isn't a good story. You overdid it on the logic… in a case when we have to meet the minimum threshold of 2 stories I'd rather prioritize the strength of story over the strength of image. However, if there's not a good image then we should skip it." The walk again posts only top-tier stories with good photos. Filling to the minimum goes in story rank order and accepts good or usable photos. A story with no photo never posts.
- **D24 revised (2026-11-23).** Lucas: "The photos are hanging out on the top of the screen when they SHOULD be hanging out in the middle." A photo that fills the band whole-subject (at least 85% of its height, full width) keeps the cover and fade. Any other photo is contained: it sits centred between the masthead (350px) and the copy (1110px), inside 380–1040px, at full opacity over its own blur fill. That needed a renderer change: `Photo.contained` plus `CONTAINED_FADE` (types.ts, fades.ts, StoryFrame.tsx). Tests: story-band 8/8 and stories-render 10/10. Held-out v3 posted 4 stories on Nov 13 and 2 on Nov 16. The held-out run cost $0.96 in total.
- C2 (2026-11-23): Directions are Unaware and Standoff (Lucas). "The subjects of the stories need to be larger and take up more of the screen." Two new directions to try: Line-up, Interrogation.
- C3: Hook library is the 10 hooks Lucas listed, in `LFD_COVER_HOOKS` (lib/lfd/post.ts). They rotate post by post via `nextLfdCoverHook`; `{N}` is the story count. Accent phrases are mine, pending his read. Round 2 page: same artifact (1CpYbjSXiWBigt3Xf9shu3), 6 covers, ~10.5 Higgsfield credits.
- **C4 (2026-11-23):** Lucas: "I don't like line-up or interrogation. Try two new ones." Both are rejected. The two new directions on trial are Eye contact and The weight (round 3: e1, e2, w1, w2). Image prompts now follow the photoreal brief in `COVER-PROMPT-WRITER.md` (DRAFT, awaiting Lucas). It draws on OpenAI's imagegen skill, hoodini's image-master and the GPT Image 2 guides. The strongest levers, per Lucas's tip, are a real camera, lens and settings plus one motivated light source.
- **C5 (2026-11-23):** Lucas: Eye contact and The weight "both suck". Rejected; Unaware and Standoff remain the only directions. Cover fixes (all four canvases): the photo now fades through an eased mask into the canvas ground, with no hard stop. The side rules beside HELIOS are gone; the mark is a small sun orb plus the wordmark, centred. The hook starts at 200px and shrinks only until it fits the lower region (max 520px tall), so it fills the bottom half.
- **C6 (2026-11-23):** Lucas cut three hooks: "Miss this and you’ll be the last to know.", "Read this before everyone else catches up." and "Someone will bring this up. Know it first.". The library is now 7.
- **C7 (2026-11-23):** Lucas: "rotate the hook and have a jev node pick the direction for the visual". The hook rotates via `nextLfdCoverHook` and is wired into `lib/lfd/run.ts`. A Jev node (`lib/social/jev/client`, JevAsk) reads the post's stories and picks Unaware or Standoff. The prompt-writing step then writes the image prompt in that direction.
- **MC1 (2026-11-23):** For the Morning Download cover, Lucas picked peek (curiosity gap) + quick read (count, time, progress). Five visual mockups: Filmstrip, Deck, Mosaic, Unwatched rings, Slices (scripts/md-cover-peek-page.ts, real Nov 13 set). Pending his pick. The production opener is unchanged.
- **MC2 (2026-11-23):** Lucas: round 1 doesn't entice enough; A and B are the strongest. In round 2 the peek is the headlines left unfinished, cut mid-sentence or with their endings blacked out by code. Five covers: Lock screen, Redacted, Filmstrip unfinished, Deck top card open, Cliffhanger. Pending his pick.
- **MC3 (2026-11-23):** Lucas: round 2 went the wrong way. Anchor on round-1 A (Filmstrip) and B (Deck), and get curiosity from blur, question marks and copy. Five variants: A3 guess the rest, A4 all hidden, A5 one clue each, B3 what's on top, B4 that's just #1.
- **MC4 (2026-11-23):** Lucas picked A4 (Filmstrip, all hidden) and dropped its copy line.
- **MC5 (2026-11-23):** A4 cards made smaller (row 400px tall, 150px side margins); the row and footer moved up under the title.
- **MC6 (2026-11-23):** Lucas: something must visually prompt the forward tap. Three options on A4: T1 tap ripple on the right edge, T2 chevrons + NEXT on the right edge, T3 a "Tap to reveal →" button under the cards. Pending his pick.
- **MC7 (2026-11-23):** Lucas: T1–T3 are too corporate. Instead, arrows in the empty space below the footer: R1 long thin arrow, R2 bold gradient arrow, R3 three trailing arrows. Pending his pick.
- **MC8 (2026-11-23):** Lucas picked R1 (long arrow). Final MD cover: A4 + R1. Next is building it into the production opener (StoryFrame Opener + stories.css), which needs his go-ahead.
- **MC9 (2026-11-23):** Progress pips removed (they mimicked IG's story bars); the "4 stories · 1 minute" line is centred.
- **MC10 (2026-11-23):** Lucas renamed the series on the cover: "What you need to know in AI today" (3 lines, "in AI today" in orange). It replaces "Morning Download" as the shown name. The internal key morning_download stays. The closer, captions and Hub labels still say Morning Download until the production build.
- **MC11 (2026-11-23):** Lucas: Morning Download stays the series name, shown small under the Helios logo (then the date). The big headline is "What you need to know in AI today". Supersedes the rename in MC10: the closer, captions and Hub labels keep Morning Download.
- **MC12 (2026-11-23):** Series label smaller (26px), logo 150px, and the brand block moved up to the safe-zone top (250px). The headline restacks as "What you / need to know / in AI today". More room between the title, the cards and the arrow.
- **MC13 (2026-11-23):** Balanced final layout. One centred column in the safe area, sitting slightly above centre. Three groups: brand (logo 144, series 24px, date 20px, gaps 24/12), promise (100px, 80px above), stories (120px above; cards 360px tall, count 36px below, arrow 48px below). The cards, count and arrow share one 784px column width.
- **MC14 (2026-11-23):** Final cover rendered on all four MD profiles with the story frames' own ink and accent per backdrop. Orange and green get a white accent, white arrow, white ring on the lead card and a white logo ring; white gets a green date.
- **MC15 (2026-11-23):** Cover built into production (uncommitted): OpenerData.peek (story photos in order), OPENER copy (series, promise, quick), the Opener component and CSS, and peek URL rewriting in render.ts. The opener credits no photo. Tests 106/106, tsc clean. Follow-up: the writer's opener_visual photo search still runs but is no longer drawn; removing it is a prompt change that needs Lucas.
- **MC16 (2026-11-23):** Lucas's six cover headlines rotate in order and never repeat the last set's (copy.ts OPENER_PROMISES, nextOpenerPromise, common.ts lastOpenerPromise; stored on the opener as promise). The headline is a fit region: 936px wide, max 306px, shrinking from 100px with a 64px floor. One-minute lines are skipped on sets longer than a minute. All six render with no fit problems. Tests 107/107, tsc clean, uncommitted.
