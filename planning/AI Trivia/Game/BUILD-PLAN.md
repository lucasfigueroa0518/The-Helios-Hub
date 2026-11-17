# "Are you Smarter Than AI?" — the daily web game (build plan for Cursor)

Owner: Lucas Figueroa. Written 2026-11-16 by Claude after an interview with Lucas. Every product decision in this
document is Lucas's (see §1). **Do not change a decision. If something here is impossible, stop and ask Lucas.**

This document is for the agent building the **website side** (Cursor). The **hub side** (making the questions)
is built by Claude in The Helios Hub; the only thing you need from it is the export described in §6. Until
that export exists you build against the fixture in §6.4, so you are never blocked.

How to use this document:

- Work through the milestones in §10 **in order**. Finish each milestone's acceptance checks before starting
  the next.
- Copy code blocks marked **VERBATIM** exactly. Everything else is a specification you implement.
- Never invent a new screen, button, text, color or feature. If you think something is missing, ask.
- Never put a secret in browser code. Secrets live only in Vercel env vars and serverless functions (`/api`).
- Run `npm run build` and `npx tsc --noEmit` (if the project has a tsconfig check) after every milestone.

---

## 0. What we are building, in one paragraph

A daily trivia game at **heliosgroup.ai/free-tools/smarter-than-ai**. Every day at midnight New York time a new
game appears: **5 questions**, shown **one at a time**, **15 seconds each**, 3 options each. The player plays
against **the AI** (GPT-5 nano with no web search), whose real answers were recorded in advance. The AI is shown
as the **Helios critter** (the same character as our Instagram stories). After each answer the game reveals
right/wrong, what the AI picked, and a one-line explanation, then moves on by itself. At the end: who won (You 4 ·
AI 3), a shareable emoji result, "You beat 68% of players today", a streak, and a countdown to tomorrow. **One
play per day per device**, like Wordle. Past days are playable once each from an archive. The game is also
offered in the social-landing popup next to the AI networking events calendar.

---

## 1. Lucas's decisions (fixed)

| # | Decision | Lucas's choice |
|---|---|---|
| D1 | Questions per day | 5, shown one by one |
| D2 | Time per question | 15 seconds (was 10; Lucas, 2026-11-17). Running out counts as wrong |
| D3 | Plays per day | One per device per day (like Wordle) |
| D4 | The AI opponent | Real answers from GPT-5 nano (no web search), recorded when the day is made. Its pick is revealed **after** the player answers each question, with a running score "You 2 · AI 1" |
| D5 | Scoring | Correct count only: You X/5 vs AI X/5 → win, tie or lose. The timer adds pressure, not points |
| D6 | Accounts | None. An anonymous ID on the device. Streak and stats belong to the device |
| D7 | Question source | 5 game questions a day from the hub's trivia pipeline, separate from the Instagram story question, same quality bar and fact-check. Questions never repeat |
| D8 | Comeback hooks (all four) | Streak counter (milestones 3, 7, 30, 100; missing a day resets it), share card, "You beat N% of players today", countdown to the next game |
| D9 | Difficulty | Each day's 5 is picked so the AI usually scores 3 of 5 (sometimes 2 or 4). Done by the hub; you just display it |
| D10 | Archive | Past days playable **once each** per device. Counts toward total games and win rate, **not** the streak and **not** that day's percentile |
| D11 | Helios ask | One soft link to the AI networking events calendar under the results. No email capture, no booking CTA |
| D12 | Critter during the timer | It thinks, then at a moment shows "AI locked in" (its pick stays hidden). The moment is staged; the answer is real |
| D13 | After answering | **Auto-advance**: the reveal holds, then the next question starts on its own (tap anywhere skips ahead) |
| D14 | Sound | On by default (starts with the first tap, as browsers require), with a mute button that is remembered. Vibration on phones |
| D15 | Name and place | **"Are you Smarter Than AI?"**, under Free Tools: `/free-tools/smarter-than-ai`. Short share link `/play` |
| D16 | Day flip | Midnight **America/New_York**, one global day for everyone |
| D17 | Archive at launch | Starts empty: Day 1 is launch day |
| D18 | Builders | Claude builds the hub side; Cursor builds the website side (this document) |

---

## 2. Why the game is designed this way (the research, short)

These principles decide every detail below. When unsure, pick the option that serves them.

