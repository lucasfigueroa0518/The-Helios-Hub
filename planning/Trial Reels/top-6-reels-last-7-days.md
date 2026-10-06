# Top 6 scoring reels, Sep 29–Oct 5, 2026

These are the six highest idea scores among the 18 reels that published in this window. Score is the idea net: psychology + bucket + value + blockbuster. A higher net is a higher rank that night. The copy gate is separate. Only one of these six cleared it.

Two of the six are the same Microsoft story, posted on different days (Oct 2 morning and Oct 4 morning).

## 1. Oct 4, morning

Published. Night rank 1. Net 2.853 (psychology 0.965, bucket 0.985, value 0.803, blockbuster 0.100).

The Saga, arousal. Writer `copy-caption-v12`. Copy gate missed.

Source: Claude web search, "16-Year-Old Researcher Used His Own AI Tool to Find a Microsoft Flaw Exposing 17.3 Trillion Database Rows".

Viewer stake: A teenager got Microsoft's internal system to treat him as an administrator, with 17.3 trillion company records within reach.

On-screen copy:

```
A 16-year-old's AI hacking assistant spent about ten days testing Microsoft's systems,
then got stuck.
One human guess, typing "admin," got him in as an administrator.
17.3 trillion records were within reach.
```

Caption:

A 16-year-old typed "admin" into a forged Microsoft login, and the system treated him as its own administrator.

Behind that door sat 17.3 trillion records. He could have reached them.

The teen goes by Faav online. On August 25, 2026, he pointed an AI hacking assistant he built, called Antares, at Microsoft's internal systems.

It found a service called Titan. Its front page said "VPN REQUIRED," meant to keep out anyone but employees. Antares found the back entrance anyway.

Then came ten days of grunt work. The AI tested the system again and again, and it stalled.

Here is the flaw. Titan checked what a login pass said about its owner. It never checked the signature proving Microsoft had actually issued that pass.

So Faav made a pass with a blank signature. Titan accepted it.

The AI's automated tries with email-style names failed. Faav changed the name to just "admin." Titan read it as a local administrator account and ran the database command he sent.

Behind it were 17 connected analytics databases with 9,863 tables. Adding up row counts from the system's own metadata, he estimated 17,333,335,124,315 rows.

Faav says he kept to table descriptions, metadata and two single-row samples. He says he never touched customer personal data. The metadata alone held about 25,000 account records and 17,990 Microsoft employee email records.

He reported it to Microsoft on September 5. Microsoft locked down the endpoint by September 9 and paid him a $5,000 bug bounty on September 17.

In his write-up, Faav said the find took the AI's persistence plus one human hunch. SOCRadar's Ensar Seker said it shows how one missing check on who issued a login can defeat otherwise solid access controls.

The takeaway for anyone using AI at work: it did the slog, and a person made the call that got it through.

Call to action: Send this to the friend who thinks a company's login screen means the data behind it is safe.

Hashtags: #AI #Cybersecurity #Microsoft #BugBounty

## 2. Oct 1, morning

Published. Night rank 1. Net 2.820 (psychology 0.978, bucket 0.973, value 0.870, blockbuster 0.000).

The Saga, arousal. Writer `copy-caption-v10`. Copy gate passed.

Source: 404 Media, "Lawyer Cites ChatGPT-Invented Fake Witnesses in Murder Appeal".

Viewer stake: ChatGPT can invent names and quotes that look real, and a lawyer who trusted it lost his case and his client paid.

On-screen copy:

```
A man is serving life for killing his wife.
His lawyer's court filing cited
witnesses ChatGPT made up.
A judge asked the lawyer:
do you read the news?
```

Caption:

A New Mexico lawyer let ChatGPT write a brief in a murder case. It invented the witnesses.

His client had already been found guilty of killing his wife this year. He is serving life. The brief was supposed to help him.

Instead it quoted people who do not exist. A Danny Stanton, who said he got threats. A Linda Stanton, who said her husband got threats. More made-up people gave statements about the shooter's clothing and appearance.

Five New Mexico Supreme Court judges caught it. At a hearing in August, the lawyer, Stephen Aarons, said he "assumed" ChatGPT would write a "bulletproof summary of proceedings."

Why did he trust it? He said he had heard of doctors using AI for medical research.

Then a judge asked him: "Do you watch the news? Do you listen to the radio?" The judge said lawyers relying on AI making things up is "an above-the-fold story every single day."

It gets worse. Aarons admitted he had not told his client he used ChatGPT. He told the client's family only that there was "a problem with the brief."

The court found him in direct contempt. He was referred to the Disciplinary Board, barred from appearing before the court while it investigates, and thrown off the case. A public defender took over for his client. He was also sanctioned $5,000. Per 404 Media, which says lawyers have been caught doing this for years.

Here is what to take from it. ChatGPT can write confident text with names, quotes, and facts that were never real, and it will not warn you. If a detail matters, check it against the real document or the real person before you use it. If you cannot find it, treat it as made up.

