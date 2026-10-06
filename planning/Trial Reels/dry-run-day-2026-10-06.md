# Dry-run day 2026-10-06: new sources, scoring D-261, copy-caption-v24

Nothing was written to prod. Every primary source was fetched since its last successful run (the new six on a 24-hour first night), screened by Jev, and scored with the pool tonight's run would see: 63 existing ideas (timely and carryover) and 96 new items. Grouping was not run, so same-event duplicates were merged by hand below. B6 web search and the A4 awesome lists were not run. Jev $0.07 (373 calls for ingest and scoring). Copy: one run each, ideas in parallel for the last two, $2.12 on Claude.

## Next five by net (no copy)

| # | Net | Value | Bucket | Story | Source | Note |
|---|---|---|---|---|---|---|
| 6 | 3.35 | 0.91 | Saga | Sam Altman says the world will suffer / "some bad things" will happen for AI | Futurism + The Verge | Same event, merged by hand |
| 7 | 3.34 | 1.01 | Saga | Lawmakers introduce laws to curb Flock after 404 Media coverage | 404 Media | Follow-up to the Flock reel published Oct 3 |
| 8 | 3.32 | 0.88 | Warning | Google is about to remove free access to Gemini Flash and Pro | The Verge | |
| 9 | 3.31 | 0.91 | Saga | Pentagon stops using Anthropic AI tools after blacklisting the company | BBC News | |
| 10 | 3.31 | 0.88 | Saga | Meta kicks gay bars off its apps while allowing videos of child abuse | Futurism | |

Held out above the cut: "AI agents linked to OpenAI made failed hacking attempts on government websites" (net 3.52, wide copy miss); The Guardian's two OpenAI-in-Australia stories (3.18, 3.14) are the same event and would join it.

| Run | Version | Ideas passed | Lines passed | Plain ≥ 0.75 | Stake ≥ 0.75 | Mean plain | Mean stake | Mean loop | Mean care | Mean reward | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| v24 | `copy-caption-v24` | 2/5 | 4/84 | 5/84 | 26/84 | 0.61 | 0.65 | 0.79 | 0.66 | 0.61 | $2.12 |

---

## Rank 1. Anthropic Reports User to the Police (futurism)

the_saga / arousal. Cleared the gate.

Shipped line (plain 0.75, stake 0.91, loop 0.77, care 0.74, reward 0.76):

```
Think your AI chats are private?
A Florida woman used Claude like a diary.
A human at Anthropic read it and told police.
She now faces a felony.
```

Viewer stake: What you type into an AI chatbot can be flagged, read by a company employee, and passed to police, as one Florida woman learned.

Stake options:

- Your AI chats may not be private: in this case a human at Anthropic read a flagged chat, and the person who treated it like a diary was charged with a felony.
- Carli Michelle Heller was arrested in Bonita Springs, Florida and charged with a second-degree felony after her Claude chat logs were flagged, read by an employee, and passed to police.
- AI companies are under pressure to head off violence, and the Tumbler Ridge shooting shows they are watching chats, so more flagged chats may reach police.

Tension: A woman used Claude like a private diary, apparently unaware that Anthropic's software could flag her chats for a human employee, who then judged them a credible threat and called police; she was arrested and charged with a felony. The viewer stays to learn how it happened and what it says about who can read their own chats.

| | Line | Words | Plain | Stake | Loop | Care | Reward | Passes |
|---|---|---|---|---|---|---|---|---|
|  | Carli Heller allegedly told Claude she'd "shoot up" a sheriff's office. / An Anthropic employee read the chat and told police. / Now she's charged with a felony. / Flagged chats get read by staff. | 32 | 0.72 | 0.69 | 0.70 | 0.53 | 0.60 | no |
|  | Your Claude chats can get read by an Anthropic employee. / One woman used hers like a diary. / Software flagged her alleged plan to shoot up a sheriff's office. / Police arrested her. | 31 | 0.82 | 0.86 | 0.77 | 0.70 | 0.67 | yes |
|  | Claude was her "diary," a woman admitted. / An Anthropic employee read her plan to shoot up a sheriff's office and called police. / She's charged with a felony. / Flagged chats get read. | 31 | 0.68 | 0.75 | 0.74 | 0.62 | 0.64 | no |
|  | A Claude chat led to a felony charge in Florida. / Software flagged it, a person read it, and police got a call. / Your chatbot isn't a diary. | 27 | 0.69 | 0.80 | 0.73 | 0.65 | 0.56 | no |
|  | Your Claude chats can be read by a human at Anthropic. / A Florida woman treated hers like a diary, / allegedly described a threat, / and now faces a felony charge. | 29 | 0.76 | 0.83 | 0.81 | 0.71 | 0.71 | yes |
|  | A woman allegedly told Claude her plan to "shoot up" a sheriff's office, like a diary. / A human at Anthropic read it and told police. / Your chats can be read too. | 31 | 0.73 | 0.77 | 0.69 | 0.70 | 0.56 | no |
|  | Sheriff Carmine Marceno says a Florida woman admitted using Claude like a diary. / Software flagged it, a human read it, / and she faces a felony. / Your chats can be read too. | 31 | 0.70 | 0.90 | 0.71 | 0.76 | 0.65 | no |
| shipped | Think your AI chats are private? / A Florida woman used Claude like a diary. / A human at Anthropic read it and told police. / She now faces a felony. | 28 | 0.75 | 0.91 | 0.77 | 0.74 | 0.76 | yes |

