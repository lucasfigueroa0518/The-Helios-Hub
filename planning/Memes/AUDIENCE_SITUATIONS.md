# Audience situations: APPROVED (Lucas, 2026-10-13)

The "feeling" layer (ME-02, ME-63). A situation is a recurring moment our
audience lives through. The news triggers it; the meme is about it. The system
uses only situations Lucas approves, and a situation used in a published meme
rests for 3 days (ME-65).

**The audience** (the hub's audience rule, `AUDIENCE_RULE` in
`lib/reels/jev/questions/scoring-shared.ts`): people curious about AI. Most use
it at work or in their personal life, but do not work in AI and do not know its
jargon. About one in seven builds with AI. So 17 of these 20 are everyday-user
situations and 3 are builder situations.

**Rules every situation follows:**
- It is about the **viewer's** experience, never a company's personality
  (ME-03). The company is whoever is in today's news.
- It never punches down. When a story hurts people (layoffs, harm), the joke
  is never on them.
- It takes no political side (ME-31).
- The viewer line is a pattern. The system fills the bracket from the story's
  facts and invents nothing (ME-32).

**Fields:** *Feeling* is the moment in the viewer's words. *Brought up by* is
the kinds of news that trigger it. *Viewer line* is how the viewer appears in a
"me" slot. *Shapes* are the template logics it fits. *Keep clear of* is where it
turns mean or wrong.

**Status:** all 20 approved by Lucas on 2026-10-13, as written. A new
situation, or a change to one of these, needs his approval again.

---

## Everyday users

### AS-01 · Just learned it
- **Feeling:** "I finally figured out how to use it, and now there's a new one."
- **Brought up by:** a new model or version; a redesign of an app people use.
- **Viewer line:** "Me, still using the tricks I learned for [the old version]"
- **Shapes:** abandon A for B; reject A, approve B.
- **Keep clear of:** implying the old one stopped working when it didn't.

### AS-02 · Subscription pile-up
- **Feeling:** "How many AI subscriptions am I paying for now?"
- **Brought up by:** a new paid tier; a price change; a bundle.
- **Viewer line:** "Me, adding a [new tier] to the [N] I already pay for"
- **Shapes:** refuse the obvious choice; two buttons (dilemma).
- **Keep clear of:** inventing prices; every number comes from the story.

### AS-03 · It answered differently today
- **Feeling:** "The same question got a different answer than yesterday."
- **Brought up by:** a model update; a reported change in how a model behaves.
- **Viewer line:** "Me, asking the exact same thing after [the update]"
- **Shapes:** expectation vs. reality; a reveal that reframes it.
- **Keep clear of:** claiming a change the story doesn't report.

### AS-04 · The free tier shrinks
- **Feeling:** "The thing I used for free now has limits, ads or a paywall."
- **Brought up by:** new usage limits; ads in an AI product; features moving to paid.
- **Viewer line:** "Me, hitting [the new limit] by lunch"
- **Shapes:** refuse the obvious choice; expectation vs. reality.
- **Keep clear of:** exaggerating the limit beyond what was announced.

### AS-05 · Best model ever, again
- **Feeling:** "Every week there's a new 'best model ever'. Which one do I actually use?"
- **Brought up by:** several launches close together; benchmark claims; a stack-up week.
- **Viewer line:** "Me, deciding which one to use this week"
- **Shapes:** chain or stack-up; dilemma; abandon A for B.
- **Keep clear of:** ranking models ourselves; any ranking must be the sources'.

### AS-06 · The keynote vs. my screen
- **Feeling:** "The launch looked amazing. Then I opened the app."
- **Brought up by:** a launch event; a big announcement before the rollout.
- **Viewer line:** "Me, after the demo vs. me, opening the app"
- **Shapes:** expectation vs. reality; naive hope, ominous answer.
- **Keep clear of:** calling a product bad; the gap is between the demo and the viewer's day.

### AS-07 · The AI person at the table
- **Feeling:** "I'm the one family and coworkers ask about every AI headline."
- **Brought up by:** a mainstream story (a big deal, a policy move, a viral moment).
- **Viewer line:** "Me, explaining [the headline] at dinner"
- **Shapes:** a plan with a flaw at the last step; the reveal.
- **Keep clear of:** making the asker look stupid.

### AS-08 · Work just discovered AI
- **Feeling:** "My company announced we're 'using AI for everything now'."
- **Brought up by:** big enterprise adoption deals; companies announcing AI rollouts.
- **Viewer line:** "Me, reading the company-wide AI memo"
- **Shapes:** a plan with a flaw at the last step; refuse the obvious choice.
- **Keep clear of:** layoffs. A story about job cuts never gets this situation.

### AS-09 · Wait, it remembers that?
- **Feeling:** "Hold on, it saved that? Who can see it?"
- **Brought up by:** memory features; a privacy-policy change; a data deal.
- **Viewer line:** "Me, remembering what I told it last month"
- **Shapes:** naive hope, ominous answer; the reveal.
- **Keep clear of:** claiming data misuse the story doesn't report.