Call to action: Send this to the one person you know who pastes AI answers into work without checking them.

Hashtags: #ChatGPT #AI #AIMistakes #LegalNews #AIHallucinations

## 3. Oct 1, midday

Published. Night rank 2. Net 2.770 (psychology 0.960, bucket 0.920, value 0.790, blockbuster 0.100). Tied with the Oct 2 morning reel.

The Saga, arousal. Writer `copy-caption-v10`. Copy gate missed.

Source: Hacker News, "Owed a billion dollars in Nvidia stock".

Viewer stake: A signed contract can be worth a billion dollars, and a company can still win by waiting until you are too late.

On-screen copy:

```
In 1996, Nvidia said an advisor
had earned 15,625 of 25,000 shares.
In 2024, he reread his contract:
all 25,000, within a year.
The gap is a billion dollars, he says.
```

Caption:

Eric Gullichsen says a contract in his old files means Nvidia owes him a billion dollars in stock.

Nvidia's lawyers did not deny the contract was real. They said he waited too long.

It starts in 1993. Nvidia's founders came to his houseboat in Sausalito for a demo of his fast texture mapping method for 3D graphics. He had run an early virtual reality company.

They invited him onto Nvidia's Technical Advisory Board. He was granted 25,000 stock options, which are the right to buy shares at a set price. The agreement said all of them would vest, meaning become his to buy, within one year.

Then Nvidia's first chip shipped in 1995. Microsoft chose not to support his approach. In Gullichsen's telling, that hit Nvidia's finances hard and the company laid off a large share of its staff.

In April 1996, Nvidia's CFO wrote him. The letter said 15,625 shares had vested and he had to exercise them. He did, and forgot about it.

Here is the catch. 15,625 of 25,000 is 62.5%. That is exactly what you get after ten quarters of a four-year schedule. The contract he signed said one year.

Fast-forward to 2024. He is sitting with a day-trader friend, screens everywhere blaring Nvidia news. He goes home and digs out the old folder.

His missing 9,375 shares had gone through splits totaling 480x. They are now 4,500,000 shares.

He hired two attorneys, Allan Steyer and Chris Burke. A year of letters followed. Nvidia's outside law firm, Cooley, finally answered, in essence: so sue us.

His lawyers agreed the time limit for suing had probably run out. Thirty-odd years had passed, and a judge would likely throw the case out early.

His own conclusion: a company only has to honor its contract for a little while.

This is his account, published on his own site and shared on Hacker News. The post does not include a comment from Nvidia.

The way out is boring and real. If you hold stock options or any equity deal, read the signed agreement, not the letter that summarizes it. Keep a copy. Check the dates while you can still act.

Send this to the friend who has an old equity agreement sitting in a drawer.

Call to action: Send this to the friend who has an old equity agreement sitting in a drawer.

Hashtags: #Nvidia #StockOptions #TechStories #Startups

## 4. Oct 2, morning

Published. Night rank 1. Net 2.770 (psychology 0.953, bucket 0.960, value 0.758, blockbuster 0.100). Tied with the Oct 1 midday reel. Same Microsoft story as the Oct 4 morning reel.

The Saga, arousal. Writer `copy-caption-v12`. Copy gate missed.

Source: Hacker News, "I could've accessed 17T Microsoft records".

Viewer stake: A teenager and an AI bot reached an estimated 17.3 trillion Microsoft records through one basic miss, so even giants slip.

On-screen copy:

```
Microsoft built an internal system
that never checked if a login pass was real.
A 16-year-old and an AI bot found it.
An estimated 17.3 trillion records
sat within reach.
```

Caption:

A 16-year-old and an AI bot spent ten days stuck on one Microsoft system. One word finally got them in: admin.

The system checked the details on a login pass but never checked whether the pass was real. Per the teen's own write-up, that left an estimated 17.3 trillion stored rows within reach.

Here is how it went.

On August 25, 2026, a hacking bot called Antares found an internal Microsoft service named Titan. Its website said "VPN REQUIRED," so the front door was shut. The bot found a back entrance anyway.

For ten days, Antares kept sending fake login passes and getting rejected. One error at a time, it got further. It never found a username the system would accept.

Then came 1 AM on Saturday, September 5. The teen, who goes by Faav, had spent Friday on schoolwork. He tried a hunch. What if the system treated the "email" field as a plain username?

He typed admin.

The answer came back as the number 1. After ten days of errors, that 1 meant he was running commands as the system's administrator.

Why did the bot miss it? Admin is obviously not an email address. That is exactly why Antares never tried it. Faav says the bot did the grinding and the human spotted what the system was really doing.

Then he checked the scale. Inside were about 25,000 account and email records and 17,990 employee email records. Bing search analytics were reachable too, and he pulled just two single rows to confirm it.

He counted 30 live entry points, 17 analytics databases and 9,863 tables. His AI added up the totals: 17,333,335,124,315. It was 2 AM. He checked again and got the same number both ways.