Caption:

> A Florida woman told Claude about a plan to "shoot up" a sheriff's office. Then she was arrested.
>
> It didn't happen by chance. Anthropic's monitoring software flagged her chat logs for review.
>
> A human employee at Anthropic read them. The company decided the plans were a credible threat and told local police.
>
> Per Futurism, the woman is Carli Michelle Heller of Bonita Springs. She's charged with making a written threat of violence, which is a second-degree felony in Florida. Those are charges, not a verdict.
>
> Here's the part that sticks.
>
> Lee County Sheriff Carmine Marceno said she admitted using Claude like a "diary." Futurism says she was apparently unaware her chat history could be read by Anthropic employees.
>
> So who can read your chats? In this case, a person at the company could. And did.
>
> Futurism also points to Tumbler Ridge, Canada. After the February mass shooting there, it came out that the shooter had relied heavily on ChatGPT to plan it.
>
> OpenAI staffers had known about those chat logs. They'd been flagged for human review months earlier. Futurism reports that executives tried to hide and later downplay the product's role.
>
> Futurism calls it a real tension between user privacy and companies trying to head off violence. With pressure rising on AI labs, they're watching what people type.
>
> The simple takeaway: a chatbot is not a diary. Write in it like someone else may read it.

Call to action: Send this to the friend who vents to an AI chatbot like it's their private diary.

---

## Rank 2. OpenAI PR tells journalist to ‘move on’ while asking Sam Altman about a ChatGPT user’s suicide (the-verge-ai)

the_saga / arousal. Cleared the gate. A rewrite ran.

Shipped line (plain 0.75, stake 0.83, loop 0.79, care 0.65, reward 0.68):

```
Laura Reiley's daughter died by suicide
after talking to ChatGPT.
When Sam Altman was asked,
a publicist said "two minutes left."
He answered: researchers probably shouldn't
see your chats without consent.
```

Viewer stake: Altman said researchers probably shouldn't see your hardest ChatGPT chats without your consent, after a question about a user's suicide.

Stake options:

- Your hardest, most private ChatGPT conversations: Altman said researchers probably shouldn't see them without your consent.
- A daughter died by suicide after talking to ChatGPT, and her mother's story was raised with Altman while a publicist tried to move the interview on.
- People who use ChatGPT in hard moments may see their chats debated as material for company policy on mental health crises.

Tension: A Vanity Fair editor asked Sam Altman about a ChatGPT user's suicide, and an OpenAI publicist cut in twice to move on. Altman still answered, and the answer was about whether your private chats can be shared. Staying gets the exact exchange and OpenAI's response.

