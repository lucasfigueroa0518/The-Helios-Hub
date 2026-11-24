# Handoff — settings standard (2026-11-21)

Read first: `CLAUDE.md`, then `PLAN.md` (decisions D1–D19), `CONTRACT.md`, `BUILD.md` in this folder.

## State
- **Built and pushed** on branch `main-l2xadw`: one state per type (Paused | Approval | Live) in each type's Settings
  tab; approval always required; only Live posts; refill in every state on per-type caps (D19) plus a $5 nightly total
  (`lib/content-type/refill-total.ts`, editable on the Social Hub Cost page); pause / slot-passed → back to Made, still
  approved, never re-slotted automatically (D17, D18); approved while Paused stays in Made (`paused-hold` marker).
- **Migration applied** (2026-11-20, `db/settings_standard_states.sql`) and verified: Carousels, AI Trivia, Real or AI?
  = Paused; Text on Screen, Explainers, AI Drama, Last Few Days, AI Events, Field Notes, Morning Download = Live.
  Refill caps set, `refill_total_cap_usd` = 5, ledger `social_hub.refill_spend` created.
- **Tests:** typecheck 0 errors; affected suites green; the only failures also fail before the build
  (explainers-render, reel-ai-drama-writing, revisions-explainers start-up recovery, a few that need local tools).

- **D20 built (2026-11-22):** Settings covers nothing the Calendar covers: no daily limit (the calendar's slots are the
  count, bounded by each type's fixed maximum), one Schedule line + "Edit in Calendar". Needs a social worker redeploy
  (the slot scheduler reads the ceilings).

- **D21 built (2026-11-23):** Explainers and AI Drama Settings show a short list plus "Advanced settings"; Explainers'
  daily spend cap applies in every mode. Needs a social worker redeploy (the Explainers night and render request read it).

## To do (in order)
1. ~~**Deploy the social worker**~~ — **done 2026-11-22 03:29 UTC**: all six units active, no restarts, no warnings. (All content-type workers + publisher run on `helios-social-worker`; the orchestration
   VM runs none of the changed code): on `main-l2xadw`, clean tree, gcloud logged in, `.env.local` present:
   `./scripts/gcp/deploy-social-worker.sh`. Don't force past its guards (run in flight / dirty tree). Check its output.
2. **Merge to main** (Lucas) so the Settings tab and Cost page control reach Vercel. Never merge to main yourself.
3. **Tommy clicks through** every type's Settings tab. Next night: check logs — every pool refills (Carousels included),
   no `quota-filled` refill skips, total refill spend ≤ $5 (`social_hub.refill_spend`).
4. ~~**Rename "Auto-publish readiness"**~~ — **done**, Tommy said yes: Health rings label, ring hover card
   ("publish-readiness bar") and Cost page note now say publish readiness. Code constant `AUTO_PUBLISH_BAR` unchanged.
5. Optional polish: the `paused-hold` marker shows as a cancelled entry in a post's history; a `cancelNote` mapping
   could label it nicely.

## Hard rules (also in CLAUDE.md)
No live Claude / web_search spend without asking with an estimate. Read-only DB checks as
`BEGIN READ ONLY; …; ROLLBACK;`, never a session-level SET on the pooler. Nothing posts without approval. Don't
create/switch branches or merge to main unless told. Say "Text on Screen" in UI text, not "Trial Reels".
