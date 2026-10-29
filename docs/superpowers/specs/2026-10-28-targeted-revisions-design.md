# Targeted Revisions: Design

Date: 2026-10-28. Status: draft for Tommy's approval. Nothing here is built.

## Intent

Generated posts are often close but not right: one frame repeats a photo, one color is off, one line reads badly. Today the only remedy is Regenerate, which throws away the whole set. Tommy wants to type what is wrong, in his own words, into a box inside the post, and have **only that part** redone while everything else stays untouched.

Motivating example: the Morning Download Story set repeated the same Dario Amodei photo on two frames. The fix is "frame 3 repeats frame 1's photo, use a different one", and nothing else about the set changes.

Every revision also leaves a log entry. The log exists so that, later, recurring complaints can be studied. It is evidence only.

## Goals

1. One shared revision engine used by every content type, not one system per type. Each type supplies a small, code-defined description of itself (see Architecture).
2. Content types in the first build: **Carousels, IG Stories, Text on screen, Explainers, Last Few Days, AI Events.**
3. Revisions may change: photo, wording, color/backdrop, and layout/crop. For Text on screen: wording, background image, motion/video, and color treatment.
4. A text box inside the post view. Tommy types a sentence; a model turns it into a structured request; code does the work.
5. One shared revision log across types, with the content type as a field.
6. Every revision is undoable, and the pipeline's original version is always recoverable.

## Non-goals

- No bi-weekly review, trend analysis, or digest. Logging only, for now.
- Nothing ever edits prompts, gates, or pipeline code from the log. The log never triggers changes.
- No automatic fixing of the pipeline's own bugs (for example, adding a "no repeated photo within a set" check is a separate decision, not part of this project).
- No handling of two people revising the same piece at the same moment.
- Published posts are not revisable.
- Nothing is posted or approved by this feature. Nothing posts without human approval.

## Anti-goals

(Tommy had none beyond the above when asked.) Working guidance from earlier decisions: a revision must not change parts the user did not ask about, and must not quietly spend beyond its cap.

## How it behaves

**Submitting.** In the post view the user types a sentence into a revision box. Clicking submit is the authorization for that one revision's spend (Rule 1: a human click, not an agent run).

**Interpreting.** Haiku 5.5 reads the sentence together with the **whole post** (all frames/slides/scenes: text, photo credits, and the images or their descriptions) and returns a structured request: content type, target part (frame, slide, scene, or stage), fix kind (photo, wording, color, layout, motion), and a stage tag for the log. If the sentence is unclear or could mean several things, the system **asks the user back** and spends nothing on the redo until it is clear. The Haiku call must use prompt caching (static instructions and schemas first, per-request post content last, per `lib/anthropic-cache.ts` and `docs/prompt-caching.md`).

**Doing the work.** Code, not the model, performs the redo, using the per-type description. Only the targeted part is regenerated. Other parts are untouched.

**Gates.** A revised part must still pass that type's gates (fact-check on changed wording, photo-repeat rules, render fit, and so on). If a reworded part fails the fact-check, the revision is **blocked** and the user is told why; the user can rephrase. If the fix cannot be done (for example, no other usable photo), the **original is kept** and the user is told what was tried and why it failed.

**Result.** The new version replaces the old one in place, and the user can **undo**. Any number of revisions per part; every prior version, including the pipeline's original, stays recoverable.

**Approval.** A revision to an approved or scheduled post sends the post **back to review** (un-approves it). Posts already published cannot be revised. Any hub user may revise.

**Waiting.** Revisions run on the worker, not on Vercel. Submitting queues a request; the post view shows a "revising..." status and updates itself when done. The user can leave and come back.

**Cost.** The click authorizes the revision's spend, bounded by a **per-revision cap that depends on the content type**. If a revision would exceed its cap it stops and shows the estimate; the user can **override in the post view** to allow a higher amount for that one revision. Cap values are proposed in this design for Tommy to approve (see Open items).