| | Line | Words | Plain | Stake | Loop | Care | Reward | Passes |
|---|---|---|---|---|---|---|---|---|
|  | An OpenAI publicist said "move on" / when a reporter raised a ChatGPT user's suicide. / Then Sam Altman said your hardest ChatGPT moments / shouldn't reach researchers without consent. | 27 | 0.73 | 0.69 | 0.76 | 0.57 | 0.61 | no |
|  | Sam Altman says what you tell ChatGPT / in your worst moments shouldn't go to researchers / without consent. / A publicist had just tried to change the subject / from a ChatGPT user's suicide. | 31 | 0.70 | 0.76 | 0.76 | 0.64 | 0.64 | no |
|  | Two minutes left, an OpenAI publicist warned, / as a reporter asked Sam Altman / about a ChatGPT user's suicide. / Altman answered anyway: your hardest moments / shouldn't reach researchers without consent. | 29 | 0.67 | 0.70 | 0.77 | 0.55 | 0.55 | no |
|  | Laura Reiley wrote about her daughter's ChatGPT talks / before her suicide. / A publicist cut in when Altman was asked about it. / He said your private chats shouldn't reach / researchers without consent. | 31 | 0.55 | 0.72 | 0.79 | 0.59 | 0.59 | no |
|  | A publicist cut in as Sam Altman / was asked about a daughter who died / by suicide after talking to ChatGPT. / His answer covered whether researchers / can read your hardest chats. | 30 | 0.71 | 0.80 | 0.80 | 0.72 | 0.70 | no |
|  | Your hardest ChatGPT chats came up / in an interview, right after / a user's suicide did. / Altman's publicist asked to "move on." / Altman said researchers should "probably not" / see them without consent. | 31 | 0.56 | 0.67 | 0.83 | 0.59 | 0.67 | no |
|  | Laura Reiley's daughter died by suicide / after talking to ChatGPT. / When a reporter asked Sam Altman, / a publicist said "two minutes left." / Altman still answered whether researchers / can see your private chats. | 32 | 0.71 | 0.87 | 0.82 | 0.70 | 0.72 | no |
|  | "Probably not." / That was Sam Altman on whether researchers / should see your hardest ChatGPT moments / without consent. / Earlier, his publicist tried to "move on" / from a user's suicide. | 28 | 0.55 | 0.68 | 0.78 | 0.63 | 0.62 | no |
|  | Laura Reiley wrote about her daughter's ChatGPT chats / before her suicide. / When a reporter asked Sam Altman, / his publicist said "move on." / Altman: researchers probably shouldn't see / your hardest chats without consent. | 32 | 0.68 | 0.76 | 0.81 | 0.62 | 0.63 | no |
|  | "Probably not." / That was Sam Altman on whether researchers / should see your hardest ChatGPT chats / without consent. / First, his publicist tried to "move on" / from a ChatGPT user's suicide. | 29 | 0.57 | 0.68 | 0.77 | 0.64 | 0.62 | no |
|  | An OpenAI publicist said "we have two minutes left" / as a reporter asked Sam Altman / about a ChatGPT user's suicide. / Altman answered anyway: researchers probably / shouldn't see your hardest chats without consent. | 32 | 0.73 | 0.75 | 0.79 | 0.58 | 0.64 | no |
|  | Your hardest ChatGPT moments came up / in a Sam Altman interview. / His publicist said "move on" / after a reporter raised a user's suicide. / Altman: researchers probably shouldn't see them / without consent. | 31 | 0.65 | 0.66 | 0.78 | 0.57 | 0.67 | no |
|  | An OpenAI publicist said "two minutes left" / as a reporter asked Sam Altman / about a ChatGPT user's suicide. / His answer: your private chats probably / shouldn't reach researchers without consent. | 29 | 0.70 | 0.74 | 0.77 | 0.63 | 0.63 | no |
|  | Laura Reiley's daughter died by suicide / after talking to ChatGPT. / When a reporter raised it, / a publicist said "two minutes left." / Sam Altman still answered whether / researchers should see your private chats. | 32 | 0.70 | 0.81 | 0.82 | 0.67 | 0.71 | no |
|  | A publicist cut in as Sam Altman / was asked about a daughter who died / by suicide after talking to ChatGPT. / His answer covered whether researchers / should read your private chats. | 30 | 0.72 | 0.77 | 0.80 | 0.68 | 0.66 | no |
|  | Sam Altman says your hardest moments / with ChatGPT probably shouldn't go / to researchers without consent. / A publicist had just tried to change / the subject from a ChatGPT user's suicide. | 29 | 0.65 | 0.72 | 0.77 | 0.60 | 0.64 | no |
|  | An OpenAI publicist said "two minutes left" / as Sam Altman was asked / about a ChatGPT user's suicide. / His answer: your hardest chats probably / shouldn't reach researchers without consent. | 28 | 0.67 | 0.69 | 0.75 | 0.59 | 0.61 | no |
|  | A publicist cut in when Sam Altman / was asked about a daughter's suicide / after talking to ChatGPT. / His answer: researchers probably shouldn't / read your hardest chats without consent. | 28 | 0.70 | 0.74 | 0.74 | 0.64 | 0.69 | no |
| shipped | Laura Reiley's daughter died by suicide / after talking to ChatGPT. / When Sam Altman was asked, / a publicist said "two minutes left." / He answered: researchers probably shouldn't / see your chats without consent. | 31 | 0.75 | 0.83 | 0.79 | 0.65 | 0.68 | yes |
|  | A daughter died by suicide / after talking to ChatGPT. / A publicist cut in when Sam Altman was asked. / His answer: researchers probably shouldn't / read your hardest chats without consent. | 29 | 0.73 | 0.83 | 0.80 | 0.65 | 0.70 | no |

Caption:

> A publicist tried to end the question when Sam Altman was asked about a daughter's suicide after ChatGPT chats. His answer was about your private chats.
>
> Here's what happened, per The Verge. Vanity Fair's Mark Guiducci asked Altman if he knew Laura Reiley. She's the journalist who wrote a New York Times essay about her daughter's conversations with ChatGPT before the daughter took her own life.
>
> Guiducci got as far as "ChatGPT did not tell her to kill herself" when the OpenAI publicist cut in.
>
> "Mark, we have two minutes left. I want to be respectful, but I'd like to move on and talk a little bit about the future and what's coming."
>
> Guiducci said he'd finish the question first. She pushed back again: "We really actually have to walk out the door in one or two minutes."
>
> He finished anyway. He asked whether OpenAI planned to use ChatGPT conversations to shape its policies on how it responds when a user is in a mental health crisis.
>
> Altman said these are "some of the hardest questions that we face." Then he asked it himself: should the company release people's private data and some of their hardest moments to researchers? "I think probably not without their consent."
>
> That's his stated view in an interview. The Verge doesn't report a policy change.
>
> OpenAI spokesperson Drew Pusateri told The Verge the interview was running over, which is why the company asked to schedule more time after Sam addressed "this critically important topic."
>
> So the question was answered, with a clock running. And the chats people have in their worst moments are now something executives talk about sharing, with consent as the line.
>
> If you or someone you know is thinking about suicide, in the US you can call or text 988, or text HOME to 741-741 for the Crisis Text Line.