### AS-10 · My app didn't get it first
- **Feeling:** "The feature I've wanted just shipped in a different app."
- **Brought up by:** a rival launching what another app lacks (a stack-up story).
- **Viewer line:** "Me, looking at [the feature] in the other app"
- **Shapes:** abandon A for B; reject A, approve B.
- **Keep clear of:** declaring a winner; this is about the viewer's envy.

### AS-11 · Not on my account yet
- **Feeling:** "It's 'rolling out gradually'. Just not to me."
- **Brought up by:** a staged rollout; a feature for one country, one plan or a waitlist first.
- **Viewer line:** "Me, refreshing the app for [the feature]"
- **Shapes:** waiting forever; expectation vs. reality.
- **Keep clear of:** saying a rollout is fake or late unless the story does.

### AS-12 · Numbers too big to feel
- **Feeling:** "They raised how many billions? I'm debating a $20 plan."
- **Brought up by:** funding rounds; valuations; data-center spending.
- **Viewer line:** "Me, comparing [the figure] to my budget"
- **Shapes:** reject A, approve B; scale contrast.
- **Keep clear of:** rounding or inflating the figure; quote it as the source writes it.

### AS-13 · Everything is in the old app
- **Feeling:** "The new one is better, but all my chats and projects are in the old one."
- **Brought up by:** a strong launch from a competitor; export or import features.
- **Viewer line:** "Me, with [N] months of chats in the old app"
- **Shapes:** dilemma; the swerve (the exit you shouldn't take).
- **Keep clear of:** claiming you can't export when you can.

### AS-14 · Confidently wrong
- **Feeling:** "It sounded so sure. It was wrong."
- **Brought up by:** a widely reported AI mistake; a study of accuracy failures.
- **Viewer line:** "Me, checking the answer it was very sure about"
- **Shapes:** the reveal; naive hope, ominous answer.
- **Keep clear of:** harm. When a mistake hurt someone, no joke at all (skip list).

### AS-15 · Agents vs. my actual errands
- **Feeling:** "They demo agents that run your life. I just want it to fill in this form right."
- **Brought up by:** agent launches; "it does tasks for you" announcements.
- **Viewer line:** "Me, asking the agent to do [one simple task]"
- **Shapes:** expectation vs. reality; a plan with a flaw at the last step.
- **Keep clear of:** claiming the agent fails unless the story says so.

### AS-16 · What is it called now?
- **Feeling:** "Mini, Pro, Ultra, 4.5, 5.1, a new name... which one is the good one?"
- **Brought up by:** confusing model names; a rename or rebrand (e.g., xAI → SpaceXAI).
- **Viewer line:** "Me, trying to tell [name] from [name]"
- **Shapes:** they're the same picture; dilemma.
- **Keep clear of:** getting a name wrong; names come from the registry (ME-10).

### AS-17 · Is this allowed where I live?
- **Feeling:** "One place allows it, another bans it. Can I use it here?"
- **Brought up by:** a new law or ruling; a feature blocked in one region.
- **Viewer line:** "Me, checking if [the feature] works in my country"
- **Shapes:** dilemma; the swerve.
- **Keep clear of:** taking sides on the policy. The confusion is the joke, never the government (ME-31).

## Builders (about one in seven)

### AS-18 · It changed under my code
- **Feeling:** "The API I built on just changed: price, limit or deprecation."
- **Brought up by:** API pricing changes; rate limits; a model deprecation date.
- **Viewer line:** "Me, reading the deprecation email for [the model]"
- **Shapes:** naive hope, ominous answer; refuse the obvious choice.
- **Keep clear of:** jargon the everyday viewer can't follow. It must read without knowing what an API is.

### AS-19 · New model mid-project
- **Feeling:** "We just finished tuning everything for the last model."
- **Brought up by:** a model release that obsoletes last month's choice.
- **Viewer line:** "Me, two days after finishing the setup for [the old model]"
- **Shapes:** the swerve; abandon A for B.
- **Keep clear of:** implying the old model stopped working.

### AS-20 · My idea is now a feature
- **Feeling:** "A big company just shipped the thing my product does, for free."
- **Brought up by:** a platform launching a feature a category of startups sells.
- **Viewer line:** "Me, watching [the company] announce [the feature]"
- **Shapes:** the reveal; reject A, approve B.
- **Keep clear of:** naming a startup as the victim; the viewer is the builder.

---

## Notes from drafting

- **Two classic templates fail the imagery checks.** *Always Has Been* shows a
  gun (ME-30), and *Bernie I Am Once Again Asking For Your Support* shows a
  politician, so it fits only when politics is the subject (ME-31). Both are
  in Imgflip's current top 10.
- **AS-05, AS-10 and AS-16 are natural landscape situations.** They are about
  how several stories relate, which is what Jev's stack-up finds (ME-70, ME-71).
