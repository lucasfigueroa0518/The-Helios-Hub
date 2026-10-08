# v2 pipeline run — 2026-09-29T03-38-05-457Z

- Article: `fab9b61a-9653-4208-b7b4-7b8ec7340aa9` — Google’s new ‘CC’ is an AI agent that helps families run their households
- From-brief mode: yes (Reporter + fetchPage stubbed from cached brief.json)
- Status: **needs_human_review**
- Reason: char_limit / highlight_substring errors survived every repair try across 1 round:
SLIDE 2 BODY (221 characters, limit 220): cut at least 1 characters (about 1 words). Cut a whole clause or sentence rather than rewording.
SLIDE 4 BODY (222 characters, limit 220): cut at least 2 characters (about 1 words). Cut a whole clause or sentence rather than rewording.
SLIDE 11 and SLIDE 10 are both "text" slides. Two slides in a row of the same kind reads as repetition. Change one to a different kind (Text / Landing / Stat / Split stat / Quote / Image) or merge them.
- Total cost: **$0.6274**
- Stages run: reporter → writer → editor → image-step → caption → editor(check-errors r1.1) → editor(check-errors r1.2) → caption(fix-notes r1.1) → fact-checker(r1)

## Reporter

- Stop reasons: `tool_use, end_turn`
- cost $0.1605 (in 17630, cache_read 8775, cache_write 13982, out 2172, 2 web_search)

### BRIEF (raw, as returned)
```
SINGLE STORY: Yes

---

THE NEWS:
On September 17, 2026, Google Labs announced a major update to its experimental AI agent CC, reshaping it from a personal productivity tool into a shared household agent that up to six family members can use together to manage schedules, tasks, emails, and logistics.

---

THE STORY:
Google Labs announced on September 17, 2026 that its experimental AI agent CC is being repositioned as a tool for families and households. The announcement was made in a blog post by Tom Shane, Senior Product Manager at Google Labs.

**What CC is and where it came from**
CC began as a personal productivity agent that connected to Gmail, Google Calendar, and Google Drive to give individual users a daily briefing — "Your Day Ahead" — delivered to their inbox. Google later brought a version of it to the Gemini app in May 2026, under the name "Daily Brief." There is a minor discrepancy in the sources about CC's original launch date: TechCrunch does not give a precise date; SiliconAngle and Thurrott both say it launched "in December" (implied December 2025); HotHardware says it "debuted in September 2025." The Google blog post itself does not state the original launch date. The sources agree it predates the May 2026 Gemini/Daily Brief integration.

**Why the pivot**
Google says the shift came from user behavior. Tom Shane wrote in the blog post: "One of our top user requests was for CC to do more to help run a busy home." The company said household coordination — school schedules, sports practices, bills, meal plans — is a shared responsibility made harder when information is spread across multiple personal accounts.

**What the new CC does**
The updated CC gets its own verified Google account, giving it a distinct identity when it shows up in inboxes or chat threads, and a clear permissions model. Up to six family members can join a single CC group. Crucially, each member individually chooses what to share — CC only sees what each person opts in.

Sharing works in three ways: members can forward one-off emails or photos (e.g., a picture of a birthday invite or a soccer schedule) via email or Google Chat; they can set up auto-sharing from specific senders (e.g., a school, a sports club, a travel company) so all future messages from those senders go to CC automatically; or they can share Drive folders and calendars directly. Each week, CC also suggests new email senders for members to approve or ignore.

From that shared information, CC produces a daily "Your Day Ahead" brief for the whole group, showing who needs to be where, what tasks are pending, and what CC handled the day before. It also writes dates and to-dos directly into a shared family calendar and task list, keeping them updated as plans change.

Beyond organizing, CC can take action: it can pre-fill permission slip and activity registration PDFs, build school supply shopping lists, draft weekly meal plans, check live drive times from Google Maps between back-to-back activities, and create shared Google Docs and Sheets. When it needs more information to complete a task, it asks. It builds a shared household memory — retaining things like a family's go-to grocery list or favourite restaurants — while keeping individual members' private preferences separate.

**Privacy and safety guardrails**
Google says CC responds only to group members and will not take action or share information outside the group without permission. Each member can change what they share with CC at any time.

**Under the hood**
Google says every CC runs on its own isolated cloud computer, powered by its Gemini models and its agentic harness called Antigravity.

**Availability and limits**
The experiment is currently limited to U.S. users aged 18 and over with a personal Gmail account — school-provided email accounts are not supported. TechCrunch notes this is a significant drawback: it means older kids (tweens and teens) cannot use the service, and it excludes the school-provided Google accounts that many students rely on for school communications. Existing CC users will receive an email invitation to upgrade in the coming days; new users can join a waitlist.

**Market context**
TechCrunch notes that CC's family pivot comes as several AI startups are experimenting with agentic AI for consumers, with tools like Ollie and Fambot specifically targeting parents and families.

---

TERMS:

- **CC**: Google Labs' experimental AI agent, now repositioned as a shared household assistant for up to six family members; works across Gmail, Google Calendar, Google Drive, Google Chat, and other Google tools.
- **Google Labs**: Google's internal team for early-stage, experimental products.
- **Gemini**: Google's AI model family that powers CC.
- **Antigravity**: Google's agentic harness (internal infrastructure) that CC runs on, described in this context as the system that allows CC to carry out actions like opening forms, pulling data from Google Maps, and creating documents. (Note: sources in this story describe it as an agentic harness for running tasks; its broader definition is not sourced from the CC announcement.)
- **Daily Brief**: The name given to a version of CC's "Your Day Ahead" feature when it was brought to the Gemini app in May 2026; distinct from, though related to, the new family CC product.
- **Agentic AI / AI agent**: An AI that doesn't just answer questions but can take actions on a user's behalf — like filling out a form, updating a calendar, or sending information — with some degree of autonomy.
- **"Your Day Ahead"**: The name of the morning briefing CC delivers to family members, summarising the day's schedule, pending tasks, and what CC completed the day before.
- **Ollie / Fambot**: AI tools from other companies (not Google) that have targeted parents and families with household management features; mentioned by TechCrunch as competitors in the consumer agentic AI space.

---

IMAGES:
The Google blog post includes images credited to Google (screenshots of the CC interface showing the shared brief, calendar event creation, form-filling, and sharing controls), but fetching the page did not return direct image file URLs — only the page itself. I cannot confirm direct image links.

None found (no direct image file URLs retrieved).

---

SOURCES:

1. **Google Blog (Google Labs)** — Tom Shane, Senior Product Manager. "The new CC, an AI agent built for families." Published September 17, 2026. https://blog.google/innovation-and-ai/models-and-research/google-labs/cc-expanding-to-groups/

2. **SiliconAngle** — Duncan Riley. "Google expands CC into a shared AI agent for up to six family members." Published September 17, 2026. https://siliconangle.com/2026/09/17/google-expands-cc-into-a-shared-ai-agent-for-up-to-six-family-members/

3. **TechCrunch** — "Google's new 'CC' is an AI agent that helps families run their households." Published September 18, 2026. https://techcrunch.com/2026/09/18/googles-new-cc-is-an-ai-agent-that-helps-families-run-their-households/
```