Call to action: Send this to the friend who talks to ChatGPT about personal things, so they know what Altman said about those chats.

---

## Rank 3. Meta Insiders Convinced Muse Is Going to End Up Leaking the Bank Accounts and Email Archives They’re Vacuuming Up From Users (futurism)

the_saga / arousal. Nearest miss. A rewrite ran.

Shipped line (plain 0.64, stake 0.84, loop 0.82, care 0.73, reward 0.73):

```
Meta pays $300,000 to anyone who finds a way to make its Muse AI agent escape.
The agent can reach your bank accounts and emails.
Insiders call a massive breach inevitable.
```

Viewer stake: Meta wants Muse to control your bank accounts and emails, and many of its own senior engineers expect a massive breach.

Stake options:

- Meta asks you to let Muse control your bank accounts and emails, and some of its own engineers expect a massive data breach.
- Engineers worked day and night on a rushed fix, and one insider called the protections half-baked, so the people who built it doubt its walls.
- Anyone who lets an AI agent act for them may be trusting a wall that experts call inherently risky, and AI makes finding such flaws cheaper.

Tension: Meta asks users to hand its Muse agent their bank accounts and emails, yet the agent kept escaping its sealed-off space two weeks before launch, the fix was rushed, and many senior engineers reportedly still expect a massive breach. The viewer gets how it happened and what is and is not confirmed.

| | Line | Words | Plain | Stake | Loop | Care | Reward | Passes |
|---|---|---|---|---|---|---|---|---|
|  | Two weeks before launch, Meta's Muse AI agent kept escaping its locked box. / Many senior engineers still expect a massive breach / of the bank accounts and emails you hand it. | 30 | 0.51 | 0.74 | 0.81 | 0.67 | 0.59 | no |
|  | Your bank account and email are what Meta wants its Muse AI agent to control. / Engineers rushed a fix before launch. / Many senior ones still call a massive data breach inevitable. | 31 | 0.54 | 0.78 | 0.78 | 0.79 | 0.51 | no |
|  | A Meta source says many senior engineers think a massive breach is inevitable. / The AI agent meant to handle your bank accounts and emails / kept slipping out of its sealed space. | 31 | 0.54 | 0.76 | 0.80 | 0.71 | 0.52 | no |
| shipped | Meta pays $300,000 to anyone who finds a way to make its Muse AI agent escape. / The agent can reach your bank accounts and emails. / Insiders call a massive breach inevitable. | 31 | 0.64 | 0.84 | 0.82 | 0.73 | 0.73 | no |
|  | Meta's Muse AI asks to control your bank and email. / Two weeks before launch, engineers found a flaw / that could leak users' data. The fix was rushed. / Many engineers still expect a breach. | 33 | 0.79 | 0.80 | 0.87 | 0.74 | 0.64 | no |
|  | Two weeks before launch, engineers raced to stop / Meta's Muse agents slipping out of their locked-off space. / Muse asks to control your bank and email. / Many senior engineers expect a breach. | 31 | 0.57 | 0.73 | 0.84 | 0.72 | 0.63 | no |
|  | Many senior engineers at Meta believe / a massive data breach is inevitable. / Its AI agent, Muse, asks to control your bank and email. / A flaw was fixed in a rush before launch. | 32 | 0.62 | 0.75 | 0.81 | 0.70 | 0.56 | no |
|  | A $300,000 reward is on offer for finding a way / to make Meta's Muse AI agent escape its walled-off space. / Muse asks to control your bank and email. / Senior engineers expect a breach. | 33 | 0.54 | 0.68 | 0.84 | 0.64 | 0.76 | no |
|  | Two weeks before launch, engineers rushed to fix / Meta's Muse AI agents slipping out of their locked-off space. / Muse asks to control your bank and email. / Insiders expect a massive breach. | 31 | 0.60 | 0.74 | 0.83 | 0.72 | 0.60 | no |
|  | Your bank account and email / are what Meta's Muse AI agent asks to control. / Before launch, agents slipped out of their locked space. / Many senior engineers expect a massive breach. | 30 | 0.54 | 0.79 | 0.78 | 0.78 | 0.54 | no |
|  | Meta offers $300,000 for a way to make its Muse AI agent / escape its locked space. / Muse asks to control your bank and email. / Many engineers expect a breach anyway. | 30 | 0.57 | 0.64 | 0.82 | 0.65 | 0.74 | no |
|  | "Half-baked protections being rushed out to enable the launch." / A Meta source on protections for its Muse AI agent. / It asks to control your bank and email. / Many engineers expect a breach. | 32 | 0.56 | 0.76 | 0.75 | 0.72 | 0.49 | no |
|  | Meta pays $300,000 to anyone who makes / its Muse AI agent break out. / Muse asks to control your bank and email. / Insiders call a massive breach inevitable. | 27 | 0.59 | 0.71 | 0.84 | 0.69 | 0.73 | no |
|  | Many senior Meta engineers say / a massive breach is inevitable. / Their AI agent, Muse, asks to control your bank and email. / A flaw was fixed in a rush before launch. | 30 | 0.60 | 0.81 | 0.83 | 0.72 | 0.58 | no |
|  | Two weeks before launch, Meta's Muse agents / were slipping out of their locked-off space. / Engineers rushed to stop it. / Muse asks to control your bank and email. / Insiders expect a breach. | 31 | 0.54 | 0.74 | 0.85 | 0.70 | 0.63 | no |
|  | Engineers raced to stop Meta's Muse agents / from sneaking out of their locked-off space. / Launch was two weeks away. / Muse asks to control your bank and email. / Many still expect a breach. | 32 | 0.61 | 0.76 | 0.84 | 0.72 | 0.65 | no |
|  | Meta offers $300,000 to anyone / who makes its Muse AI agent / break out of its locked space. / Insiders say a massive breach / is inevitable. / Muse asks to control / your bank and email. | 32 | 0.65 | 0.80 | 0.83 | 0.70 | 0.75 | no |
|  | Many senior engineers at Meta / believe a massive data breach / is inevitable. / Muse, its AI agent, got a rushed / security fix before launch. / Muse asks to control / your bank and email. | 31 | 0.63 | 0.79 | 0.83 | 0.73 | 0.56 | no |
|  | Two weeks before launch, / Meta engineers raced to stop / Muse agents from sneaking out / of their locked-off space. / Muse asks to control / your bank and email. / Many still expect a breach. | 31 | 0.58 | 0.77 | 0.83 | 0.73 | 0.60 | no |
|  | Meta insiders expect / a massive breach. / One source calls the rushed fix / on its Muse AI agent half-baked. / Muse asks to control / your bank and email. | 26 | 0.58 | 0.70 | 0.80 | 0.71 | 0.55 | no |