Each type also has a **ceiling** above its cap. When a revision reaches its type's ceiling, the work pauses and a **notification** is sent; the user can then choose to keep going from there. (Tommy's words: "ceiling per type, and once it is hit there's a notification and you can keep going from there." My reading, flagged for him to check: the ceiling is a pause-and-notify point, not an absolute block, and continuing needs another explicit go-ahead from the user. Ceiling values are proposed together with the caps.) Cap and ceiling values live in config, not code.

## The log

One shared table across all types, keyed to the content item on the existing `social_hub.content_items` spine, with a type-specific target (frame seq, slide index, scene, or stage). Each entry records:

- the user's exact words
- fix type and likely pipeline stage (tagged automatically by the Haiku call)
- the part's **before and after** (copy, photo, colors, rendered file path), so the log also serves as the version history behind undo
- cost, and outcome (accepted, undone, blocked, failed, or asked-back)
- who, when, and the content type

Per-type views of the log are filters on this one table.

## Architecture

**Shared engine:** the revision box UI, the request queue, Haiku interpretation, the log, undo/version restore, the cap and override logic, and the back-to-review step.

**Per-type description (code, one per type):** declares what a piece is made of, which parts can be redone on their own, what each fix kind costs, which gates apply, and how to redo a part. The engine reads these descriptions. Adding a type means adding a description, not a system.

**Execution:** Vercel's API only inserts a `requested` row (the existing pattern: `finish_requests`, `rerun_requests`, `ai_events.runs`); the social worker claims and runs it. Worker-side logic therefore changes and must be redeployed with `./scripts/gcp/deploy-social-worker.sh` (schema applied first, per `docs/social-overnight.md`). The orchestration VM is not involved.

**Hooking into existing structure:** add a `revise` verb alongside approve/reject/regenerate in `ContentActions` (`lib/publishing/actions/types.ts`) and route it through the existing `contentAction` handler (`app/api/social-hub/actions/content-action.ts`). Back-to-review reuses the existing per-type unschedule primitives (`unscheduleItem` and wrappers).

### Per-type findings from code recon (2026-10-28)

| Type | Unit | Native storage | Cheapest redo | Notes |
|---|---|---|---|---|
| Carousels | slide, `render.slides[i]` in `social.posts` | `slide_objects` JPEG paths | Render only: 0 model calls. Copy edit adds a Sonnet fact-check. Photo swap: one photo-chain call. | No per-slide path exists. Photo alternates are in memory only; a swap re-runs the finder excluding URLs in the post. |
| IG Stories | frame, row in `stories.frames` | `photo`, `copy`, `backdrop`, `template`, JPEG | Photo swap: finder + one frame re-render, no copy/rank/ground calls. Wording: Sonnet rewrite + Jev grounding. | No per-frame redo exists; `saveFrameRender` is the only per-frame write. No assertion that all frame photos in a set are distinct. Render review cannot change words. Set-level `stories.feedback` has no frame column. |
| Text on screen | whole frame + clip; redo by stage (copy / frame / video) | `reels.idea_copy`, `visual_jobs`, `video_jobs` | Wording-only needs **new code** (re-lay the text plate over the stored clip: ffmpeg only). Frame redo: scene writer + image model + color route, then video. | Only today's slate can be rebuilt; reels in `reel_locks` are refused. One-in-flight indexes block concurrent work. Grade comes from a Jev call and is not stored. |
| Explainers | scene (files on the worker VM, not rows) | `/opt/helios-social/explainers/jobs/<id>` | One paid agent session (priciest of the six) plus caption. Existing `resume` path is unused code. | Job folders must be **retained until the explainer is published or 7 days, whichever is earlier**, so a scene redo stays possible. |
| Last Few Days | story slide, `stories[i]` in `lfd.posts` | `slide_objects` | Render only: 0. Copy edit: Sonnet + Jev grounding. Photo swap: finder + Haiku vision. | Has no `regenerate`. `approvePost` books only while `publishing_live`. |
| AI Events | slide, `render.slides[i].aiEvents` | `slide_objects` | 0 model calls (local render). | No Claude call anywhere in the type. Existing rebuild redoes both cities; a per-slide patch should not. Existing `regenerate` does not unschedule; revisions must. |