## Source fetches
- ✅ https://blog.google/innovation-and-ai/models-and-research/google-labs/cc-expanding-to-groups/ (4729 chars)
- ✅ https://siliconangle.com/2026/09/17/google-expands-cc-into-a-shared-ai-agent-for-up-to-six-family-members/ (4210 chars)
- ✅ https://techcrunch.com/2026/09/18/googles-new-cc-is-an-ai-agent-that-helps-families-run-their-households/ (4073 chars)

## Substantive-source filter (caption "Source:" line)
- Threshold: ≥ 1500 chars of fetched text
- Kept: 3 | Dropped: 0
  - https://blog.google/innovation-and-ai/models-and-research/google-labs/cc-expanding-to-groups/
  - https://siliconangle.com/2026/09/17/google-expands-cc-into-a-shared-ai-agent-for-up-to-six-family-members/
  - https://techcrunch.com/2026/09/18/googles-new-cc-is-an-ai-agent-that-helps-families-run-their-households/

## Brief-image validation
- Kept: 0
- Dropped: 0

## Writer — DRAFT
- Stop reasons: `end_turn`
- cost $0.0406 (in 3, cache_read 0, cache_write 6738, out 1024)

### Slides
- **COVER** (67 chars, limit 100)
  - TEXT: Google built CC for one person. Now it's managing the whole family.
  - HIGHLIGHT: managing the whole family
  - IMAGE: type only
- **SLIDE 2**
  - HEADLINE (37 chars, limit 60): CC is Google Labs' household AI agent
  - BODY (187 chars, limit 220): Google Labs announced on September 17 that CC, its experimental AI agent, is being repositioned from a personal productivity tool into a shared assistant for families of up to six people.
  - HIGHLIGHT: shared assistant for families
  - IMAGE: type only