1. **Scarcity makes it a ritual.** One game a day, the same for everyone, ends in about a minute and sends you
   away until tomorrow. That limit is the main reason Wordle stuck: it never burns out. → D3, D16, the countdown.
   ([UX Magazine](https://uxmag.com/articles/the-fascinating-psychology-tricks-that-make-wordle-so-addictive),
   [Northeastern](https://news.northeastern.edu/2022/01/21/what-makes-wordle-so-g-r-e-a-t/),
   [Desirability Lab](https://desirabilitylab.com/backfill/backfill-2023-132-wordles-daily-limit))
2. **A spoiler-free share grid spreads it.** The emoji grid shows *how* you did without giving away answers, so
   people can brag without spoiling. → the share card (§5.6).
3. **Streaks work through loss aversion.** Duolingo's own tests show streak features lifting retention (its
   streak wager raised Day-7 retention by 14%), with milestone celebrations at 7, 30, 100 days.
   ([Yu-kai Chou](https://yukaichou.com/gamification-study/master-the-art-of-streak-design-for-short-term-engagement-and-long-term-success/),
   [Duolingo mechanics](https://duolingo.deconstructoroffun.com/mechanics/streaks)) → D8. No streak freeze in
   v1 (Lucas's call).
4. **Short daily sessions beat long ones.** One daily puzzle builds a habit without demanding heavy use.
   ([Web Summit summary](https://vancouver.websummit.com/summaries/van26/the-fight-for-attention/),
   [WellGames](https://wellgames.com/news/nyt-games-trends-casual-gaming-096009)) → 5 questions, ~1 minute.
5. **An opponent turns a quiz into a duel.** A running "You vs AI" score gives every question stakes and every
   reveal a second beat (did *it* get it?). → D4, D12.
6. **Juice: every action answers back instantly.** A tap gets motion, sound and a buzz within 100 ms; right
   answers get bigger rewards than wrong ones get punishments; the end gets the biggest celebration.
   (Jonasson & Purho, "Juice it or lose it", GDC Europe 2012; Steve Swink, *Game Feel*, 2008.) → §5.8.
7. **No information vomit.** One idea per screen. No tutorial: the first question teaches the game. No
   paragraphs anywhere. The only explanatory sentence is "5 questions. 15 seconds each. Beat the AI."

---

## 3. Architecture

```
The Helios Hub (heliosgroup.tech, Next.js, Supabase project okslkogkokdwylmcsygz)      ← Claude builds
   trivia pipeline → a "game day" (5 questions + the AI's picks) ready by ~6 pm NY the day before
   GET https://heliosgroup.tech/api/public/trivia-game/days?after=YYYY-MM-DD  (Bearer token)   ← the contract, §6

Helios website (heliosgroup.ai, Vite + React SPA on Vercel)                              ← Cursor builds
   /api/game/*        Vercel serverless functions (Node, TypeScript). The ONLY code that talks to Supabase.
   site Supabase      project uxyvaknayquzgsglktow, schema `game` (§7). Stores every day forever.
   /free-tools/smarter-than-ai   the game (React, lazy-loaded route)
```

Key rules:

- **The browser never sees a correct answer before the player answers.** The browser gets one question at a
  time with no `correct` field; the server checks the answer and only then returns the correct letter, the AI's
  pick and the explanation.
- **The server owns the timer.** It records when each question was served; an answer arriving more than
  16.5 s later (15 s + 1.5 s grace for network) counts as a timeout. Refreshing the page mid-question does not
  give a new 15 seconds.
- **The browser never talks to Supabase.** No Supabase client in `src/`. Only `/api` functions use
  `@supabase/supabase-js` with the service role key. All `game` tables have RLS on and no policies.
- **The site pulls from the hub** (D: "the Helios site will fetch the questions … from the hub"): a sync
  function copies new days from the hub export into the site Supabase. It runs from a daily Vercel cron and
  also on demand when today's day is missing (§8.7), so a Hobby-plan cron delay never blocks the game.

---

## 4. Setup (do this first)

### 4.1 Where to work

The local `main` in `/Users/lucasfigueroa/HELIOS/CODE/FIGMAHELIOSWEBSITE` is 9 commits behind `origin/main` and has
uncommitted changes. **Do not use it.** Create a fresh worktree from `origin/main`:

```bash
cd /Users/lucasfigueroa/HELIOS/CODE/FIGMAHELIOSWEBSITE
git fetch origin
git worktree add ../FIGMAHELIOSWEBSITE-game -b feat/smarter-than-ai origin/main
cd ../FIGMAHELIOSWEBSITE-game
npm install
```

All paths below are relative to `/Users/lucasfigueroa/HELIOS/CODE/FIGMAHELIOSWEBSITE-game`.

### 4.2 What already exists on origin/main (use it, don't duplicate it)

- Vite 6 + React 18 SPA, `react-router` 7 data router in `src/app/routes.tsx` (all pages are children of `Layout`).
- Tailwind v4 + global CSS in `src/styles/*.css`; design tokens in `src/styles/helios-ds.css`; premium classes in
  `src/styles/premium.css`; shadcn/Radix UI in `src/app/components/ui/*`.
- `motion` 12 (`import { motion, AnimatePresence } from "motion/react"`), `canvas-confetti` 1.9 (already a dependency).
- Free tools registry `src/app/data/freeTools.ts`, index `src/app/pages/FreeToolsPage.tsx`, popup
  `src/app/components/FreeToolsPopup.tsx`, social landing `src/app/pages/SocialLandingPage.tsx`.
- Analytics wrapper `src/lib/analytics.ts` (Vercel Analytics custom events). Use it; add event names there.
- Prerender: `scripts/prerender.mjs` (puppeteer, UA "HeliosPrerender") runs after `vite build`.
- `vercel.json`: redirects, headers, and a catch-all SPA rewrite `{"source": "/(.*)", "destination": "/index.html"}`.

### 4.3 New dependencies

```bash
npm install @supabase/supabase-js
npm install -D @vercel/node vitest
```

Add to `package.json` scripts: `"test": "vitest run"`.

### 4.4 Environment variables

Set these in Vercel (Production and Preview) and in a local `.env.local` (never commit it). Names are fixed:

| Name | Where | Value |
|---|---|---|
| `GAME_SUPABASE_URL` | server only | `https://uxyvaknayquzgsglktow.supabase.co` |
| `GAME_SUPABASE_SERVICE_ROLE_KEY` | server only | the site project's service role key (Lucas gets it from the Supabase dashboard) |
| `HUB_GAME_EXPORT_URL` | server only | `https://heliosgroup.tech/api/public/trivia-game/days` |
| `HUB_GAME_EXPORT_TOKEN` | server only | shared secret; Lucas sets the same value in the hub's Vercel env |
| `CRON_SECRET` | server only | any long random string; Vercel sends it to cron routes |
| `GAME_SOURCE` | server only | `hub` in production; `fixture` while the hub export does not exist yet (§6.4) |

**None of these may start with `VITE_`.** Anything starting with `VITE_` ships to the browser.

### 4.5 Local development with `/api`

`vite dev` does not run `/api` functions. Use `npx vercel dev` (the project is already linked:
`heliosmarketingwebsite`). It serves the Vite app and `/api/*` together.

---

## 5. The game: screens, behaviour and feel

Mobile first. Design at 390 × 844. On wider screens the game is a centered column `max-width: 480px`.

### 5.1 Visual language (inspired by the IG stories, not a copy)

- **Background (game screens):** the Helios orange stage: `linear-gradient(180deg, #FF8A4F 0%, #FF5E1A 55%, #E64A0A 100%)`.
- **Cards and option buttons:** white `#FFFFFF`, ink text `#141414`, radius `20px`, shadow `0 6px 0 rgba(0,0,0,.12)`
  (a "pressable" bottom edge; on press translate Y 3px and shrink the shadow to 3px).
- **Right:** Helios green `#138510` (use the token `--helios-green`). **Wrong:** `#E63946` (`--helios-hot`).
  Always pair color with an icon (✓ / ✗). Never color alone.
- **The AI:** a dark ink pill `#141414` with white text, used for "AI locked in", the AI's pick badge and the
  AI's score.
- **Type:** headings in Pragmatica Extended Bold, UPPERCASE (`var(--font-heading)`); everything else Roboto
  (`var(--font-body)`). Question 26 px / 1.25 bold; options 20 px medium; labels 14 px bold uppercase with
  `letter-spacing: .06em`.
- **Numbers that change** (score, streak, percentile) use `font-variant-numeric: tabular-nums`.

### 5.2 Routes

| Route | What |
|---|---|
| `/free-tools/smarter-than-ai` | the game (start screen, or results if today is already played) |
| `/free-tools/smarter-than-ai/day/:dayNumber` | an archive day (start screen for that day, or its result) |
| `/free-tools/smarter-than-ai/archive` | the archive list |
| `/play` | redirect (vercel.json, 302) to `/free-tools/smarter-than-ai?utm_source=share` |

Lazy-load the game route (`lazy: () => import(...)` in the router) so the critter kit and game code never load
on other pages. The game page is prerendered as an empty shell; all game data loads client-side.

### 5.3 Screen 1 — Start

Inside the normal site `Layout` (header and footer visible). Content, top to bottom, centered:

1. Label: `DAY 12 · NOV 16` (day number and NY date).
2. The critter, waving (§5.7), about 180 px tall.
3. Title (Pragmatica, uppercase, 34 px, two lines): `ARE YOU SMARTER THAN AI?`
4. One line (Roboto 18 px, 85% opacity): `5 questions. 15 seconds each. Beat the AI.`
5. AI chip (ink pill): `Opponent: GPT-5 nano (no web search)`. The model label comes from the day's data
   (`aiLabel`), never hard-coded.
6. Big button, full width, white with orange text, 64 px tall: `PLAY`.
7. Small link under it: `Past days` → archive (hide when the archive is empty).

Nothing else. No rules, no explanation, no stats on this screen.

If today is already played on this device, show Screen 4 (Results) instead. If today's day is not available
(sync failed), show the critter `sleepy`, the line `Today's game is on its way. Check back in a few minutes.` and
the `Past days` link.

### 5.4 Screen 2 — The question (×5)

Pressing PLAY opens the **focus layer**: a fixed full-screen overlay (`position: fixed; inset: 0; z-index: 50`)
on the orange stage, hiding the site header and footer, so nothing distracts. A small `×` (top-left) asks
"Quit? This counts as your game." in a dialog — quitting finishes the play with the remaining questions as
timeouts. The mute toggle (speaker icon) sits top-right.

Before question 1 only: a 3-2-1 count (each number pops in the center, 450 ms each, with a tick sound). Then:

Layout, top to bottom:

1. **Top bar:** 5 progress dots (current one larger and white; answered ones filled green or red), and the
   score `YOU 0 · AI 0` (ink pill for the AI part).
2. **Timer bar:** full width, 8 px tall, white, draining linearly from 100% to 0% over 15 s, with the whole
   seconds left as a small number at its right end. In the last 3 seconds the bar turns `#E63946`, the number
   pulses (scale 1 → 1.15 → 1 each second) and a tick plays each second.
3. **The critter**, top-right of the question card, about 110 px, thinking (§5.7). When its staged lock-in
   moment comes (§5.5), it does a small pop and an ink pill `AI LOCKED IN` slides in beside it.
4. **Question card** (white): the question text.
5. **Three option buttons**, stacked, full width, min height 64 px, in the bottom half of the screen (thumb
   zone). Each shows its letter in a small circle and the text. Keyboard: `1`/`2`/`3` and `A`/`B`/`C` pick.

Entrance: the question card slides up 24 px and fades in (250 ms, ease-out); the options follow with a 60 ms
stagger. **The 15 seconds start when the last option has finished appearing**, and the client calls
`/api/game/next` (which starts the server's clock) just before that moment.

On tap: the tapped button scales 0.97 for 80 ms, a tap sound plays, `navigator.vibrate?.(12)`, all buttons lock
(no second answer), the timer bar freezes.

### 5.5 The reveal (auto-advances, D13)

As soon as `/api/game/answer` returns (show nothing extra while waiting; if it takes over 600 ms, show a small
spinner in the tapped button):

1. **Player right:** the tapped button turns green, its letter circle becomes ✓, it pops (scale 1 → 1.06 → 1,
   300 ms, spring), a small confetti burst fires from it (`canvas-confetti`, 40 particles, colors white and
   green), the "right" sound plays, `vibrate(30)`, and the YOU score ticks up with a pop.
   **Player wrong:** the tapped button turns red with ✗ and shakes (x: 0, -8, 8, -6, 6, 0 over 350 ms); the
   correct button turns green with ✓; the "wrong" sound plays; `vibrate([40, 40, 40])`.
   **Timeout:** the timer bar flashes red, the text `TIME'S UP` drops in for 600 ms, then the correct button
   turns green as above.
2. 250 ms later, **the AI's pick**: an ink badge `AI` appears on the option the AI picked (on the right edge of
   that button). If the AI was right, the AI score ticks up and the critter celebrates; if wrong, it deflates
   (§5.7). If the player and the AI picked the same option, both marks sit on the same button.
3. 400 ms later, **the why line** (`answerLine`, one sentence) fades in under the options, Roboto 17 px.
4. **Hold**, then go to the next question by itself. Hold time in ms =
   `clamp(1800 + 45 × answerLine.length, 2600, 5000)`, counted from step 3. A thin white line at the very bottom
   of the screen fills over the hold so the player sees it coming. Tapping anywhere after the first 700 ms skips
   ahead.
5. After question 5, go to Results (no hold line; a 400 ms pause, then Results).

**The staged lock-in (D12).** The AI's answer was recorded when the day was made; the lock-in moment is
animation. Its time is fixed per question so everyone sees the same thing:
`lockInSeconds = 2.5 + (hashString(questionId) % 40) / 10` (2.5 s to 6.4 s), where `hashString` is the
VERBATIM function in §9.3. If the player answers before that moment, show the lock-in instantly at the reveal.
The AI's pick is never shown before the player answers or times out.

### 5.6 Screen 4 — Results

The focus layer closes; results show inside the normal `Layout`. Sequence (each step starts when the previous
lands):

1. **Verdict** (Pragmatica, uppercase, 34 px, drops in with a spring): `YOU BEAT THE AI` (player > AI),
   `IT'S A TIE` (equal), `THE AI WINS THIS ONE` (player < AI). The critter reacts (§5.7). If the player won, a
   big confetti burst (2 bursts from both sides, 120 particles each).
2. **Score:** `YOU 4 · AI 3` with each number counting up from 0 (60 ms per step).
3. **Your row:** 5 tiles flip in one by one, 120 ms apart, each with a tick: green tile ✓ for right, red ✗ for
   wrong, grey ⏱ for timeout. Under it, smaller, the AI's row the same way.
4. **Percentile** (daily play only, and only when at least 10 people have finished today):
   `You beat 68% of players today`. Otherwise show `Day 12 · 7 players so far`.
5. **Streak** (daily only): a flame icon and the number, bumping once. On a milestone (3, 7, 30, 100) show a
   one-line celebration under it: `3-day streak!` (with a small confetti burst and the streak sound).
6. **Share button** (primary, full width, white on orange, 64 px): `SHARE RESULT`. It pulses once (scale
   1 → 1.04 → 1) when it appears.
7. **Countdown:** `Next game in 07:42:10`, ticking every second, to the next midnight in America/New_York. When
   it hits zero, show a button `PLAY TODAY'S GAME`.
8. Two quiet links on one line: `Stats` (opens the stats sheet) · `Past days`.
9. One soft line, smaller, at the bottom (D11): `Into AI? Find this week's AI events →` linking to
   `/free-tools/ai-networking-events?src=game`.

**Share text** (VERBATIM format; built by `shareText()` in §9.3):

```
Are you Smarter Than AI? #12
🟩🟥🟩🟩⏱️
Me 4 · AI 3
heliosgroup.ai/play
```

On phones use `navigator.share({ text })` when available; otherwise copy to the clipboard and show a toast
`Copied — paste it anywhere`. Archive results share the same way with `#<dayNumber>`.

**Stats sheet** (bottom sheet, shadcn `Drawer` or `Sheet`): Played, Win % (games where you beat the AI), Current
streak, Max streak, and a 0–5 score distribution as horizontal bars (today's score highlighted). Nothing else.

### 5.7 The critter

The critter is the same character as the Instagram stories: **Explainers critter D**, green body, headphones.
Its drawing code is a small set of plain JavaScript modules ("the kit") that return SVG strings.

**Copy the kit VERBATIM** from
`/Users/lucasfigueroa/HELIOS/CODE/Helios-hx5/explainers/world-kit/` (git commit `64bd3953`) into
`src/game/critter/kit/`: `cast.js`, `wear.js`, `core.js`, `motion.js`, `draw.js`, `seams.js`, `hershey-sans.js`.
Do not edit them. Add `// @ts-nocheck` handling via a `kit.d.ts` that declares the module exports as `any`.

The kit's API (what you call):

- `critter(x, y, opts)` → SVG string of the critter with its feet at (x, y). `opts`:
  `{ body: 'green', s: <scale>, flip: <bool>, pose, mood, blink, look: [x, y], arms, state, head: 'headphones' }`.
- `critterShadow(x, y, { s, pose, flip })` → SVG string of its ground shadow.
- From `motion.js`: `MOTIONS`, `MOOD_MOTION`, `motionAt(name, t, { loop })` → a pose at time t; `blinkAt(t)`;
  `glanceAt(t)`.
- Moods: `neutral, happy, curious, focused, surprised, sly, worried, angry, proud, sleepy`.
  States: `idle, think, work, wait, done`.

Build `src/game/critter/Critter.tsx`: a component `<Critter act={...} size={px} flip={bool} />` that draws into an
`<svg viewBox="0 0 200 220">` on every animation frame (`requestAnimationFrame`), using the same pattern as the
trivia video renderer (`/Users/lucasfigueroa/HELIOS/CODE/Helios-Hub-trivia/lib/stories/trivia/render/critter.ts`,
function `critterModule`, which you should read): pick the current beat, compute `pose` with `motionAt` (play the
beat's move once from its `on` mark, then idle), `blink: blinkAt(t)`, `look` from the act or `glanceAt(t)`.
Feet at (100, 205), scale so the critter fills the box. Stop the loop when unmounted. With
`prefers-reduced-motion: reduce`, draw one still frame per act instead of animating.

Acts (the only ones you need):

| Act | When | Beats (at seconds from the act's start) |
|---|---|---|
| `wave` | start screen | `{at:0, mood:'happy', motion:'hop'}` then `{at:1.2, mood:'happy', lookAt:'viewer'}`; loops every 6 s |
| `think` | question running | `{at:0, state:'think'}`; looks toward the question card (look `[-0.6, 0.3]`) |
| `lockIn` | staged lock-in | `{at:0, mood:'sly', motion:'pop'}` then back to `think` after 0.8 s |
| `aiRight` | reveal, AI right | `{at:0, state:'done'}` then `{at:1.3, mood:'happy', lookAt:'viewer'}` |
| `aiWrong` | reveal, AI wrong | `{at:0, mood:'worried'}` then `{at:1.3, mood:'sleepy'}` |
| `playerWon` | results, player beat AI | `{at:0, mood:'surprised'}` then `{at:1, mood:'worried', lookAt:'viewer'}` |
| `aiWon` | results, AI beat player | `{at:0, mood:'proud'}` then `{at:1.5, mood:'sly', lookAt:'viewer'}` |
| `tie` | results, tie | `{at:0, mood:'curious', lookAt:'viewer'}` |
| `sleepy` | no game available | `{at:0, mood:'sleepy'}` |

The critter is **the AI**. It never appears as the player.

### 5.8 Sound and vibration (D14)

Use the Web Audio API with synthesized sounds (no audio files). Create one `AudioContext` lazily on the first
user tap (the PLAY button). The mute state lives in `localStorage` key `helios.game.muted` (`"1"` or absent).
Copy `src/game/sfx.ts` from §9.4 VERBATIM. Sounds: `tick`, `tap`, `right`, `wrong`, `lock`, `fanfare`,
`streak`. Vibration via `navigator.vibrate?.(…)` (Android; iOS ignores it, which is fine). Mute also stops
vibration.

### 5.9 Accessibility and small rules

- `prefers-reduced-motion: reduce`: no shakes, no confetti, fades instead of slides, the critter still.
- The reveal result is announced in an `aria-live="polite"` region (`Right. The AI also got it right.`).
- Buttons are real `<button>`s with focus rings. Keyboard play works (1/2/3, A/B/C, Enter to skip the hold).
- Never show more than one sentence of explanatory text at a time.

### 5.10 Archive (D10, D17)

`/free-tools/smarter-than-ai/archive`: a simple list, newest first, of past days (not today). Each row:
`Day 11 · Nov 15` and, if played on this device, the result tiles (5 small squares) and `4–3`; if not played,
a `Play` button. A past day can be played once per device; it runs exactly like a daily game (same screens),
except the results show no percentile and no streak, and the share text uses that day's number. When the archive
is empty (launch day), hide every `Past days` link.

---

## 6. The hub contract (built by Claude in The Helios Hub)

### 6.1 Endpoint

`GET {HUB_GAME_EXPORT_URL}?after=YYYY-MM-DD` with header `Authorization: Bearer {HUB_GAME_EXPORT_TOKEN}`.

Returns every **final** game day with `nyDate > after` (all days when `after` is omitted), oldest first, at most
60 per call. A day appears in the export only when all 5 questions passed the fact-check and have the AI's answer,
and only once it is locked: the hub builds each day the day before, Lucas may swap questions until 11 pm New York,
and then the day locks. So tomorrow's day appears at about 11 pm New York tonight, and an exported day never
changes. **The site must never show a day whose `nyDate` is after today in America/New_York.**

### 6.2 Response (TypeScript type, VERBATIM — put it in `api/_lib/hubTypes.ts`)

```ts
export type HubLetter = 'A' | 'B' | 'C';

export type HubGameQuestion = {
  /** Stable, unique forever (the hub's question id). */
  id: string;
  /** 1..5: the order in the game. */
  position: number;
  question: string;
  /** Always 3 options, lettered A, B, C in this order. */
  options: Array<{ letter: HubLetter; text: string }>;
  correct: HubLetter;
  /** One sentence shown after the answer. */
  answerLine: string;
  /** Fact-check sources (URLs). Stored, not shown in v1. */
  sources: string[];
  /** The AI's one real answer, recorded when the day was made. */
  ai: { model: string; label: string; picked: HubLetter };
};

export type HubGameDay = {
  /** 1 on launch day, then +1 per day. Never reused. */
  dayNumber: number;
  /** The New York calendar date this day is played (YYYY-MM-DD). */
  nyDate: string;
  questions: HubGameQuestion[]; // exactly 5, positions 1..5
};

export type HubGameExport = { days: HubGameDay[] };
```

### 6.3 Validation on import (the site rejects a bad day, never shows it)

A day is imported only if: `dayNumber` is a positive integer; `nyDate` matches `YYYY-MM-DD`; exactly 5
questions with positions 1–5; each has exactly 3 options lettered A, B, C; `correct` and `ai.picked` are one of
A/B/C; `question`, `answerLine`, `ai.label` are non-empty; no question `id` already exists on another day.
A rejected day is logged (`console.error` with the reason) and skipped; the next sync tries again.

### 6.4 The fixture (build against this until the hub export exists)

When `GAME_SOURCE=fixture`, the sync reads `api/_lib/fixture.ts` instead of calling the hub. Create it with
**3 days** whose `nyDate`s are computed at runtime: two days ago, yesterday and today (America/New_York),
`dayNumber` 1, 2, 3. Fill them with 15 simple placeholder questions you write yourself (clearly fake, e.g.
"Fixture question 3 of day 2?"), with a mix of AI right and wrong (AI scores 3, 2 and 4 on the three days).
Never ship `GAME_SOURCE=fixture` to Production.

---

## 7. Site database (Supabase project `uxyvaknayquzgsglktow`)

Create `supabase/game_schema.sql` with exactly this content (VERBATIM) and ask Lucas to apply it (or apply it
with `psql "$DATABASE_URL" -f supabase/game_schema.sql` if he says to). It is safe to run more than once.

```sql
-- "Are you Smarter Than AI?" — the daily web game. Only the site's /api functions (service role) touch these.
CREATE SCHEMA IF NOT EXISTS game;

CREATE TABLE IF NOT EXISTS game.days (
    day_number   integer PRIMARY KEY CHECK (day_number > 0),
    ny_date      date NOT NULL UNIQUE,
    ai_label     text NOT NULL,
    imported_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game.questions (
    id           text PRIMARY KEY,                       -- the hub's question id
    day_number   integer NOT NULL REFERENCES game.days (day_number) ON DELETE CASCADE,
    position     smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
    question     text NOT NULL,
    options      jsonb NOT NULL,                         -- [{"letter":"A","text":"..."}, ...] (3)
    correct      text NOT NULL CHECK (correct IN ('A', 'B', 'C')),
    answer_line  text NOT NULL,
    sources      jsonb NOT NULL DEFAULT '[]'::jsonb,
    ai_model     text NOT NULL,
    ai_label     text NOT NULL,
    ai_picked    text NOT NULL CHECK (ai_picked IN ('A', 'B', 'C')),
    UNIQUE (day_number, position)
);

CREATE TABLE IF NOT EXISTS game.plays (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id    uuid NOT NULL,                          -- anonymous device id (localStorage)
    day_number   integer NOT NULL REFERENCES game.days (day_number),
    mode         text NOT NULL CHECK (mode IN ('daily', 'archive')),
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz,
    score        smallint,                               -- player's correct count, set on finish
    ai_score     smallint,
    UNIQUE (player_id, day_number)                       -- one play per device per day, daily or archive
);
CREATE INDEX IF NOT EXISTS idx_game_plays_player ON game.plays (player_id, day_number);
CREATE INDEX IF NOT EXISTS idx_game_plays_day_daily ON game.plays (day_number) WHERE mode = 'daily' AND finished_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS game.answers (
    play_id      uuid NOT NULL REFERENCES game.plays (id) ON DELETE CASCADE,
    position     smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
    served_at    timestamptz NOT NULL DEFAULT now(),
    answered_at  timestamptz,
    choice       text CHECK (choice IN ('A', 'B', 'C')), -- null = timeout
    is_correct   boolean,
    PRIMARY KEY (play_id, position)
);

-- Deny everything to anon/authenticated: only the service role (our /api functions) reads and writes.
ALTER TABLE game.days ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.plays ENABLE ROW LEVEL SECURITY;
ALTER TABLE game.answers ENABLE ROW LEVEL SECURITY;
```

Also, in the Supabase dashboard, **Settings → API → Exposed schemas**: add `game` (so `supabase-js` with
`db: { schema: 'game' }` can reach it). The service role bypasses RLS.

---

## 8. The API (`/api/game/*`, Vercel Node functions)

### 8.1 Files

```
api/_lib/supabase.ts     createClient(GAME_SUPABASE_URL, GAME_SUPABASE_SERVICE_ROLE_KEY, { db: { schema: 'game' }, auth: { persistSession: false } })
api/_lib/hubTypes.ts     §6.2
api/_lib/fixture.ts      §6.4
api/_lib/time.ts         §9.1 (VERBATIM)
api/_lib/rules.ts        §9.2 (VERBATIM): timer, streak, percentile
api/_lib/sync.ts         syncDays(): pull from hub or fixture, validate (§6.3), upsert days + questions
api/_lib/player.ts       readPlayer(req): the x-player-id header, must be a UUID v4, else 400
api/game/today.ts        GET
api/game/day.ts          GET ?day=N
api/game/start.ts        POST
api/game/next.ts         POST
api/game/answer.ts       POST
api/game/quit.ts         POST
api/game/me.ts           GET
api/game/days.ts         GET  (archive list)
api/game/sync.ts         GET  (cron; requires Authorization: Bearer CRON_SECRET)
```

Every request from the browser sends header `x-player-id: <uuid>`. The browser creates it once with
`crypto.randomUUID()` and keeps it in `localStorage` key `helios.game.player`.

All responses are JSON with `Cache-Control: no-store`. Errors: `{ "error": "<code>" }` with status 400/404/409/500.

### 8.2 `GET /api/game/today`

1. `today = nyToday()` (§9.1). Find the day with `ny_date = today`. If missing, run `syncDays()` once (§8.7),
   then look again. Still missing → `404 { error: 'no_game_today' }`.
2. Response:
   `{ dayNumber, nyDate, aiLabel, archiveCount, play: <PlayState | null> }` where `archiveCount` is the number of
   days with `ny_date < today`, and `play` is this player's play for the day (§8.8), or null.

`GET /api/game/day?day=N` is the same for an archive day (404 if the day is today or in the future).

### 8.3 `POST /api/game/start` — body `{ dayNumber }`

- The day must exist and `ny_date <= today`. `mode = ny_date === today ? 'daily' : 'archive'`.
- Insert a play `(player_id, day_number, mode)`. On the unique conflict, return the existing play's
  `PlayState` with status 200 (the client resumes or shows results). Otherwise return the new `PlayState`.

### 8.4 `POST /api/game/next` — body `{ playId }`

Serves the next question and starts its server clock.

- Load the play (must belong to `x-player-id`, else 404). If finished → `409 { error: 'finished' }`.
- Find the lowest position with no `game.answers` row. If an earlier served question has no answer and its
  window (16.5 s) has passed, it must already be recorded as a timeout — run `closeExpired(play)` first: for any
  answers row with `answered_at IS NULL` and `served_at + 16.5 s < now()`, set `answered_at = served_at + 15 s`,
  `choice = null`, `is_correct = false`.
- If there is an open question still inside its window (served, unanswered, not expired), return it again with
  `secondsLeft` reduced accordingly (a refresh does not reset the clock).
- Otherwise insert `answers (play_id, position, served_at = now())` and return
  `{ position, questionId, question, options, lockInSeconds, secondsLeft: 15 }`. **Never include `correct`,
  `ai_picked` or `answer_line`.**
- If all 5 are answered, finish the play (§8.6) and return `{ done: true, result: <Result> }`.

### 8.5 `POST /api/game/answer` — body `{ playId, position, choice }` (`choice` is `'A'|'B'|'C'|null`)

- The answers row for `(playId, position)` must exist and be unanswered, else 409.
- `late = now() > served_at + 16.5 s`. If late, treat as a timeout (`choice = null`).
- Set `answered_at = now()`, `choice`, `is_correct = (choice === correct)`.
- Respond `{ position, choice, correct, isCorrect, aiPicked, aiCorrect, answerLine, score: { you, ai } }`, where
  `score` counts the answers so far (the AI's score counts its correct picks for the positions answered so far).
- If this was position 5, also finish the play (§8.6) and include `result`.

`POST /api/game/quit` — body `{ playId }`: record every remaining position as a timeout and finish the play.

### 8.6 Finishing a play and the `Result`

Set `finished_at = now()`, `score` = correct answers, `ai_score` = AI's correct picks over all 5. Then:

```ts
type Result = {
  dayNumber: number;
  mode: 'daily' | 'archive';
  you: number;                 // 0..5
  ai: number;                  // 0..5
  tiles: Array<'right' | 'wrong' | 'timeout'>;   // the player's 5
  aiTiles: Array<'right' | 'wrong'>;             // the AI's 5
  percentile: number | null;   // daily only, and only when >= 10 finished daily plays today; else null
  playersToday: number;        // finished daily plays for this day
  streak: { current: number; max: number; milestone: number | null } | null; // daily only
};
```

- `percentile` = `percentileBeaten(score, allScoresToday)` (§9.2) over finished **daily** plays of this day.
- `streak` = `streakFrom(datesPlayed, nyToday())` (§9.2) over the NY dates of this player's finished **daily** plays.

### 8.7 Sync

`syncDays()`:
1. `after` = the latest `ny_date` in `game.days` minus 3 days (catches late fixes), or omitted if the table is empty.
2. Fetch the hub export (or the fixture). Timeout 15 s.
3. For each day: validate (§6.3); upsert `game.days` (`ai_label` = the first question's `ai.label`) and its 5
   `game.questions`. **Never change a day that already has plays** (skip it, log it).
4. Return `{ imported, skipped, errors }`.

`GET /api/game/sync`: requires `Authorization: Bearer ${CRON_SECRET}` (else 401); runs `syncDays()`.
Add a cron to `vercel.json`: `{ "path": "/api/game/sync", "schedule": "5 5 * * *" }` (05:05 UTC daily, just after
midnight New York in winter; the on-demand sync in §8.2 covers summer time and any delay).

### 8.8 `PlayState`, `GET /api/game/me`, `GET /api/game/days`

`PlayState = { playId, dayNumber, mode, answered: number, finished: boolean, result: Result | null }`.

`GET /api/game/me` → `{ played, wins, currentStreak, maxStreak, distribution: number[6] }` over this player's
finished plays (wins = `score > ai_score`; streaks from daily plays only; `distribution[k]` = plays with score k).

`GET /api/game/days` → past days, newest first: `[{ dayNumber, nyDate, result: { you, ai, tiles } | null }]`.

### 8.9 `vercel.json` changes

- Change the SPA rewrite so it does not swallow `/api`: `{ "source": "/((?!api/).*)", "destination": "/index.html" }`.
- Add redirect `{ "source": "/play", "destination": "/free-tools/smarter-than-ai?utm_source=share", "permanent": false }`.
- **Remove** the temporary redirect `/free-tools` → `/free-tools/ai-networking-events` (there are now two tools).
- Add the cron (§8.7).

---

## 9. Shared code (VERBATIM)

### 9.1 `api/_lib/time.ts` (also copy to `src/game/time.ts` for the countdown)

```ts
/** The New York calendar date (YYYY-MM-DD) of an instant. */
export function nyDate(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const nyToday = () => nyDate(new Date());

/** Milliseconds until the next midnight in New York. */
export function msUntilNextNyMidnight(now: Date = new Date()): number {
  const today = nyDate(now);
  // Step forward a minute at a time from now + 1 min until the NY date changes, then refine to the second.
  let t = now.getTime() + 60_000;
  while (nyDate(new Date(t)) === today) t += 60_000;
  t -= 60_000;
  while (nyDate(new Date(t)) === today) t += 1_000;
  return t - now.getTime();
}

/** The day before a YYYY-MM-DD date. */
export function previousDate(d: string): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() - 1);
  return x.toISOString().slice(0, 10);
}
```

### 9.2 `api/_lib/rules.ts`

```ts
import { previousDate } from './time';

export const QUESTION_SECONDS = 10;
export const GRACE_SECONDS = 1.5;
export const PERCENTILE_MIN_PLAYERS = 10;
export const STREAK_MILESTONES = [3, 7, 30, 100];

/** The share of other players' scores strictly below yours (ties count half), as a whole percent. */
export function percentileBeaten(score: number, all: number[]): number | null {
  if (all.length < PERCENTILE_MIN_PLAYERS) return null;
  const below = all.filter((s) => s < score).length;
  const same = all.filter((s) => s === score).length - 1; // not counting yourself
  const others = all.length - 1;
  if (others <= 0) return null;
  return Math.round(((below + same / 2) / others) * 100);
}

/**
 * Streak from the NY dates (YYYY-MM-DD) of finished daily plays. `today` is the current NY date.
 * The current streak counts back from today, or from yesterday if today is not played yet.
 */
export function streakFrom(dates: string[], today: string): { current: number; max: number; milestone: number | null } {
  const set = new Set(dates);
  let start = set.has(today) ? today : previousDate(today);
  let current = 0;
  while (set.has(start)) {
    current++;
    start = previousDate(start);
  }
  const sorted = [...set].sort();
  let max = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && previousDate(d) === prev ? run + 1 : 1;
    max = Math.max(max, run);
    prev = d;
  }
  const milestone = set.has(today) && STREAK_MILESTONES.includes(current) ? current : null;
  return { current, max: Math.max(max, current), milestone };
}
```

### 9.3 `src/game/share.ts`

```ts
export type Tile = 'right' | 'wrong' | 'timeout';

const EMOJI: Record<Tile, string> = { right: '🟩', wrong: '🟥', timeout: '⏱️' };

export function shareText(dayNumber: number, tiles: Tile[], you: number, ai: number): string {
  return [
    `Are you Smarter Than AI? #${dayNumber}`,
    tiles.map((t) => EMOJI[t]).join(''),
    `Me ${you} · AI ${ai}`,
    'heliosgroup.ai/play',
  ].join('\n');
}

/** A small stable hash (for the staged lock-in moment). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const lockInSeconds = (questionId: string) => 2.5 + (hashString(questionId) % 40) / 10;
```

(The server computes `lockInSeconds` with the same function: copy `hashString` and `lockInSeconds` into
`api/_lib/rules.ts` too.)

### 9.4 `src/game/sfx.ts`

```ts
let ctx: AudioContext | null = null;
const MUTE_KEY = 'helios.game.muted';

export function isMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}
export function setMuted(m: boolean): void {
  try { m ? localStorage.setItem(MUTE_KEY, '1') : localStorage.removeItem(MUTE_KEY); } catch { /* ignore */ }
}
/** Call from the first user tap (the PLAY button). */
export function unlockAudio(): void {
  if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (ctx.state === 'suspended') void ctx.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime + start);
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.02);
}

export type Sfx = 'tick' | 'tap' | 'right' | 'wrong' | 'lock' | 'fanfare' | 'streak';

export function play(s: Sfx): void {
  if (isMuted() || !ctx) return;
  switch (s) {
    case 'tick': return tone(1200, 0, 0.04, 'square', 0.05);
    case 'tap': return tone(600, 0, 0.05, 'triangle', 0.12);
    case 'lock': return tone(420, 0, 0.08, 'sine', 0.15);
    case 'right': tone(1047, 0, 0.12, 'sine', 0.25); return tone(1319, 0.09, 0.22, 'sine', 0.25);
    case 'wrong': return tone(150, 0, 0.25, 'triangle', 0.35);
    case 'fanfare': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.25, 'sine', 0.22)); return;
    case 'streak': [784, 988, 1175].forEach((f, i) => tone(f, i * 0.08, 0.2, 'triangle', 0.2)); return;
  }
}

export function buzz(pattern: number | number[]): void {
  if (isMuted()) return;
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
}
```

---

## 10. Milestones (in order; each ends with its acceptance checks)

### M0 — Setup
Worktree, dependencies, env vars, `vitest` (§4). **Accept:** `npm run build` passes; `npx vercel dev` serves the
site; `GET /api/game/today` returns JSON (any error JSON is fine at this point).

### M1 — Database
`supabase/game_schema.sql` (§7), applied by Lucas; `game` schema exposed. **Accept:** a test function or script
can `select` from `game.days` with the service role and gets 0 rows.

### M2 — Sync with the fixture
`api/_lib/{supabase,hubTypes,fixture,time,rules,sync}.ts`, `api/game/sync.ts` (§6, §8.7). **Accept:** with
`GAME_SOURCE=fixture`, calling `/api/game/sync` with the cron secret imports 3 days and 15 questions; calling it
again imports 0 and changes nothing; a day with 4 questions (try it by editing the fixture) is rejected and logged.

### M3 — Game API
`today`, `day`, `start`, `next`, `answer`, `quit`, `me`, `days` (§8). Unit tests (`vitest`) for `percentileBeaten`,
`streakFrom`, `nyDate`, `msUntilNextNyMidnight`, `shareText`, `lockInSeconds`. **Accept (with curl or a small
script):** a full play of today returns 5 questions one at a time, none containing `correct`; answers return the
correct letter, AI pick and `answerLine`; a sixth `next` returns `done`; a second `start` for today returns the
finished play; an answer sent 17 s after `next` is a timeout; `next` called twice without answering returns the
same question with fewer seconds left.

### M4 — Start, question and reveal screens (no critter yet: a grey 110 px placeholder box)
§5.1–5.5, §5.8–5.9. **Accept on a phone-sized viewport (390 × 844):** PLAY → 3-2-1 → five questions → results
placeholder; the timer bar and last-3-seconds behavior; right/wrong/timeout reveals; AI badge; why line; auto
advance with the hold line; tap skips after 700 ms; keyboard 1/2/3; mute persists after reload; refresh
mid-question resumes with the clock still running.

### M5 — The critter
§5.7. **Accept:** the critter waves on the start screen, thinks during questions, pops at the staged lock-in,
celebrates/deflates on each reveal; reduced-motion shows still frames; the kit loads only on game routes (check
the network panel on the home page: no `cast.js`).

### M6 — Results
§5.6 (verdict, score count-up, tiles, percentile/players-so-far, streak and milestones, share, countdown, stats
sheet, soft events link). **Accept:** share text matches §9.3 exactly; on desktop it copies with a toast; the
countdown reaches 0 and offers today's game; replaying today shows results, not a new game.

### M7 — Archive
§5.10, `/archive` and `/day/:n` routes. **Accept:** with the fixture, the archive lists 2 past days; playing one
shows results without percentile or streak and does not change the streak; it cannot be played twice.

### M8 — Free Tools, popup, nav, sitemap, analytics
- `src/app/data/freeTools.ts`: add (first in the list, the game is the newer, lighter hook):
  `{ slug: 'smarter-than-ai', name: 'Are you Smarter Than AI?', blurb: '5 questions a day against the AI. 15 seconds each. One shot. Can you beat it?', icon: Brain (lucide), route: '/free-tools/smarter-than-ai', cta: "Play today's game", tags: ['New every day', '1 minute', 'Free'] }`.
  With two tools, `hasSingleFreeTool` is false and links switch to the `/free-tools` index on their own (read the
  comment in that file).
- `vercel.json` (§8.9) and `public/sitemap.xml`: add `/free-tools` and `/free-tools/smarter-than-ai`.
- `FreeToolsPopup.tsx` (the social-landing popup): keep its trigger, dismissal and tracking. New content:
  eyebrow `Free for the AI community`; title `Two free tools for you`; then two stacked tappable cards (no body
  paragraph):
  1. Game card: critter thumbnail (static `wave` frame), `Are you Smarter Than AI?`, `Today's 5 questions · 1 minute`, CTA `Play →`
  2. Calendar card: calendar icon, `AI Networking Events Calendar`, `This week's AI events in 4 cities`, CTA `Open →`
  Both links keep the existing attribution query (`attributionQuery` in `src/lib/analytics.ts`). Track
  `popup_cta` with a `tool` property (`smarter-than-ai` or `ai-networking-events`).
- `src/lib/analytics.ts`: add events `game_view`, `game_start` (`{ mode }`), `game_finish`
  (`{ mode, you, ai }`), `game_share`, `game_archive_open`, `game_events_link`.
**Accept:** `/social-landing` popup shows both cards and each opens its tool with the utm query; `/free-tools`
lists both tools; header/footer "Free Tools" link goes to the index.

### M9 — Switch to the hub, QA, ship
- Set `GAME_SOURCE=hub` (after Claude confirms the hub export is live) and run the sync once.
- QA on a real iPhone (Safari) and an Android phone (Chrome): every acceptance check above, sound after the
  first tap, mute, vibration on Android, share sheet, landscape does not break, slow 3G (the reveal spinner).
- Lighthouse on the game route: no console errors; the critter loop pauses when the tab is hidden.
- Ask Lucas before deploying to Production (`npm run deploy:prod`). Do not deploy on your own.

---

## 11. Things that must never happen (checklist before you call it done)

- [ ] A correct answer, `ai_picked` or `answer_line` reaches the browser before that question is answered.
- [ ] A secret appears in `src/` or in any `VITE_` variable.
- [ ] A future day (after today in New York) is playable or listed.
- [ ] A day that already has plays is changed by a sync.
- [ ] Today can be played twice on one device without clearing storage.
- [ ] An archive play changes the streak or today's percentile.
- [ ] A screen shows more than one sentence of explanation.
- [ ] The critter appears as the player, or the AI's pick shows before the player answers.
- [ ] `GAME_SOURCE=fixture` in Production.
- [ ] Anything deployed to Production without Lucas's go-ahead.

---

## 12. Open items for the hub side (Claude, not Cursor)

Listed so Cursor knows what is coming, not to build:

1. Supply: content-map cells hold many questions (Lucas: "Cells hold many questions"); never-repeat checked by
   fact; ~6 new pooled questions a day.
2. The daily game set: 5 fact-checked questions not used by the IG story, each answered once by GPT-5 nano
   (no web search), chosen so the AI usually scores 3 of 5 (D9), ordered easiest first; built the day before,
   reviewable by Lucas until 11 pm NY, then locked and exported; Day 1 = launch day. Details: the hub plan
   (`planning/AI Trivia/Game/HUB-PLAN.md` in The Helios Hub).
3. The export endpoint (§6) with `HUB_GAME_EXPORT_TOKEN`.
4. Cost: an estimated $0.50–0.70 a day for the pipeline at 6 questions a day (today: ~$0.20 for 1). Confirmed
   with Lucas before it runs.