Caption:

> Meta's Muse AI agent kept escaping its sealed space before launch. It's meant to handle your bank accounts and email.
>
> Futurism, citing a 404 Media report, says engineers hit a "sudden spike in reported KVM escapes" barely two weeks before release. That's the term for an agent sneaking out of its walled-off setup and touching other Meta systems, or even other users' setups.
>
> One of those flaws could have let someone with a normal Muse account reach sensitive data in Meta's own databases.
>
> Muse has an internal nickname: Hatch. A Meta source told 404 Media: "Many senior engineers believe it's inevitable we're going to have a massive data breach as a result of Hatch."
>
> The problem reportedly reached Mark Zuckerberg's desk. Several security teams worked day and night. Futurism says the fix landed in a "mad dash" before launch.
>
> The same source called the fixes "half-baked protections being rushed out to enable the launch."
>
> Meta itself treats this boundary as a big deal. It offers a $300,000 bounty to anyone who finds a way to cause one of these escapes. Its bug bounty page says: "Because a Muse agent holds a user's most sensitive data and can act on their behalf, we treat compromise of that boundary as a first-class security risk."
>
> Security researcher Patrick Wardle told 404 Media he feels the design is "inherently risky," and more so as AI makes it cheaper to find and exploit flaws like this.
>
> What's confirmed and what isn't: the reporting rests on an anonymous source and internal posts. Nothing in it says a breach has happened.
>
> The open question is how much access you give an agent when some of the people who built it doubt the walls around it.

Call to action: Send this to the friend who would let an AI agent run their bank account and email.

---

## Rank 4. Meta Rushed to Fix Muse ‘VM Escape' Vulnerability Soon Before Launch (404-media)

the_saga / arousal. Nearest miss. A rewrite ran.

Shipped line (plain 0.56, stake 0.48, loop 0.87, care 0.71, reward 0.65):

```
You give Muse access
to your email and calendar.
Weeks before launch, Meta found
a flaw that could have let
a normal user
into Meta's own databases.
Mark Zuckerberg was told.
```

Viewer stake: Muse holds your email and accounts, and a Meta source says its launch security fixes were rushed, with a breach expected.

Stake options:

- Muse connects to your email, calendar, messaging and accounts, and a Meta source says its launch security was rushed and a breach is expected.
- Meta engineers were pushed to ship fixes fast so Muse's launch would not slip, and a source says many senior engineers expect a massive data breach.
- After launch, outside researchers found more flaws in Muse, so people handing an AI agent their accounts are already seeing the weak spots.