- **SLIDE 3**
  - HEADLINE (38 chars, limit 60): It started as a daily briefing for one
  - BODY (256 chars, limit 220): CC began as a personal agent connected to Gmail, Google Calendar, and Google Drive. Each morning it sent one user a "Your Day Ahead" email summarising their schedule. In May 2026, Google brought a version of it to the Gemini app under the name Daily Brief.
  - HIGHLIGHT: Your Day Ahead
  - IMAGE: type only
- **SLIDE 4**
  - HEADLINE (35 chars, limit 60): One CC, shared across the household
  - BIG NUMBER (9 chars, limit 12): 6 members
  - IMAGE: type only
- **SLIDE 5**
  - HEADLINE (20 chars, limit 60): Users asked for this
  - BODY (184 chars, limit 220): Google says the shift came from user behavior. Senior Product Manager Tom Shane wrote in the announcement: "One of our top user requests was for CC to do more to help run a busy home."
  - HIGHLIGHT: help run a busy home
  - IMAGE: type only
- **SLIDE 6**
  - HIGHLIGHT: information spread over multiple user accounts
- **SLIDE 7**
  - HEADLINE (24 chars, limit 60): You control what CC sees
  - BODY (276 chars, limit 220): Each family member separately decides what to share. They can forward one-off emails or photos, set up auto-sharing from specific senders like a school or sports club, or share Drive folders and calendars directly. Each week, CC also suggests new senders to approve or ignore.
  - HIGHLIGHT: Each family member separately decides what to share
  - IMAGE: type only
- **SLIDE 8**
  - HEADLINE (20 chars, limit 60): Then CC gets to work
  - BODY (288 chars, limit 220): From the shared information, CC produces a daily brief for the whole group, writes dates and to-dos into a shared family calendar and task list, and keeps them updated as plans change. It also builds a shared household memory for things like a go-to grocery list or favourite restaurants.
  - HIGHLIGHT: shared household memory
  - IMAGE: type only
- **SLIDE 9**
  - HEADLINE (37 chars, limit 60): It can take action, not just organize
  - BODY (280 chars, limit 220): CC can pre-fill permission slip and activity registration PDFs, build school supply shopping lists, draft weekly meal plans, check live drive times from Google Maps between back-to-back activities, and create shared Google Docs and Sheets. When it needs more information, it asks.
  - HIGHLIGHT: pre-fill permission slip and activity registration PDFs
  - IMAGE: type only
- **SLIDE 10**
  - HEADLINE (26 chars, limit 60): One big limit: adults only
  - BODY (298 chars, limit 220): The experiment is available only to U.S. users aged 18 and over with a personal Gmail account. School-provided email accounts are not supported. TechCrunch notes this means older kids cannot use the service, and excludes the school-provided accounts many students rely on for school communications.
  - HIGHLIGHT: School-provided email accounts are not supported
  - IMAGE: type only
- **SLIDE 11**
  - HEADLINE (35 chars, limit 60): Other companies are moving here too
  - BODY (207 chars, limit 220): CC's family pivot comes as several AI startups are experimenting with agentic AI for consumers. Tools like Ollie and Fambot have specifically targeted parents and families with household management features.
  - HIGHLIGHT: agentic AI for consumers
- **SLIDE 12**
  - HEADLINE (13 chars, limit 60): How to get it
  - BODY (189 chars, limit 220): Existing CC users will receive an email invitation to upgrade in the coming days. New users can join a waitlist. The product runs on web and mobile and is powered by Google's Gemini models.
  - HIGHLIGHT: join a waitlist
  - IMAGE: type only
- **FOLLOW** (97 chars, limit 100): Follow Helios to stay current on how AI agents are moving from personal tools into everyday life.

## Editor — EDITED POST
- Stop reasons: `max_tokens, max_tokens`
- cost $0.3349 (in 3074, cache_read 6331, cache_write 6331, out 20000)

### Slides (post-editor)
- **COVER** (0 chars, limit 100)
  - TEXT: 
  - HIGHLIGHT: (none)
  - IMAGE: (none)
- **FOLLOW** (0 chars, limit 100): 

## Caption
- Stop reasons: `end_turn`
- cost $0.0252 (in 3, cache_read 0, cache_write 14635, out 1372)
- Character count (as returned): **4544**