Two caveats from the post. The number is an estimate that likely includes old, duplicated and derived data. And Faav says the impact is hypothetical: he never touched customer data. He also notes Microsoft had editorial control over the post and cut sections and figures.

The way out was a quick one. He reported it the same day. Microsoft locked the endpoint on September 9 and paid him $5,000 on September 17.

His own comparison: a hotel where every door has a working keycard reader, but any keycard opens any room.

Call to action: Send this to the friend who builds apps with AI coding tools.

Hashtags: #AI #Microsoft #CyberSecurity #BugBounty #AIAgents

## 5. Oct 3, midday

Published. Night rank 1. Net 2.750 (psychology 0.955, bucket 0.938, value 0.858, blockbuster 0.000).

The Saga, arousal. Writer `copy-caption-v12`. Copy gate missed.

Source: 404 Media, "Federal Judge Rules a Flock Search Was ‘Indiscriminate Mass Surveillance’ and Unconstitutional".

Viewer stake: Police can pull a month of your car's travels without a warrant. A judge just called that unconstitutional.

On-screen copy:

```
A deputy followed a car for its California plates.
One search showed a month of her travels.
A judge called it mass surveillance
and threw out evidence of 91 pounds of meth.
```

Caption:

A Tulsa County deputy saw a Mazda with California plates on an Oklahoma highway. That was the whole reason he followed it.

This was May. The deputy, Freddie Alaniz, ran the plate through Flock, a camera network that logs where cars have been.

The search gave him more than 50 records of the driver's whereabouts across the country. Over one month.

Then he pulled her over for changing lanes without a turn signal.

He made her recount everything she'd done for several days and checked her answers against the Flock data. She'd only been in California briefly, he said, so he suspected drug trafficking. He used her travel history as part of the reason to search her car.

He found 91 pounds of meth.

Then the case reached federal judge Sara Hill. Per 404 Media, she ruled the Flock search was an unconstitutional warrantless search. All the Flock evidence and everything from the car search had to be thrown out.

Her reasoning is the part to know. Older rulings said you have no privacy on public roads, leaning on a case from 1983 about a tracking device on one chemical container. Hill said that case dealt with far simpler technology.

Flock is different, she wrote. Officers get a continuously updated location history for every vehicle the cameras catch, and the system serves it up on demand. In her words, \"a type of indiscriminate mass surveillance.\"

That includes your car, whether or not anyone suspects you of anything.

There's a catch. The ruling doesn't set binding precedent, and other cases across the country are still deciding this. Flock wasn't a party to the case. A spokesperson told 404 Media it expects an appeal and an overturn.

404 Media also reported more than a hundred thousand warrantless Flock searches every month, based on audit logs. Earlier this week, a separate jury found a Border Patrol traffic stop scheme built on plate scans unconstitutional.

So the courts are the place to watch. This one ruling cracked open a question police had treated as settled.

Call to action: Send this to the friend who drives cross-country and assumes nobody tracks where the car goes.

Hashtags: #AI #Privacy #Flock #Surveillance #LicensePlateReaders

## 6. Oct 3, evening

Published. Night rank 2. Net 2.650 (psychology 0.928, bucket 0.963, value 0.760, blockbuster 0.000).

The Number, curiosity. Writer `copy-caption-v12`. Copy gate missed.

Source: Cloudflare blog, "The Internet has a second audience".

Viewer stake: When your chatbot reads websites for you, those sites lose visitors and ad money, and the free web you use pays for it.

On-screen copy:

```
Your chatbot reads websites so you don't.
Some lost up to 40% of visitors.
```

Caption:

Ask a chatbot a question and software may visit websites to find the answer. You get a summary. The site gets no visit, no ad money, and no new subscriber, but it still pays for the traffic.

The numbers, per a Cloudflare blog post by Matthew Conroy: this year, for the first time, more than half of Internet traffic wasn't human. Daily requests from AI agents on Cloudflare's network grew by more than 1,700% in a year. In some of the most heavily crawled categories, including retail, software, IT and financial services, human traffic fell as much as 40% in less than a year.

A caveat: these figures come from Cloudflare's own network. The company says more than 20% of the web sits behind it. Cloudflare also sells tools for this problem, so read the post as one company's view.

Why it matters to you: sites earn money when a person visits, through ads and subscriptions. A summary delivers neither, while every automated visit still costs the site bandwidth. The sites you read and shop on are being squeezed by the tools you use to skip them.

What Cloudflare says it is doing about it: since July, sites can set separate rules for search, agents and AI training. And it launched two beta products that charge AI companies when a site's content is actually used. The idea is a web that can say "yes, if you pay" instead of just yes or no.

Not all of that traffic is a problem, either. An agent booking a table or comparing insurance quotes is working for a real person. Cloudflare's point is that sites need a way to tell the difference and get paid.

Call to action: Save this post so you remember who pays when your chatbot reads the web for you.

Hashtags: #AI #ChatGPT #Cloudflare #AIAgents