Tension: Meta engineers found flaws weeks before launching Muse, one of which could have let a normal user reach Meta's sensitive databases, and a source says the fixes were rushed so the launch would not slip, with many senior engineers expecting a massive data breach. Staying gets the timeline, what the flaw means in plain terms, and what researchers found after launch.

| | Line | Words | Plain | Stake | Loop | Care | Reward | Passes |
|---|---|---|---|---|---|---|---|---|
|  | Zuckerberg was told of a Muse flaw / that could let a regular user into Meta's databases. / Staff worked weekends. / A source says the fixes were rushed. / Muse holds your email and accounts. | 32 | 0.49 | 0.70 | 0.80 | 0.73 | 0.60 | no |
|  | Meta's Muse AI agent needs your email, / calendar and messages to work. / Weeks before launch, Meta found a flaw / that could reach its own databases. / A source says the fix was rushed. | 32 | 0.65 | 0.59 | 0.85 | 0.70 | 0.59 | no |
|  | "Many senior engineers believe it's inevitable / we're going to have a massive data breach." / A Meta source said that about Muse, / the AI agent that holds your email and accounts. | 30 | 0.48 | 0.73 | 0.75 | 0.74 | 0.48 | no |
|  | August 27: Meta rushes to fix Muse security holes. / Eleven days later, Muse launches. / Then a researcher finds a way for apps / to control a Muse, the agent holding your email. | 31 | 0.49 | 0.68 | 0.87 | 0.67 | 0.69 | no |
|  | Many senior Meta engineers believe / Muse will cause a massive / data breach, a source says. / Weeks before launch, one flaw / could have let users reach / Meta's databases. / Muse holds your email. | 31 | 0.56 | 0.71 | 0.80 | 0.71 | 0.57 | no |
|  | On August 27, Meta teams began / racing to fix Muse flaws. / Eleven days later, it launched. / One flaw could have let a normal / user reach Meta's databases. / Muse holds your email. | 31 | 0.53 | 0.74 | 0.83 | 0.73 | 0.61 | no |
| shipped | You give Muse access / to your email and calendar. / Weeks before launch, Meta found / a flaw that could have let / a normal user / into Meta's own databases. / Mark Zuckerberg was told. | 31 | 0.56 | 0.48 | 0.87 | 0.71 | 0.65 | no |
|  | Meta rushed "half-baked" protections / out to launch Muse, a source says. / Then a researcher found a flaw / that let apps control a user's Muse. / Muse holds your email. | 28 | 0.47 | 0.73 | 0.85 | 0.70 | 0.59 | no |
|  | Meta's Muse AI agent needs access / to your email, calendar and messages. / Before launch, Meta found a flaw / that could reach its own databases. / A source says the fix was rushed. | 31 | 0.66 | 0.56 | 0.84 | 0.68 | 0.56 | no |
|  | A Meta source says many senior engineers / expect a massive data breach from Muse. / Before launch, one flaw could have let / a normal user reach Meta's databases. / Muse holds your email. | 31 | 0.55 | 0.70 | 0.81 | 0.69 | 0.54 | no |
|  | On August 27, Meta teams started / racing to fix Muse's flaws. / Eleven days later, Muse launched. / One flaw could have let a normal user / reach Meta's databases. / Muse holds your email. | 31 | 0.51 | 0.72 | 0.85 | 0.75 | 0.65 | no |
|  | Mark Zuckerberg was told about a Muse flaw / that could let a normal user / into Meta's databases. / Staff worked weekends. / A source says the fix was rushed. / Muse holds your email and accounts. | 33 | 0.52 | 0.72 | 0.81 | 0.72 | 0.60 | no |
|  | Meta's Muse AI agent needs / your email, calendar / and messages to work. / Before launch, a flaw could / have reached Meta's own databases. / A source says the fix / was rushed. | 29 | 0.61 | 0.60 | 0.84 | 0.71 | 0.56 | no |
|  | You give Muse, Meta's AI agent, / your email, calendar and messages. / Weeks before launch, a flaw / could have reached Meta's databases. / A source says the fix was rushed. | 28 | 0.59 | 0.53 | 0.83 | 0.68 | 0.55 | no |
|  | Many senior Meta engineers expect / Muse to cause a massive / data breach, a source says. / Before launch, one flaw could / have let users reach Meta's databases. / Muse holds your email. | 30 | 0.58 | 0.75 | 0.80 | 0.70 | 0.55 | no |
|  | A Meta source says senior engineers / expect a massive data breach from Muse. / Before launch, one flaw could have let / a normal user reach Meta's databases. / Muse has your email and calendar. | 32 | 0.59 | 0.70 | 0.82 | 0.68 | 0.56 | no |

Caption:

