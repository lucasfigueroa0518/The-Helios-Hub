# Meme turn types

The story side of the mapping (ME-101, planning/Memes/UPGRADE_PLAN.md). A turn is the reversal, contradiction or backfire a joke rests on. The writer names a story's turns first; code checks them (lib/memes/turns.ts). Approved by Lucas with the upgrade plan, 2026-10-14 (D1); a change needs his approval, like the situations.

| Type | What it is | Beats (last is the payoff) | Graded example |
|---|---|---|---|
| Backfire (`backfire`) | A party's own move causes its own problem. | actor (optional) → move → next-move (optional) → consequence | Hire from Apple, build an iPhone rival, a judge hands Apple your interview files. |
| Says vs does (`says-vs-does`) | A party says one thing and does, or keeps doing, another. | says → does | Maia will be the main system; Nvidia and AMD still do the training. |
| Double standard (`double-standard`) | A party holds others to a standard it does not meet, or fears for itself what it does to others. | standard → own-case | Police say being tracked would be scary. |
| Unlikely agreement (`unlikely-agreement`) | Two parties usually apart, or rivals, agree on one thing or make the same move. | party-a → party-b → shared | OpenAI and Anthropic both tell lawmakers voluntary pledges are not enough. |
| Wandering eye (`wandering-eye`) | A party committed to one thing is drawn to another. | who → current → new | Microsoft, with Nvidia, eyeing its own Maia 300. |
| The fall (`the-fall`) | Then strong, now weak, each with the figure that shows it. | then → now | Character.AI: valued over $1B with no revenue; Disney bids $20M for some assets. |
| Scale gap (`scale-gap`) | Two things side by side whose sizes do not match. | big → small | Milk has more safety rules than AI. |
| Fancy name (`fancy-name`) | A plain thing and the polished name it goes by. | plain → polished | "Rules you can choose to follow" is "a light-touch approach". |
| Obvious consequence (`obvious-consequence`) | A move and the result anyone could have predicted. | move → result | Everyone mass-applies with AI; 12,000 applications show up. |
| Again (`again`) | The same thing happens again. | before (optional) → event | Claude acting on a real site it should not, again. |
| Backwards result (`backwards-result`) | Help that was added made the outcome worse. | help → more-help (optional) → outcome | Reward the robot for reaching the part, and for lining it up: success goes down. |
| Vested interest (`vested-interest`) | Someone takes a position that happens to pay them. | speaker (optional) → stance → stake | A chip CEO wants less AI doom talk: vested interest. |
| Dilemma (`dilemma`) | Someone is stuck choosing between two real options, and the sweat is out of proportion: the right one is obvious and they still won't take it, the two are the same thing, or both are bad. Never a fair, calmly weighed trade-off. (Changed 2026-10-15 from the golden set: the fair trade-off is the Two Buttons flop shape.) | option-a → option-b → chooser | Claude Opus 5.5 Max or Muse Wonder Full: me, deciding which to use this week. |
| Self-congratulation (`self-congratulation`) | A party credits itself, or its own product, with something outside its job. | party → brag | OpenAI says its own models traced its own spy: something of a detective. |
| Fine print (`fine-print`) | A big promise and the catch under it. | promise → catch | $250M of compute for UK researchers; providers and terms still to be agreed. |
| Outrage vs shrug (`outrage-vs-shrug`) | An angry accusation and an unbothered answer. | accuser (optional) → accusation → reply | Police: two months is unacceptable. Anthropic: minimal impact. |
| The viewer's day (`viewers-day`) | How the news lands in the viewer's own day with AI products. | news → viewer | A new top model: me, deciding which one to use this week. |

## Rules every turn follows (checked in code)

- Every beat cites the brief's fact IDs (a viewer or chooser beat may not).
- Beats follow the type's order, each once, with every required beat present.
- Beats are plain words: no name a casual follower would not know (the legibility lint).
- The payoff states what happened: no hedge ("may", "says", "claims").
- No beat narrates someone speaking ("Tell…", "Announce…").
- A beat resting on a company's [CLAIM] casts that company (its player id) or names it.
- Only a viewer's-day turn, or one marked as touching the viewer, may put "Me" in a meme (ME-105).
- A spread turn draws on every story; a landscape turn on at least two.