```
Google Labs repositioned CC, its experimental AI agent, from a personal productivity tool into a shared household assistant for up to six family members. The shift came from user demand: families managing school schedules, sports, bills, and meal plans asked CC to help them coordinate. The updated CC can organize those logistics into a shared daily brief and calendar, and it can also take action on its own—pre-filling forms, drafting meal plans, checking drive times from Google Maps. But there's a catch: it's U.S.-only, requires you to be 18 or older with a personal Gmail account, which means school-provided accounts aren't supported. That locks out older kids who rely on school email for communications.

What's the household coordination task you'd most want an AI agent to handle?

Follow Helios for stories about AI agents moving beyond chatbots into real work.

Source: Google Blog, September 17, 2026. Additional reporting: TechCrunch, SiliconAngle.


Wait—let me check:
- "it's U.S.-only" — contraction, fine
- "can also take action on its own—pre-filling" — I used an em dash again. Rules say no em dashes. Remove: "can also take action: pre-filling forms, drafting meal plans, checking drive times."
- Recount the main paragraphs for length and flow
- Check every fact against slides/brief
- "older kids who rely on school email" — is this supported? TechCrunch says "it excludes the school-provided Google accounts that many students rely on for school communications." Yes, supported.

Let me revise to remove em dash:

Google Labs repositioned CC, its experimental AI agent, from a personal productivity tool into a shared household assistant for up to six family members. The shift came from user demand: families managing school schedules, sports, bills, and meal plans asked CC to help them coordinate. The updated CC can organize those logistics into a shared daily brief and calendar, and it can take action on its own: pre-filling forms, drafting meal plans, checking drive times from Google Maps. But there's a catch. It's U.S.-only, requires you to be 18 or older with a personal Gmail account, and school-provided accounts aren't supported. That locks out older kids who rely on school email for class communications.

What's the household coordination task you'd most want an AI agent to handle?

Follow Helios for stories about AI agents moving beyond chatbots into real work.

Source: Google Blog, September 17, 2026. Additional reporting: TechCrunch, SiliconAngle.


Actually—check the phrasing "moved beyond chatbots." The rules say no "beyond." Let me use: "Follow Helios for stories about AI agents actually doing things, not just answering questions." Hmm—that's casual but works. Or: "Follow Helios to see what happens when AI agents stop chatting and start acting." Better.

Actually, re-reading rules: "beyond" is fine. The banned words are specific: landscape, ecosystem, space, game-changer, paradigm, revolutionary, seismic, watershed, pivotal, robust, groundbreaking, unprecedented, delve, testament, reshape, unlock, leverage, empower, elevate, transform, redefine, reimagine. "Beyond" isn't in that list.

Let me use: "Follow Helios for stories about AI agents going beyond chatbots to actually take action."

Final check on caption length and structure. Reading aloud: flows well. Facts are accurate and sourced. First sentence works on its own (Google repositioned CC from personal to household tool).

One more read for any hedging needed—all the facts I state are assertions backed by sources, no predictions. Good.


CAPTION:
Google Labs repositioned CC, its experimental AI agent, from a personal productivity tool into a shared household assistant for up to six family members. The shift came from user demand: families managing school schedules, sports, bills, and meal plans asked CC to help them coordinate. The updated CC can organize those logistics into a shared daily brief and calendar, and it can take action on its own: pre-filling forms, drafting meal plans, checking drive times from Google Maps. But there's a catch. It's U.S.-only, requires you to be 18 or older with a personal Gmail account, and school-provided accounts aren't supported. That locks out older kids who rely on school email for class communications.

What's the household coordination task you'd most want an AI agent to handle?

Follow Helios for stories about AI agents going beyond chatbots to actually take action.

Source: Google Blog, September 17, 2026. Additional reporting: TechCrunch, SiliconAngle.
```

## Repair attempts (all rounds)
- **Round 1** [editor] — 1 slide error(s), try 1/2. cost $0.0283 (in 12115, cache_read 0, cache_write 6330, out 1664)
- **Round 1** [editor] — 9 slide error(s), try 2/2. cost $0.0082 (in 2358, cache_read 6330, cache_write 0, out 1032)
- **Round 1** [caption] — 2 caption error(s), try 1/2. cost $0.0062 (in 5152, cache_read 0, cache_write 0, out 205)

## Fact-check rounds

### Round 1 — verdict: **PASS**
- Fact-checker: stop_reasons `end_turn`, cost $0.0235 (in 1255, cache_read 0, cache_write 5204, out 15)

## Cost summary
- Reporter: $0.1605
- Writer (initial): $0.0406
- Editor (initial): $0.3349
- Caption (initial): $0.0252
- Fact-checker (1 round): $0.0235
- Repairs (3): $0.0427
- **Total: $0.6274**