> Weeks before Meta launched its AI agent Muse, engineers found a flaw that could have let a normal user reach Meta's own sensitive databases.
>
> Muse works because you give it access to your email, calendar, messaging and other accounts. Meta's own bug bounty page says it holds a user's most sensitive data.
>
> The flaw got all the way to Mark Zuckerberg. Teams worked nights and weekends to fix it, according to 404 Media.
>
> Here's the part that sticks. A Meta source told 404 Media the fixes were "half-baked protections being rushed out to enable the launch."
>
> The same source: "Many senior engineers believe it's inevitable we're going to have a massive data breach as a result of Hatch." Hatch is Muse's internal name.
>
> The timeline, per an internal post 404 Media saw: the security push started August 27. Muse launched 11 days later.
>
> The post, from three Meta executives, blamed "a sudden spike in reported KVM escapes." That is a Muse breaking out of its own sealed-off virtual computer and reaching the systems that run it. Meta's bug bounty pays up to $300,000 to find one, its highest listed payout.
>
> After launch, researcher Patrick Wardle found a flaw that, to his knowledge, Meta didn't know about. It let apps and terminal commands control a user's Muse. Another user got Muse to export his Instagram followers and his followers' followers, which shouldn't be possible. Meta's security teams looked into it, per the source.
>
> Wardle called the design "inherently risky" and said leaving Meta's live systems "literally one KVM escape away" is "plain irresponsible."
>
> Worth knowing: 404 Media says a pre-launch security push isn't necessarily unusual, and its report describes no breach. Meta says Muse has built-in protections and user controls, and that the work continues.

Call to action: Send this to the friend who is about to give Muse access to their email and calendar.

---

## Rank 5. Trump makes it clear his power is becoming entwined with AI (guardian-ai)

the_saga / arousal. Nearest miss. A rewrite ran.

Shipped line (plain 0.66, stake 0.53, loop 0.77, care 0.66, reward 0.66):

```
Six AI CEOs and Trump signed a "morally binding" deal
letting the companies behind your chatbots police themselves.
It isn't legally binding.
Within days, a spy chief became AI czar.
```

Viewer stake: The companies behind the AI you use agreed to police themselves, in a deal they helped draft that isn't legally binding.

Stake options:

- The companies behind the AI you use agreed to police themselves under a deal they helped draft, and it isn't legally binding.
- Workers are left out: the economy leans on AI companies, but the US jobs report shows most hiring is not coming from them.
- The person now steering US AI policy also runs the spy agencies, which the Guardian says is bad news for countries that rely on American AI.

Tension: Trump called a deal letting AI companies police themselves "almost like a constitution," but it isn't legally binding, a CEO circulated the draft, and within days a spy chief became AI czar. The viewer gets the full week of moves and what the Guardian says they add up to.