## Constraints

- **Rule 1 / Rule 2 (CLAUDE.md):** automated tests and agent runs never call the live Claude API or `web_search`; real behavior is tested by Tommy clicking the built feature. Tests stub the model with canned responses and use tiny (1-2 item) fixtures. This feature never sweeps or enriches existing database rows; it acts on one user-selected piece at a time.
- **Prompt caching** is mandatory for the Haiku interpreter call.
- **Read-only DB checks** use `BEGIN READ ONLY; ...; ROLLBACK;` and never a session `SET` through the pooler.
- **Worker sync:** any worker-side change redeploys `helios-social-worker` in the same session.
- Terminology: the content type is called **text on screen** in all labels, logs, and UI (never "trial reels"). Existing code identifiers need not be renamed.
- Posting is currently off; the design must still behave correctly when publishing is turned on (published posts locked, approval reset).

## Decisions made by Tommy

All decisions in "How it behaves" and "Goals" above, including: six types in the first build, one adaptable engine, Haiku 5.5 as interpreter with whole-post context, ask-back on ambiguity, replace-with-undo, many revisions with original always kept, log contents (exact words, fix type and stage, before/after, cost and outcome), back-to-review on approved/scheduled posts, published posts locked, any hub user, fact-check failure blocks, failed fix keeps the original, click authorizes spend with a per-type cap and in-post override (caps proposed by me for approval), explainer folders kept until published or 7 days (earlier), status shown while revising, concurrent revisions not handled.

Also decided by Tommy after the builder check: any hub user can revise any unpublished post, even if that resets another user's approval (intended, no notification or approval-rights rule); the original is the pipeline's output at generation time.

## Calls made by me (not yet seen by Tommy; check these)

- **Undo never re-approves.** Undoing a revision on a post that went back to review leaves it in review.
- **Old rendered files are never overwritten or garbage-collected** while a log entry references them. Each type needs a versioned path or copy-on-revise step for its rendered files (how is left to the builder).
- **Locked or ineligible items are refused with a clear message.** Text on screen reels in `reel_locks` cannot be revised. The revision path uses its own re-render step, so it is not limited to today's slate and does not go through `requestFinish`.
- **Explainers past retention are refused.** If the job folder is gone, the revision is refused with a message. Explainers that already exist whose folders are gone are not revisable. The retention change (keep folders until published or 7 days, whichever is earlier) is new worker-side cleanup policy and part of this project.
- **Stage tags are a fixed list per content type**, derived from that type's description, and used in both the log schema and the Haiku structured-output schema, so the log stays analyzable later.
- **Ask-back is not a conversation thread.** The user's reply is a new submission that carries the earlier sentence and the question as context; each attempt is its own log row, linked to the previous one.
- **Cap, ceiling, and estimate logic is config-driven** with a cost estimator per fix kind; placeholder numbers are replaced by the values Tommy approves.

## Left to the builder

File layout, table and column names, the exact structured-request schema, how images are shown to Haiku, how undo restores each type's rendered files, the queue and claim mechanism, and test design.

## Open items

1. **Per-type spend caps:** to be proposed by me and approved by Tommy. (My call: derive each from the type's real redo cost, with a low cap for the render-only types and a higher one for Explainers and Text on screen video.)
2. **Post-view screenshot:** Tommy offered to supply one so the box matches the real UI. Not received yet; the builder should look at the real post views.
3. **Latent bugs found, out of scope:** no assertion that Story frame photos in a set are distinct; stale "2.5 Turbo" text in `motion-writer.ts`; `ai-events` regenerate does not unschedule; Last Few Days lacks regenerate.