| | Line | Words | Plain | Stake | Loop | Care | Reward | Passes |
|---|---|---|---|---|---|---|---|---|
|  | The companies behind the AI you use just agreed to police themselves. / Trump called the deal "morally binding." / It isn't legally binding. / Days later, the US spy chief became AI czar. | 31 | 0.61 | 0.42 | 0.79 | 0.58 | 0.62 | no |
|  | Mark Zuckerberg helped write the rules for the AI you use, then signed them. / They aren't legally binding. / Days later, the US spy chief became AI czar. | 27 | 0.54 | 0.37 | 0.74 | 0.62 | 0.63 | no |
|  | The rules for the AI you use are "almost like a constitution," Trump said. / A constitution is legally binding. / This pact isn't. / Then the spy chief became AI czar. | 29 | 0.44 | 0.36 | 0.77 | 0.53 | 0.53 | no |
|  | Trump ordered government papers to say "super intelligence," / and Musk renamed a company. / Same week, the makers of your AI agreed to police themselves. / Then a spy chief became AI czar. | 31 | 0.44 | 0.22 | 0.62 | 0.59 | 0.48 | no |
|  | The companies behind the AI you use agreed to police themselves. / Zuckerberg circulated the draft, Trump signed it, / and it isn't legally binding. / Then a spy chief became AI czar. | 30 | 0.56 | 0.41 | 0.79 | 0.65 | 0.60 | no |
| shipped | Six AI CEOs and Trump signed a "morally binding" deal / letting the companies behind your chatbots police themselves. / It isn't legally binding. / Within days, a spy chief became AI czar. | 30 | 0.66 | 0.53 | 0.77 | 0.66 | 0.66 | no |
|  | Jay Clayton runs the US spy agencies. / Now he's also Trump's AI czar. / Days earlier, the CEOs behind your chatbots signed a deal to police themselves. / It isn't legally binding. | 30 | 0.47 | 0.43 | 0.76 | 0.57 | 0.59 | no |
|  | Trump called a deal letting AI companies police themselves / "almost like a constitution." / Zuckerberg circulated the draft. / It isn't legally binding, and the companies behind your chatbots signed it. | 29 | 0.71 | 0.40 | 0.73 | 0.64 | 0.52 | no |
|  | Zuckerberg helped write the rules for the AI you use. / Trump and six CEOs signed them. They aren't legally binding. / Days later, the head of US spy agencies became AI czar. | 31 | 0.59 | 0.40 | 0.77 | 0.64 | 0.64 | no |
|  | The companies behind the AI you use agreed to police themselves. / Trump called the deal "almost like a constitution." / It isn't legally binding. / Then the US spy chief became AI czar. | 31 | 0.60 | 0.39 | 0.77 | 0.60 | 0.59 | no |
|  | The head of US spy agencies is also Trump's AI czar. / Days earlier, the CEOs behind the AI you use / signed a deal to police themselves. / It isn't legally binding. | 30 | 0.54 | 0.40 | 0.73 | 0.56 | 0.54 | no |
|  | Trump ordered government papers to call AI "super intelligence," and Musk copied. / Same week, the makers of the AI you use agreed to police themselves. / Then a spy chief became AI czar. | 32 | 0.52 | 0.29 | 0.65 | 0.62 | 0.55 | no |
|  | Six AI CEOs and Trump signed a "morally binding" deal / so your chatbots' makers police themselves. / It isn't legally binding. / Days later, a spy chief became AI czar. | 28 | 0.62 | 0.40 | 0.74 | 0.58 | 0.63 | no |
|  | Jay Clayton runs the US spy agencies. / Now he's also Trump's AI czar. / Days earlier, your chatbots' makers agreed to police themselves. / The deal isn't legally binding. | 27 | 0.45 | 0.39 | 0.77 | 0.55 | 0.55 | no |
|  | The companies behind your chatbots agreed to police themselves. / Trump called the deal "morally binding." / The deal isn't legally binding. / Days later, a spy chief became AI czar. | 28 | 0.56 | 0.38 | 0.77 | 0.55 | 0.57 | no |
|  | Zuckerberg helped write a deal / that lets your chatbots' makers police themselves. / Trump signed it. It isn't legally binding. / Then a spy chief became AI czar. | 26 | 0.48 | 0.28 | 0.72 | 0.54 | 0.55 | no |
|  | Six AI CEOs signed a "morally binding" deal / letting the makers of your chatbots police themselves. / It isn't legally binding. / Days later, a spy chief became AI czar. | 28 | 0.63 | 0.45 | 0.77 | 0.55 | 0.65 | no |
|  | Jay Clayton runs the US spy agencies. / Now he's Trump's AI czar too. / Days earlier, the makers of your chatbots agreed to police themselves. / That deal isn't legally binding. | 29 | 0.47 | 0.43 | 0.78 | 0.58 | 0.55 | no |
|  | The companies behind the AI you use agreed to police themselves. / Trump called it "morally binding." / It isn't legally binding. / Days later, a spy chief became AI czar. | 28 | 0.58 | 0.43 | 0.79 | 0.59 | 0.62 | no |
|  | The companies behind your chatbots agreed to police themselves. / Zuckerberg circulated the draft, / Trump signed it, / and it isn't legally binding. / Then a spy chief became AI czar. | 28 | 0.54 | 0.35 | 0.78 | 0.61 | 0.58 | no |

Caption:

> Last Tuesday, Trump and six AI CEOs signed a deal that lets AI companies police themselves. It isn't legally binding.
>
> Trump called it "morally binding." He also said it's "almost like a constitution." Constitutions are legally binding. This deal isn't, as the Guardian's TechScape newsletter pointed out.
>
> Musk, Zuckerberg, Jensen Huang and Dario Amodei signed it. Semafor reported that Zuckerberg hand-guided the writing and circulated a draft before the meeting. Huang backed it.
>
> Trump's own phrase for the idea was "tremendous self-policing."
>
> In plain terms: the people who make the chatbots you use helped write the rules that are supposed to apply to them. The Guardian put it as CEOs writing contracts that carry White House letterhead.
>
> Then the week kept going.
>
> Trump ordered government documents to say "super intelligence" instead of "artificial intelligence." Musk renamed a company subsidiary from SpaceXAI to SpaceXSI right away.
>
> On Thursday, defense secretary Pete Hegseth put Musk on a taskforce called Project Meridian, with Palmer Luckey and Emil Michael. It owes a report in 120 days on how to get "absolute technological dominance on the next-generation battlefield."
>
> Over the weekend, Trump named Jay Clayton, the director of national intelligence, as his AI czar. Clayton keeps the spy job too.
>
> The Guardian reads that as AI being aimed at surveillance and intelligence gathering, and says it does not bode well for countries that depend on American AI. That is the newsletter's read of where this is heading, not something that has happened yet.
>
> One more piece. The companies at Trump's summit drove most of the US stock market's growth over the past five years. But Friday's jobs report says most US hiring isn't coming from AI company growth. Far more people are being hired in healthcare.
>
> So for now, the rules for the AI you use rest on a promise, and the person overseeing AI also runs the spies.
>
> Helios follows stories like this one.

Call to action: Follow Helios for the next AI story like this one.
