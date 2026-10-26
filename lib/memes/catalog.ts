/**
 * The classic template catalog: the 60 cards Lucas approved
 * (planning/Memes/TEMPLATE_CARDS.md, ME-53, ME-97), as data. The writer's
 * prompt and every code check read this file, so a card changes here only
 * with his approval. Slot geometry (where each slot sits in pixels) is
 * measured separately, in lib/memes/geometry.ts.
 */
import { GOLDEN_SLOTS } from './golden-slots.generated';
import type { ExcludedTemplate, TemplateCard, TemplateSlot } from './types';

const s = (id: string, where: string, role: string, accepts: TemplateSlot['accepts'], extra: Partial<TemplateSlot> = {}): TemplateSlot => ({
  id, where, role, accepts, ...extra,
});

const APPROVED_CARDS: readonly TemplateCard[] = [
  {
    id: 'drake', imgflipId: '181913649', name: 'Drake Hotline Bling', rank: 1, image: 'drake.jpg', width: 1200, height: 1200,
    logic: 'reject A, approve B',
    slots: [
      s('rejected', 'top-right panel', 'what is rejected', ['text', 'entity'], { must: 'Something the viewer turns away from: a real option, product, habit or claim in the story.' }),
      s('preferred', 'bottom-right panel', 'what is preferred', ['text', 'entity'], { must: 'What the viewer prefers instead: another real option in the story, preferred for a reason the facts give (cheaper, newer, easier), never because we pick a winner.' }),
    ],
    situations: ['AS-01', 'AS-02', 'AS-04', 'AS-10', 'AS-12', 'AS-13', 'AS-19'], landscape: true, family: 'Drakeposting', burnedIn: null,
    watch: "The preference must be the viewer's, not us declaring a winner (AS-10). Drake is implicitly the viewer.",
  },
  {
    id: 'two-buttons', imgflipId: '87743020', name: 'Two Buttons', rank: 2, image: 'two-buttons.jpg', width: 600, height: 908,
    logic: 'a dilemma between two options',
    slots: [
      s('left-button', 'left button', 'one option', ['text', 'entity'], { must: 'One of two real options that someone in the story, or the viewer, has to choose between.' }),
      s('right-button', 'right button', 'the other option', ['text', 'entity'], { must: 'The other option. The two must be genuinely hard to choose between.' }),
      s('chooser', 'sweating man', 'who has to choose', ['viewer', 'entity'], { must: 'Who has to choose: the viewer, or a player the facts show facing this exact choice.' }),
    ],
    situations: ['AS-02', 'AS-05', 'AS-13', 'AS-16', 'AS-17'], landscape: true, family: 'Daily Struggle', burnedIn: null,
    watch: 'Both buttons must be real options from the story.',
  },
  {
    id: 'distracted-boyfriend', imgflipId: '112126428', name: 'Distracted Boyfriend', rank: 3, image: 'distracted-boyfriend.jpg', width: 1200, height: 800,
    logic: 'abandon A for B',
    slots: [
      s('new-thing', 'woman in red (left)', 'the new thing', ['entity', 'text'], { must: 'The new, tempting thing that pulls attention away.' }),
      s('tempted', 'boyfriend (center)', 'who is tempted', ['viewer', 'entity'], { must: 'Who is tempted: the viewer, or a player whose attention the facts show shifting to the new thing.' }),
      s('current-thing', 'girlfriend (right)', 'the current thing', ['entity', 'text'], { must: 'What they already have or are committed to, and are turning away from.' }),
    ],
    situations: ['AS-01', 'AS-05', 'AS-10', 'AS-13', 'AS-19'], landscape: true, family: 'Distracted Boyfriend', burnedIn: null,
    watch: 'Labels sit on clothing, never on faces.',
  },
  {
    id: 'uno-draw-25', imgflipId: '217743513', name: 'UNO Draw 25 Cards', rank: 5, image: 'uno-draw-25.jpg', width: 500, height: 494,
    logic: 'would rather suffer than do the obvious thing',
    slots: [
      s('obvious-thing', 'card (left), above "OR draw 25"', 'the obvious thing', ['text'], { must: 'An easy, sensible action, written as the action itself (\'Cancel one plan\'), that the refuser could take but won\'t.' }),
      s('refuser', 'man holding a full hand (right)', 'who refuses', ['viewer', 'entity'], { must: 'Who would rather suffer than take that action: the viewer, or a player the facts show avoiding it.' }),
    ],
    situations: ['AS-02', 'AS-04', 'AS-08', 'AS-13', 'AS-18'], landscape: false, family: 'UNO Draw 25 Cards', burnedIn: '"OR draw 25" on the card',
    watch: 'The card line must fit above the printed text.',
  },
  {
    id: 'left-exit-12', imgflipId: '124822590', name: 'Left Exit 12 Off Ramp', rank: 7, image: 'left-exit-12.jpg', width: 804, height: 767,
    logic: 'the swerve: the sensible path vs. the tempting exit',
    slots: [
      s('sensible-way', 'straight arrow', 'the sensible way', ['text'], { must: 'The expected, steady path.' }),
      s('tempting-exit', 'exit arrow', 'the tempting exit', ['text', 'entity'], { must: 'The sudden swerve someone actually takes instead of the sensible path: the story\'s twist.' }),
      s('swerver', 'car', 'who swerves', ['viewer', 'entity'], { must: 'Who takes the exit: the viewer, or the player the facts show swerving.' }),
    ],
    situations: ['AS-05', 'AS-13', 'AS-17', 'AS-19'], landscape: true, family: 'Left Exit 12 Off Ramp', burnedIn: '"LEFT EXIT 12" on the sign',
    watch: 'The sign is small; keep both arrow lines short.',
  },
  {
    id: 'anakin-padme', imgflipId: '322841258', name: 'Anakin Padme 4 Panel', rank: 8, image: 'anakin-padme.png', width: 768, height: 768,
    logic: 'naive hope, ominous answer',
    slots: [
      s('speaker', 'Anakin (panel 1), top strip above his head', 'who makes the announcement (optional label)', ['entity'], { optional: true, must: 'Optional. The company that made the announcement, as a logo. Leave empty when the announcement makes the speaker obvious.' }),
      s('announcement', 'Anakin (panel 1), lower half', 'what Anakin says', ['text'], { must: "The real announcement in the speaker's own voice, first person or a plain claim ('We're adding ads to free chats'). It must leave a darker reading plainly open." }),
      s('hope', 'Padme smiling (panel 2)', 'the hopeful assumption, said back to the speaker', ['text'], { must: "The good outcome an ordinary user would assume follows, said back to the speaker: 'So X', 'You'll X', or a clipped innocent reading. Never starts with 'Me'. The story must leave it genuinely open. Write only the assumption; code adds ', right?' and repeats it in the last panel.", pattern: '{x}, right?' }),
      s('doubt', 'Padme worried (panel 4)', 'the same question, now uneasy', [], { derived: { from: 'hope', as: 'repeat' } }),
    ],
    situations: ['AS-03', 'AS-06', 'AS-09', 'AS-14', 'AS-15', 'AS-18'], landscape: false, family: 'For the Better, Right?', burnedIn: null,
    watch: "The ominous silence must be earned: the story must leave the question really open, not imply a bad answer it doesn't report.",
  },
  {
    id: 'epic-handshake', imgflipId: '135256802', name: 'Epic Handshake', rank: 9, image: 'epic-handshake.jpg', width: 900, height: 645,
    logic: 'two unlike parties agree on one thing',
    slots: [
      s('left-arm', 'left arm', 'one party', ['entity', 'viewer'], { must: 'One of two parties that are usually apart or rivals.' }),
      s('right-arm', 'right arm', 'the other party', ['entity', 'viewer'], { must: 'The other party. The pair must be an unlikely match.' }),
      s('clasp', 'the clasp', 'what they agree on', ['text'], { must: 'The one thing both parties really agree on or both do, per the facts.' }),
    ],
    situations: ['AS-05', 'AS-07', 'AS-10'], landscape: true, family: 'Epic Handshake', burnedIn: null,
    watch: 'The agreement must be in the facts (a shared move, a joint deal).',
  },
  {
    id: 'grus-plan', imgflipId: '131940431', name: "Gru's Plan", rank: 10, image: 'grus-plan.jpg', width: 700, height: 449,
    logic: 'a plan whose own steps cause its flaw',
    slots: [
      s('step-1', 'board 1', 'step one', ['text'], { must: 'The first move of a plan, as an action the actor takes (\'Hire people away from Apple\'). Never someone speaking or announcing.' }),
      s('step-2', 'board 2', 'step two', ['text'], { must: 'The next action by the same actor, still going fine.' }),
      s('flaw', 'board 3', 'the flaw', ['text'], { must: 'A definite consequence the two steps caused, per the facts, that undoes the plan. Never a caveat, a hedge (\'may\') or a quote.' }),
      s('flaw-again', 'board 4', 'the flaw again (Gru re-reads it)', [], { derived: { from: 'flaw', as: 'repeat' } }),
    ],
    situations: ['AS-07', 'AS-08', 'AS-15', 'AS-18'], landscape: false, family: "Gru's Plan", burnedIn: null,
    watch: 'Steps are actions by one actor; the flaw is caused by them and is a fact, not an invented failure or a caveat.',
  },
  {
    id: 'running-away-balloon', imgflipId: '131087935', name: 'Running Away Balloon', rank: 11, image: 'running-away-balloon.jpg', width: 761, height: 1024,
    logic: 'something holds you back from what you want',
    slots: [
      s('wanter', 'man (top)', 'who wants it', ['viewer'], { must: 'Who wants something (usually the viewer).' }),
      s('want', 'balloon (top)', 'what they want', ['text', 'entity'], { must: 'What they want and are reaching for: a feature, a price or a plan in the story.' }),
      s('holder', 'pink figure (bottom)', 'what holds them back', ['text', 'entity'], { must: 'What holds them back from it: a limit, rule, cost or delay in the story.' }),
      s('wanter-again', 'man (bottom)', 'who wants it, repeated', [], { derived: { from: 'wanter', as: 'repeat' } }),
      s('want-again', 'balloon (bottom)', 'what they want, repeated', [], { derived: { from: 'want', as: 'repeat' } }),
    ],
    situations: ['AS-04', 'AS-11', 'AS-13', 'AS-17'], landscape: false, family: 'Running Away Balloon', burnedIn: null,
    watch: 'Five slots; the repeats keep the same labels.',
  },
  {
    id: 'disaster-girl', imgflipId: '97984', name: 'Disaster Girl', rank: 12, image: 'disaster-girl.jpg', width: 500, height: 375,
    logic: 'the culprit smirks at the mess they made',
    slots: [
      s('mess', 'top, over the burning house', 'what got wrecked, or the setup', ['text', 'entity'], { must: "The product, feature, plan or thing users relied on that the culprit's own decision ended, as a label ('The free tier'), or a short setup. Never people, injuries or an accident with victims. Never say fire or burning." }),
      s('culprit', 'the girl, upper right above her head', 'who did it, smug (or her deadpan line)', ['entity', 'viewer', 'text'], { must: "The party whose deliberate decision, per the facts, caused the mess: a company as a logo, the viewer, or a deadpan first-person payoff line. Never a bystander or rival who merely benefits." }),
    ],
    situations: ['AS-10'], landscape: true, family: 'Disaster Girl', burnedIn: null,
    watch: 'The photo shows a fire, so it is never used for a real disaster, an outage with victims, or harm. The mess must be a product or business stumble.',
  },
  {
    id: 'waiting-skeleton', imgflipId: '4087833', name: 'Waiting Skeleton', rank: 13, image: 'waiting-skeleton.jpg', width: 298, height: 403,
    logic: 'waiting forever for something promised',
    slots: [
      s('wait', 'top strip above the skull', 'who waits and for what, in one line', ['viewer', 'text'], { must: "One line 'Me waiting for [the promised thing]': a feature, rollout or release the facts show was promised or dated and hasn't arrived. Quote the story's timeframe when it gives one ('in the coming weeks')." }),
      s('still', 'bottom strip over the feet and bench', 'the time stamp or the latest slip', ['text'], { optional: true, must: "Optional. The latest slip or how long it has been, from the facts only (a new date, 'still waitlisted'). Leave empty when the facts have no slip." }),
    ],
    situations: ['AS-11'], landscape: false, family: 'Waiting Skeleton', burnedIn: null,
    watch: 'A photo of a prop skeleton, not death imagery; still never for a story involving a death. Small image; may need upscaling.',
  },
  {
    id: 'x-everywhere', imgflipId: '91538330', name: 'X, X Everywhere', rank: 15, image: 'x-everywhere.jpg', width: 2118, height: 1440,
    logic: 'something is suddenly everywhere',
    slots: [
      s('thing', 'Buzz, top line', '"[X]"', ['text'], { must: 'The thing that is suddenly everywhere, in 1 to 3 words.' }),
      s('everywhere', 'Buzz, bottom line', '"[X] everywhere"', [], { derived: { from: 'thing', as: 'everywhere' } }),
      s('noticer', 'Woody', 'who notices', ['viewer'], { optional: true, must: 'Who notices it everywhere (the viewer).' }),
    ],
    situations: ['AS-05', 'AS-08', 'AS-15', 'AS-16'], landscape: true, family: 'X, X Everywhere', burnedIn: null,
    watch: '"Everywhere" must be true of the week\'s stories.',
  },
  {
    id: 'trade-offer', imgflipId: '309868304', name: 'Trade Offer', rank: 16, image: 'trade-offer.jpg', width: 607, height: 794,
    logic: 'a lopsided deal',
    slots: [
      s('i-receive', 'under "i receive"', 'what the offerer gets', ['text'], { must: 'What the offering player gets out of the deal: what it takes from the other side.' }),
      s('you-receive', 'under "you receive"', 'what the other side gets', ['text'], { must: 'What the other side gets in return.' }),
      s('offerer', 'the man', 'who is offering', ['entity'], { must: 'The player making the offer.' }),
    ],
    situations: ['AS-02', 'AS-04', 'AS-09', 'AS-12'], landscape: false, family: 'Trade Offer', burnedIn: '"TRADE OFFER", "i receive:", "you receive:"',
    watch: "Both sides of the trade must come from the story's terms; never invent what a company takes.",
  },
  {
    id: 'woman-yelling-at-cat', imgflipId: '188390779', name: 'Woman Yelling At Cat', rank: 19, image: 'woman-yelling-at-cat.jpg', width: 680, height: 438,
    logic: 'an angry accusation, an unbothered reply',
    slots: [
      s('complaint', 'woman (left)', 'the complaint', ['viewer', 'text'], { must: 'An angry accusation or complaint aimed at the player: the viewer\'s, or a critic\'s in the facts.' }),
      s('reply', 'cat (right)', 'the unbothered response', ['entity', 'text'], { must: 'The player\'s unbothered answer: what it actually said or did in response.' }),
    ],
    situations: ['AS-03', 'AS-04', 'AS-14'], landscape: true, family: 'Woman Yelling at a Cat', burnedIn: null,
    watch: "The cat's line must be what the company actually said or did.",
  },
  {
    id: 'marked-safe-from', imgflipId: '161865971', name: 'Marked Safe From', rank: 22, image: 'marked-safe-from.jpg', width: 618, height: 499,
    logic: 'relief at dodging something',
    slots: [
      s('who', 'beside the flag, upper left', 'who is marked safe', ['entity', 'viewer', 'text'], { optional: true, must: 'Optional. The party the facts exempt from the thing: a company (logo), a region, a plan, or the viewer. Leave empty when the viewer in general is safe.' }),
      s('dodged', 'after "Marked Safe From"', 'what was dodged', ['text'], { must: "A bare noun or gerund phrase (1-5 words) naming a non-tragic annoyance in the story that hits others but not the 'who' (or the viewer). Mock-solemn about trivia, never real relief." }),
    ],
    situations: ['AS-04', 'AS-18'], landscape: false, family: 'Marked Safe From', burnedIn: 'the flag, "Marked Safe From", "Today"',
    watch: 'It imitates a disaster check-in, so it is never used near a real disaster or harm.',
  },
  {
    id: 'ancient-aliens', imgflipId: '101470', name: 'Ancient Aliens', rank: 23, image: 'ancient-aliens.jpg', width: 500, height: 436,
    logic: 'one pet explanation for everything',
    slots: [
      s('setup', 'top', 'the setup', ['text'], { must: 'A real "why" question about something the facts show happening.' }),
      s('explanation', 'bottom', 'the one explanation', ['text'], { must: 'The one pet cause someone keeps reaching for (AI, money, a vested interest), in 1 to 3 words, said with total conviction; the facts must point to it. Never a literal trivia answer.' }),
    ],
    situations: ['AS-05', 'AS-08'], landscape: true, family: 'Ancient Aliens', burnedIn: 'the History channel logo',
    watch: 'The joke is the pet cause said like a conspiracy; the setup is factual and the cause is what the facts point to. Not a quiz.',
  },
  {
    id: 'bike-fall', imgflipId: '79132341', name: 'Bike Fall', rank: 24, image: 'bike-fall.jpg', width: 500, height: 680,
    logic: 'a plan, a self-inflicted move, and the crash it causes',
    slots: [
      s('goal', 'panel 1, upper right, beside the stick', 'what the rider set out to do', ['text'], { must: "The rider's aim, in the facts, as a short phrase (3-6 words): 'Keep users on the app'." }),
      s('rider', 'rider (panel 1)', 'who sabotages themselves', ['entity', 'viewer'], { must: 'The party whose own action later causes its own problem.' }),
      s('self-move', 'the stick in the wheel (panel 2)', 'the self-inflicted move', ['text'], { must: "An action the rider itself took, from the facts, as a present-tense verb phrase or gerund (2-6 words). Never an omission, a rule, or another party's act." }),
      s('outcome', 'on the ground (panel 3)', 'what hits the rider', ['text'], { must: 'The result that lands on the rider itself and follows from the move, as a fact (users leave, a fine, a reversal). Never an excuse or a defense.' }),
    ],
    situations: ['AS-14'], landscape: true, family: 'Bike Fall', burnedIn: null,
    watch: 'It asserts fault, so both the move and the crash must be in the facts. Never for an incident with victims.',
  },
  {
    id: 'mocking-spongebob', imgflipId: '102156234', name: 'Mocking Spongebob', rank: 25, image: 'mocking-spongebob.jpg', width: 502, height: 353,
    logic: 'mocking a hollow line by repeating it',
    slots: [
      s('claim', 'top', 'the claim, as said', ['text'], { must: 'A line said at someone in the story (a scolding, a dismissal, an excuse), quoted from the facts, that the facts show is hollow. Never a product\'s marketing line.' }),
      s('mocked', 'bottom', 'the same claim in alternating caps', [], { derived: { from: 'claim', as: 'mocking-case' } }),
    ],
    situations: ['AS-06', 'AS-15'], landscape: false, family: 'Mocking SpongeBob', burnedIn: null,
    watch: 'Only a hollow line said at someone, quoted exactly; never a marketing claim, never a person\'s words to mock the person.',
  },
  {
    id: 'is-this-a-pigeon', imgflipId: '100777631', name: 'Is This A Pigeon', rank: 26, image: 'is-this-a-pigeon.jpg', width: 1587, height: 1425,
    logic: 'confidently mislabeling something',
    slots: [
      s('mislabeler', 'the man', 'who mislabels', ['entity', 'viewer'], { must: 'Who confidently mislabels something.' }),
      s('thing', 'the butterfly', 'the thing', ['text'], { must: 'The thing being mislabeled.' }),
      s('question', 'bottom caption', '"Is this [X]?"', ['text'], { must: 'The wrong label they give it. Write only the label; code prints \'Is this {x}?\'.', pattern: 'Is this {x}?' }),
    ],
    situations: ['AS-07', 'AS-14', 'AS-16'], landscape: false, family: 'Is This a Pigeon?', burnedIn: null,
    watch: 'If a company is the mislabeler, the mislabel must be documented.',
  },
  {
    id: 'you-guys-getting-paid', imgflipId: '177682295', name: 'You Guys are Getting Paid', rank: 27, image: 'you-guys-getting-paid.png', width: 520, height: 358,
    logic: "shock at someone else's better deal",
    slots: [
      s('setup', 'top', 'the setup', ['text'], { must: 'The speaker and the worse deal they get, both visible on the image (\'Me, paying $20 a month\'), from the facts.' }),
      s('reveal', 'bottom', '"You guys are getting [X]?"', ['text'], { must: 'The better deal the other side gets, which the speaker just found out about. The meme must make clear who "you guys" are. Write only the deal; code prints \'You guys are getting {x}?\'. A real deal in the facts, never a company\'s sales claim or offer to the viewer.', pattern: 'You guys are getting {x}?' }),
    ],
    situations: ['AS-02', 'AS-12'], landscape: false, family: 'You Guys Are Getting Paid?', burnedIn: null,
    watch: 'Any figure is quoted as the source writes it.',
  },
  {
    id: 'one-does-not-simply', imgflipId: '61579', name: 'One Does Not Simply', rank: 28, image: 'one-does-not-simply.jpg', width: 568, height: 335,
    logic: 'something is harder than it looks',
    slots: [
      s('opener', 'top', '"One does not simply"', [], { fixed: 'One does not simply' }),
      s('hard-thing', 'bottom', 'the hard thing', ['text'], { must: 'Something the story\'s player or the viewer treats as easy that the facts show is hard, said as the easy-sounding action.' }),
    ],
    situations: ['AS-13', 'AS-15', 'AS-18'], landscape: false, family: 'One Does Not Simply Walk into Mordor', burnedIn: null,
    watch: 'Only when the thing truly sounds easy; an old format that reads dated unless the line is sharp.',
  },
  {
    id: 'buff-doge-cheems', imgflipId: '247375501', name: 'Buff Doge vs. Cheems', rank: 29, image: 'buff-doge-cheems.png', width: 937, height: 720,
    logic: 'strong then vs. weak now (or big vs. small)',
    slots: [
      s('strong', 'white strip above buff Doge', 'the thing at its mightiest', ['entity', 'text'], { must: "The same thing as weak (same company, product or group) at an earlier time or in the promise, or a direct rival doing the same job. A short label, ideally the shared name plus a qualifier ('Free plan in 2024')." }),
      s('strong-caption', 'below buff Doge', 'what the mighty one says, in its own proud voice', ['text'], { must: 'A first-person line in the strong one\'s voice that states the feat from the facts.' }),
      s('weak', 'white strip above Cheems', 'the same thing at its most pathetic', ['entity', 'text'], { must: "The same thing as strong with the opposite qualifier ('Free plan now'), or the rival in the same role. The facts must show it is weaker on the very thing the captions compare." }),
      s('weak-caption', 'below Cheems', 'the weak one failing or whimpering at the same act', ['text'], { must: 'A first-person line in Cheems\'s voice about the SAME act or quality as strong-caption, showing the comedown from the facts; short and whiny is fine.' }),
    ],
    situations: ['AS-01', 'AS-05', 'AS-12'], landscape: true, family: 'Swole Doge vs. Ironic Doge', burnedIn: null,
    watch: 'A "weak now" claim about a company must be backed by facts, not taste.',
  },
  {
    id: 'same-picture', imgflipId: '180190441', name: "They're The Same Picture", rank: 30, image: 'same-picture.jpg', width: 1363, height: 1524,
    logic: 'two supposedly different things are the same',
    slots: [
      s('left-picture', 'left picture', 'one thing', ['entity', 'text'], { must: 'One thing presented as different from the other (a new name, a new product, a new promise).' }),
      s('right-picture', 'right picture', 'the other thing', ['entity', 'text'], { must: 'The other thing. The facts must show the two are the same thing, not merely two of a kind.' }),
      s('pam', 'Pam', 'who sees they are the same', ['viewer'], { optional: true, must: 'Who sees they are the same (the viewer).' }),
    ],
    situations: ['AS-05', 'AS-16'], landscape: true, family: 'Corporate Needs You to Find the Differences', burnedIn: 'both subtitles',
    watch: '"The same" must hold in the facts (same feature, same price), not just look alike.',
  },
  {
    id: 'zero-days-without', imgflipId: '427308417', name: '0 Days Without (Lenny, Simpsons)', rank: 31, image: 'zero-days-without.png', width: 619, height: 403,
    logic: 'it happened again',
    slots: [
      s('event', 'after "DAYS WITHOUT"', 'the bad act that never stops', ['text'], { must: "A bad, annoying or embarrassing act, named as a gerund or noun phrase (never its absence), that the facts show happening again and again, so often the count can't leave zero." }),
      s('culprit', "on Lenny's body, lower right", 'who keeps doing it', ['entity', 'text', 'viewer'], { optional: true, must: "Optional. Who keeps doing it, per the facts: a company (logo), a group ('AI labs'), or the viewer when the habit is the viewer's own." }),
    ],
    situations: ['AS-03', 'AS-05', 'AS-14'], landscape: true, family: '0 Days Without', burnedIn: '"0", "DAYS WITHOUT"',
    watch: "The recurrence must be real across the week's stories.",
  },
  {
    id: 'squidward-window', imgflipId: '67452763', name: 'Squidward Window', rank: 33, image: 'squidward-window.jpg', width: 598, height: 420,
    logic: "watching others enjoy what you can't",
    slots: [
      s('watcher', 'Squidward', 'who watches', ['viewer'], { must: 'Who watches from outside (the viewer).' }),
      s('enjoyers', 'the scene outside', 'who is enjoying it', ['text', 'entity'], { must: 'Who gets to enjoy what the watcher can\'t, per the facts (a region, a plan, a group).' }),
    ],
    situations: ['AS-04', 'AS-10', 'AS-11'], landscape: false, family: "Squidward's Window", burnedIn: null,
    watch: 'The "others" must really have access (a region, a plan) per the story.',
  },
  // ── Cards 26–60 (approved 2026-10-14; ME-97). Encoded from each image on 2026-10-14. ──
  {
    id: 'expanding-brain', imgflipId: '93895088', name: 'Expanding Brain', rank: 34, image: 'expanding-brain.jpg', width: 857, height: 1202,
    logic: 'ironically "smarter" takes, ending on the absurd real move',
    slots: [
      s('take-1', 'panel 1, left of the small brain', 'the plainest take', ['text'], { must: 'The plain, sensible way to handle the thing in the story, as a short take.' }),
      s('take-2', 'panel 2, left of the glowing brain', 'a "smarter" take', ['text'], { must: 'A take that sounds cleverer and is a little more absurd.' }),
      s('take-3', 'panel 3, left of the shining brain', 'a grander take', ['text'], { must: 'Grander still, and more absurd, heading toward the real move.' }),
      s('take-4', 'panel 4, left of the cosmic brain', 'the "enlightened" take: the story\'s real move', ['text'], { must: 'The move a player in the story really made, presented as the most enlightened take of all; it is the most absurd or self-defeating of the four. It must be what the facts show happened. Not a timeline.' }),
    ],
    situations: ['AS-05', 'AS-06', 'AS-08', 'AS-15'], landscape: true, family: 'Expanding Brain', burnedIn: null,
    watch: 'The irony is the escalation: each take sillier while it \'glows\' brighter. Four short lines on one subject; never a chronology.',
  },
  {
    id: 'trophy', imgflipId: '3218037', name: "This Is Where I'd Put My Trophy If I Had One", rank: 35, image: 'trophy.jpg', width: 300, height: 418,
    logic: 'pointing at a missing win',
    slots: [
      s('missing', 'top panel, beside the empty pedestal', '"This is where I\'d put my [X]"', ['text'], { must: 'A concrete noun phrase (1-4 words) the speaker is plainly expected to have and, per the facts, lacks: profit, a working assistant, a ship date. Written as the speaker\'s own possession, never a clause. Write only the thing; code prints \'This is where I\'d put my {x}\'.', pattern: "This is where I'd put my {x}" }),
      s('punch', 'bottom panel, above him', 'the confession', ['text'], { optional: true, fallback: 'If I had one!', must: "Empty prints 'If I had one!' (a single countable thing). Otherwise exactly 'If I had any!' (a plural or mass noun), or 'If' plus a short true reason from the facts that blocks it (at most 30 characters)." }),
      s('speaker', 'beside him in the bottom panel', 'whose missing win it is', ['entity'], { optional: true, must: 'The player pointing at its own missing win, when the meme speaks as that company. Leave it empty when the speaker is the viewer.' }),
    ],
    situations: ['AS-10', 'AS-11'], landscape: false, family: "This Is Where I'd Put My Trophy", burnedIn: null,
    watch: 'The "win" must be something the facts show they do not have.',
  },
  {
    id: 'absolute-cinema', imgflipId: '505705955', name: 'Absolute Cinema', rank: 36, image: 'absolute-cinema.png', width: 936, height: 725,
    logic: 'something is a masterpiece',
    slots: [
      s('absolute', 'beside his raised hand on the left', '"Absolute"', [], { fixed: 'ABSOLUTE' }),
      s('cinema-word', 'beside his raised hand on the right', 'the verdict', ['text'], { optional: true, fallback: 'CINEMA', must: "Empty prints 'CINEMA'. Or one plain everyday word (at most 12 characters, capitals) that replaces it with the honest verdict on the caption's moment (MARKETING, GARBAGE, MISCLICK). Never an insider term." }),
      s('cinema', 'caption across the bottom', 'the moment being crowned', ['text'], { must: "One specific moment from the facts that plays like a movie scene: a comeuppance, a twist, a fiasco or a perfectly timed rival move, as a 'When…' clause or a plain statement. Not a product summary and not sincere launch praise." }),
    ],
    situations: ['AS-05', 'AS-06', 'AS-15'], landscape: true, family: 'Absolute Cinema', burnedIn: null,
    watch: 'Scorsese is a real person; "ABSOLUTE" and "CINEMA" sit beside his hands, never on his face.',
  },
  {
    id: 'oprah-you-get-a', imgflipId: '28251713', name: 'Oprah You Get A', rank: 37, image: 'oprah-you-get-a.jpg', width: 620, height: 464,
    logic: 'everyone gets one',
    slots: [
      s('you-get', 'top left', '"You get [X]!"', [], { derived: { from: 'gift', as: 'repeat' }, pattern: 'You get {x}!' }),
      s('you-get-again', 'top right', '"You get [X]!" again', [], { derived: { from: 'gift', as: 'repeat' }, pattern: 'You get {x}!' }),
      s('giver', 'on her red suit', 'who gives it to everyone', ['entity'], { optional: true, must: 'The player handing the thing to everyone, per the facts.' }),
      s('gift', 'bottom', '"Everybody gets [X]!"', ['text'], { must: 'What everyone gets, with its article (\'a free agent\', \'ads\', \'a price rise\'), in 1 to 4 words: a real launch, giveaway or default the facts show reaching everyone. Write only that; code prints \'You get {x}!\' twice above and \'Everybody gets {x}!\' here.', pattern: 'Everybody gets {x}!' }),
    ],
    situations: ['AS-02', 'AS-04', 'AS-05', 'AS-08'], landscape: true, family: 'You Get a Car', burnedIn: null,
    watch: '"Everyone" must be true in the story (a launch, a giveaway, a default).',
  },
  {
    id: 'tuxedo-pooh', imgflipId: '178591752', name: 'Tuxedo Winnie The Pooh', rank: 38, image: 'tuxedo-pooh.png', width: 788, height: 582,
    logic: 'plain name vs fancy name for the same thing',
    slots: [
      s('casual', 'top-right panel, beside plain Pooh', 'the plain name', ['text'], { must: 'What the thing plainly is, in everyday words.' }),
      s('fancy', 'bottom-right panel, beside Pooh in a tuxedo', 'the dressed-up name', ['text'], { must: 'The dressed-up name the story uses for exactly the same thing: an official product name, a marketing term or a rebrand.' }),
    ],
    situations: ['AS-06', 'AS-08', 'AS-16'], landscape: true, family: 'Tuxedo Winnie the Pooh', burnedIn: null,
    watch: 'The two names must be the same thing (AS-16).',
  },
  {
    id: 'megamind-peeking', imgflipId: '370867422', name: 'Megamind peeking', rank: 39, image: 'megamind-peeking.png', width: 540, height: 540,
    logic: '"no [X]?"',
    slots: [
      s('asker', 'top band, first line over his forehead', 'who leans in to ask', ['entity', 'text'], { optional: true, must: "The party asking 'No X?': the company or player that has X or profits from the lack, as a logo, or a short text label with when or how often ('Every app update'). Optional only when X alone makes the target obvious." }),
      s('missing', 'top band, second line, just above his brow', '"No [X]?"', ['text'], { must: "One well-known noun the target visibly lacks per the facts, or the asker's own product it is pushing. Never a number, a cap, a qualified policy phrase, a person, a partner or anything about dating. Write only the thing; code prints 'No {x}?'.", pattern: 'No {x}?' }),
    ],
    situations: ['AS-04', 'AS-10', 'AS-11'], landscape: false, family: 'Megamind Peeking', burnedIn: null,
    watch: 'Never the crude "no b*tches?" use; X is a product or feature.',
  },
  {
    id: 'pawn-stars', imgflipId: '77045868', name: 'Pawn Stars Best I Can Do', rank: 40, image: 'pawn-stars.jpg', width: 624, height: 352,
    logic: 'a lowball offer',
    slots: [
      s('ask', 'top band across the image, above both heads', 'the big ask, need or effort', ['text', 'viewer'], { must: "What someone asked for, needed or put in, per the facts, as a short line with a speaker label ('Users: let us turn it off', 'Me: 3 years of photos'). It must be big or reasonable enough that the offer looks tiny next to it." }),
      s('lowballer', "Rick's shirt (left)", 'who answers with crumbs', ['entity'], { must: 'The player with the power to give who made the offer.' }),
      s('offer', 'bottom band', '"Best I can do is [X]"', ['text'], { must: "What that player actually gave, per the facts: a tiny token of what was asked (a small number, a credit, a one-time fix) or a cheaper substitute that isn't what was asked. Concrete and short. Write only X; code prints 'Best I can do is {x}'.", pattern: 'Best I can do is {x}' }),
    ],
    situations: ['AS-04', 'AS-12'], landscape: false, family: 'Pawn Stars', burnedIn: null,
    watch: 'The offer must be a real price or term in the story.',
  },
  {
    id: 'this-is-fine', imgflipId: '55311130', name: 'This Is Fine', rank: 41, image: 'this-is-fine.jpg', width: 580, height: 282,
    logic: 'calm denial amid chaos',
    slots: [
      s('fire', 'left panel, the smoke at the top', 'the fire', ['text'], { must: 'What is going wrong all around: a real product, business or policy problem in the story. Never harm to people.' }),
      s('sitter', 'left panel, below the dog', 'who sits in it', ['viewer', 'entity'], { must: 'Who sits calmly in it, carrying on as usual: the viewer, or the player the facts show carrying on.' }),
    ],
    situations: ['AS-04', 'AS-08', 'AS-14', 'AS-18'], landscape: true, family: 'This Is Fine', burnedIn: '"THIS IS FINE." in the speech bubble',
    watch: 'The room is on fire; never for real harm (ME-90).',
  },
  {
    id: 'thinking-about', imgflipId: '110163934', name: "I Bet He's Thinking About Other Women", rank: 43, image: 'thinking-about.jpg', width: 1654, height: 930,
    logic: 'one worries, the other thinks of something trivial',
    slots: [
      s('worry', 'over the blanket on her side (left)', 'the dramatic suspicion', ['text', 'viewer'], { must: "'I bet [it's / they're] …': the dramatic thing users or critics suspect the player is secretly doing. A suspicion, never an opinion or a fact." }),
      s('thinker', "on the man's grey T-shirt, upper back", 'who he is', ['entity'], { optional: true, must: 'Optional. The player or product the suspicion is about.' }),
      s('thought', 'over the blanket on his side (right)', 'what he is actually preoccupied with', ['text'], { must: "A harmless, trivially dumb or pedantic preoccupation the facts show the player really has (a basic failure, a silly limitation), ideally as a question. It must lower the stakes and never confirm or answer her suspicion." }),
    ],
    situations: ['AS-09', 'AS-13', 'AS-16', 'AS-19'], landscape: false, family: "I Bet He's Thinking About Other Women", burnedIn: null,
    watch: 'Bed scene, not sexual; keep it that way.',
  },
  {
    id: 'bell-curve', imgflipId: '533936279', name: 'Bell Curve', rank: 44, image: 'bell-curve.png', width: 675, height: 499,
    logic: 'the simple and the expert reach the same take',
    slots: [
      s('simple', 'above the figure on the left', 'the simple take', ['text'], { must: 'A plain take the facts show is right, so plain it sounds almost dumb, in a few words. The expert on the right repeats it word for word.' }),
      s('overthought', 'top, above the crying figure in the middle', 'the overthought take', ['text'], { must: 'A tangled, anxious take on the same thing, in plain words a follower can read (no jargon list).' }),
      s('expert', 'above the hooded figure on the right', 'the expert take: the same as the simple one', [], { derived: { from: 'simple', as: 'repeat' } }),
    ],
    situations: ['AS-05', 'AS-07', 'AS-13', 'AS-19'], landscape: true, family: 'IQ Bell Curve', burnedIn: 'the curve, its percentages and the IQ score axis',
    watch: 'Never label a group of people as the low end.',
  },
  {
    id: 'they-dont-know', imgflipId: '284929871', name: "They don't know", rank: 45, image: 'they-dont-know.png', width: 671, height: 673,
    logic: 'someone alone at a party with a secret',
    slots: [
      s('secret', 'top right, his thought', '"They don\'t know [X]"', ['text'], { must: "Write only X; code prints 'They don't know {x}'. X is the knower's own secret in the first person ('I…', 'my…'), or what is about to hit the crowd, from the facts. Never the story's headline restated: the crowd must plainly not have it.", pattern: "They don't know {x}" }),
      s('knower', 'beside the figure in the party hat', 'who holds the secret', ['viewer', 'entity'], { optional: true, must: 'The viewer or the player whose secret it is. Fill it when the secret is in the first person.' }),
      s('crowd', "on the dancing man's shirt (right)", "who doesn't know", ['text', 'entity'], { optional: true, must: "Optional. The people having fun without the secret: the users, the rivals, everyone else, as a short plural noun phrase or a logo." }),
    ],
    situations: ['AS-01', 'AS-07', 'AS-09', 'AS-20'], landscape: false, family: "They Don't Know", burnedIn: null,
    watch: 'The secret must be a real fact the rest of the room would not have.',
  },
  {
    id: 'two-guys-bus', imgflipId: '354700819', name: 'Two guys on a bus', rank: 46, image: 'two-guys-bus.jpg', width: 762, height: 675,
    logic: 'one looks out at the better thing',
    slots: [
      s('topic', 'ceiling, centre', 'the shared ride', ['text', 'entity'], { optional: true, must: 'Optional. The one event or product both men are riding with (a launch, a price change, a model), as a short noun phrase or logo.' }),
      s('stuck', 'left, on the rock wall above the sad man', 'the grim side', ['text', 'entity', 'viewer'], { must: 'The same ride\'s grim version: the group left out, or the same thing with one condition flipped (forced, free plan, wrong country, last time), per the facts.' }),
      s('view', 'right, over the mountains above the smiling man', 'the lucky side', ['text', 'entity', 'viewer'], { must: "Who or which version gets the good seat on this ride: a group, a plan, a condition the facts show. Write it parallel to 'stuck' so one word or clause differs." }),
    ],
    situations: ['AS-04', 'AS-10', 'AS-11', 'AS-17'], landscape: false, family: 'Two Guys on a Bus', burnedIn: "the artist's signature, bottom right",
    watch: 'The "better thing" must be real access, not taste.',
  },
  {
    id: 'imagination-spongebob', imgflipId: '163573', name: 'Imagination Spongebob', rank: 47, image: 'imagination-spongebob.jpg', width: 500, height: 366,
    logic: 'genuine delight at something small',
    slots: [
      s('dull', 'top, over the rainbow', 'the dull thing', ['text'], { must: 'The small, ordinary thing as it is, per the facts.' }),
      s('imagined', 'bottom, between his hands', 'the glowing reframe', ['text'], { must: 'The same thing as someone in the story genuinely delights in it, said with wonder. Never a company\'s pitch shown straight.' }),
      s('pitcher', 'beside his raised hand (left)', 'who is selling it', ['entity'], { optional: true, must: 'The player doing the selling, when the meme speaks as that company.' }),
    ],
    situations: ['AS-06', 'AS-08', 'AS-15', 'AS-16'], landscape: true, family: 'Imagination SpongeBob', burnedIn: null,
    watch: 'The image reads as delight, so a pitch here reads as an endorsement.',
  },
  {
    id: 'monkey-puppet', imgflipId: '148909805', name: 'Monkey Puppet', rank: 48, image: 'monkey-puppet.jpg', width: 923, height: 768,
    logic: 'side-eye at an awkward fact',
    slots: [
      s('fact', 'the white band, first line', 'the awkward fact', ['text'], { must: 'An awkward fact from the story that someone would rather not look at directly.' }),
      s('looker', 'the white band, second line, above the puppet', 'who side-eyes it', ['viewer', 'entity'], { must: 'Who would rather not look at the fact: the player it embarrasses, or the viewer when it embarrasses the viewer. Never "Me, checking" something.' }),
    ],
    situations: ['AS-02', 'AS-09', 'AS-14', 'AS-19'], landscape: false, family: 'Monkey Puppet', burnedIn: null,
    watch: 'The side-eye is at a fact, not a person to mock.',
  },
  {
    id: 'clown-makeup', imgflipId: '195515965', name: 'Clown Applying Makeup', rank: 49, image: 'clown-makeup.jpg', width: 750, height: 798,
    logic: 'someone talking themselves into a worse take',
    slots: [
      s('clown', 'top left, above the first line', 'who puts on the makeup', ['entity'], { optional: true, must: 'The player talking itself into it, when the meme speaks as that company.' }),
      s('step-1', 'left of panel 1 (plain white face)', 'the first, reasonable step', ['text'], { must: 'The first, reasonable-sounding step of a line of thinking someone in the story (or the viewer) follows.' }),
      s('step-2', 'left of panel 2 (clown face paint)', 'a less reasonable step', ['text'], { must: 'The next step, a little less reasonable.' }),
      s('step-3', 'left of panel 3 (the wig)', 'a silly step', ['text'], { must: 'The next step, plainly heading somewhere silly.' }),
      s('step-4', 'left of panel 4 (full clown)', 'the full-clown conclusion', ['text'], { must: 'Where they land: the story\'s real claim or spin. A company\'s claim is shown as its claim, never stated as true.' }),
    ],
    situations: ['AS-05', 'AS-06', 'AS-08', 'AS-15'], landscape: true, family: 'Clown Makeup', burnedIn: null,
    watch: 'The last panel is the story\'s real claim or spin, marked [CLAIM] if it is.',
  },
  {
    id: 'roll-safe', imgflipId: '89370399', name: 'Roll Safe Think About It', rank: 50, image: 'roll-safe.jpg', width: 702, height: 395,
    logic: 'a smart-sounding dodge',
    slots: [
      s('premise', 'the wall right of his head, upper half', 'the problem, rule or fact the logic starts from', ['text'], { must: "The problem, rule, limit or fact from the story, stated flatly: 'Can't [bad outcome]', 'If [fact]', or the rule as stated." }),
      s('twist', 'the wall right of his head, lower half', 'the smug, technically-true but self-defeating conclusion', ['text', 'viewer'], { must: 'The "clever" move, starting with if, so or then: technically true and plainly beside the point (it removes the thing the problem is about, obeys the letter of the rule, or follows a fake inference) and a real move in the facts. Never a sensible fix.' }),
      s('dodger', 'on his jacket', 'whose logic it is', ['entity'], { optional: true, must: "Optional. Only when the line is plainly that company's own move in the facts; leave empty when the logic is the viewer's." }),
    ],
    situations: ['AS-02', 'AS-04', 'AS-08', 'AS-18'], landscape: false, family: 'Roll Safe', burnedIn: 'a neon "Opening" hours sign, bottom right',
    watch: 'The line must be a real excuse or workaround in the story.',
  },
  {
    id: 'friendship-ended', imgflipId: '137501417', name: 'Friendship ended', rank: 51, image: 'friendship-ended.jpg', width: 800, height: 600,
    logic: 'dumped one ally for another',
    slots: [
      s('ended', 'over the printed name after "Friendship ended with"', 'the old ally', ['entity', 'text'], { must: 'The company or product dropped; the facts must show the split.' }),
      s('new-friend', 'over the printed name after "Now"', 'the new ally', ['entity', 'text'], { must: 'The company or product chosen in its place, per the facts.' }),
      s('speaker', 'below the handshake', 'who ends one friendship for another', ['entity'], { optional: true, must: 'The player that dropped one ally for the other, when the meme speaks as that company; the facts must show the switch.' }),
    ],
    situations: ['AS-01', 'AS-05', 'AS-10', 'AS-13', 'AS-19'], landscape: true, family: 'Friendship Ended',
    burnedIn: '"Friendship ended with MUDASIR" and "Now SALMAN is my best friend"; a white plate covers each of the two names, the way the format is used',
    watch: 'Both sides are companies or products, not people to pile on.',
  },
  {
    id: 'hide-the-pain', imgflipId: '27813981', name: 'Hide the Pain Harold', rank: 52, image: 'hide-the-pain.jpg', width: 480, height: 601,
    logic: 'smiling through a bad number',
    slots: [
      s('setup', 'top panel, the wall left of his head', 'the effort, plan or hope that looks fine', ['text', 'viewer'], { must: 'The normal-looking situation, effort or hope from the story, stated cheerfully and plainly: what was spent, promised, launched or tried. No bad news here.' }),
      s('pain', 'bottom panel, the wall left of his strained grin', 'the reveal that hurts', ['text', 'viewer'], { must: 'What actually happened, from the facts: the deflating number, result, delay or backfire, as a short clause with a concrete detail. It must turn the setup, not repeat it. A metric or missed target, never harm to people.' }),
      s('smiler', 'bottom panel, on his shirt', 'whose pain it is', ['entity'], { optional: true, must: 'Optional. The company whose plan and pain these are, when the meme speaks as that company; leave empty when Harold is the viewer.' }),
    ],
    situations: ['AS-12', 'AS-14'], landscape: false, family: 'Hide the Pain Harold', burnedIn: null,
    watch: 'The pain is a metric or a missed target, never harm. Harold is a real person; the label sits on his shirt, never his face.',
  },
  {
    id: 'spiderman-triple', imgflipId: '206151308', name: 'Spider Man Triple', rank: 53, image: 'spiderman-triple.jpg', width: 600, height: 551,
    logic: 'three of the same thing pointing at each other',
    slots: [
      s('left', 'Spider-Man on the left, below his chest', 'one lookalike', ['entity', 'text'], { must: 'One of three players or products making the same kind of move.' }),
      s('middle', 'Spider-Man in the middle, above him', 'the second lookalike', ['entity', 'text'], { must: 'The second, making the same kind of move.' }),
      s('right', 'Spider-Man on the right, on his back', 'the third lookalike', ['entity', 'text'], { must: 'The third. The facts must show all three made the same kind of move (same feature, same price, same claim); put the least obvious copy here. Never a caption or a verdict.' }),
      s('caption', 'the floor between their feet, bottom centre', "what all three share, or the 'who did it?'", ['text', 'viewer'], { optional: true, must: "The identical move all three made, named plainly ('Deep research mode'), or the question they are all dodging. Fill it when the three are logos." }),
    ],
    situations: ['AS-05', 'AS-16'], landscape: true, family: 'Spider-Man Pointing', burnedIn: null,
    watch: 'The three must actually be the same kind of move.',
  },
  {
    id: 'where-monkey', imgflipId: '316466202', name: 'where monkey', rank: 54, image: 'where-monkey.png', width: 1113, height: 629,
    logic: 'looking for the one that is missing',
    slots: [
      s('asker', "top caption across the windows, above the monkeys' heads", 'who is asking, and when', ['text', 'viewer'], { must: "Who is looking and the moment that makes the demand absurd, as 'Me/[group] when…' or '[Who], [exact time] after [trigger]': right after a promise, a keynote or a launch, or long after a promised date. True to the facts." }),
      s('missing', 'bottom, across the desk', '"Where [X]?"', ['text'], { must: "The thing being looked for, as a bare noun with no article (1-2 words): the promised feature, the product, the reward. The facts must show it is absent, delayed or promised. Write only the thing; code prints 'Where {x}?'.", pattern: 'Where {x}?' }),
    ],
    situations: ['AS-06', 'AS-11', 'AS-15'], landscape: false, family: 'Where Monkey', burnedIn: null,
    watch: 'The absence must be in the facts.',
  },
  {
    id: 'boardroom', imgflipId: '1035805', name: 'Boardroom Meeting Suggestion', rank: 55, image: 'boardroom.jpg', width: 500, height: 649,
    logic: 'a dumb idea gets thrown out the window',
    slots: [
      s('boss', 'on the boss\'s jacket (top panel)', 'whose meeting it is', ['entity'], { optional: true, must: 'The player whose meeting it is, when the meme speaks as that company.' }),
      s('question', 'top speech bubble (the boss)', 'the question', ['text'], { must: 'The question the boss puts to the room: the problem the story is about, as a short question.' }),
      s('idea-1', 'middle row, left bubble', 'the first idea', ['text'], { must: 'An answer that goes over well: a real option in the story, in 2 or 3 short words (the bubble is small).' }),
      s('idea-2', 'middle row, middle bubble', 'the second idea', ['text'], { must: 'Another answer that goes over well, in 2 or 3 short words (the smallest bubble).' }),
      s('rejected', 'middle row, right bubble (he is thrown out the window)', 'the idea that gets thrown out', ['text'], { must: 'The answer that gets its speaker thrown out the window: a real option the facts show was rejected, not a straw man.' }),
    ],
    situations: ['AS-04', 'AS-08', 'AS-18'], landscape: false, family: 'Boardroom Suggestion', burnedIn: null,
    watch: 'The ejected idea is a real rejected option, not a straw man. The boss\'s bubble is the question; the three below are the answers.',
  },
  {
    id: 'types-of-headaches', imgflipId: '119215120', name: 'Types of Headaches', rank: 56, image: 'types-of-headaches.jpg', width: 483, height: 497,
    logic: 'one pain is worse',
    slots: [
      s('worst', 'above the all-red head (bottom right)', 'the worst headache', ['text'], { must: 'The worst kind, named the way the others are (\'Migraine\', \'Stress\'): a real cost or constraint in the story, in 1 to 5 words.' }),
    ],
    situations: ['AS-02', 'AS-04', 'AS-16', 'AS-18'], landscape: true, family: 'Types of Headaches', burnedIn: '"Types of Headaches", "Migraine", "Hypertension", "Stress"',
    watch: 'The "worst" is a real cost or constraint in the story.',
  },
  {
    id: 'evil-kermit', imgflipId: '84341851', name: 'Evil Kermit', rank: 57, image: 'evil-kermit.jpg', width: 700, height: 325,
    logic: 'the tempting inner take',
    slots: [
      s('good', 'top (Kermit)', 'the good intention', ['text'], { must: 'What the party knows it should do: the sensible intention the story states.' }),
      s('inner', 'bottom (hooded Kermit)', 'the inner temptation', ['text'], { must: 'The tempting opposite its inner voice pushes, which the facts show it actually did or announced. Not a vice we invent.' }),
      s('kermit', 'on Kermit\'s back (left)', 'who is tempted', ['entity'], { optional: true, must: 'The player torn between the two, when the meme speaks as that company.' }),
    ],
    situations: ['AS-02', 'AS-13', 'AS-19'], landscape: false, family: 'Evil Kermit', burnedIn: null,
    watch: 'Inner Kermit is a real temptation the facts show, not us inventing vice.',
  },
  {
    id: 'three-headed-dragon', imgflipId: '187102311', name: 'Three-headed Dragon', rank: 58, image: 'three-headed-dragon.jpg', width: 680, height: 544,
    logic: 'three parties, one mess',
    slots: [
      s('set', 'top, above the heads', 'the set the three belong to', ['text'], { must: "A short noun phrase naming the category all three heads belong to ('AI assistants', 'Companies with a model'). Not a situation or a headline." }),
      s('head-left', 'left neck (fierce)', 'a real member', ['entity', 'text'], { must: 'A serious, recognized member of the set.' }),
      s('head-middle', 'middle neck (fierce)', 'another real member', ['entity', 'text'], { must: 'A second serious member, the same kind of thing as head-left.' }),
      s('head-right', 'right neck (the goofy head)', 'the dud', ['text', 'viewer', 'entity'], { must: "The member that is plainly not at the other two's level, per the facts: an unlikely newcomer, a weak entry, or the viewer. A reader must see at once why it is the derp." }),
    ],
    situations: ['AS-02', 'AS-05'], landscape: true, family: 'Three-Headed Dragon', burnedIn: "the artist's signature, bottom left",
    watch: 'All three heads are in the story.',
  },
  {
    id: 'flex-tape', imgflipId: '166969924', name: 'Flex Tape', rank: 59, image: 'flex-tape.png', width: 510, height: 572,
    logic: 'a ridiculous patch on a leak',
    slots: [
      s('leak', 'the leaking tank (top right)', 'the leak', ['text'], { must: 'The real problem in the story, as a leak: a flaw, a gap, a bug, a hole in a policy.' }),
      s('patch', 'bottom panel, below the taped hand', 'the patch', ['text'], { must: 'The quick fix actually applied, per the facts: a real workaround, shown as slapped on.' }),
      s('patcher', 'on Phil\'s shirt (top left)', 'who applies the patch', ['entity'], { optional: true, must: 'The player applying the patch, per the facts.' }),
    ],
    situations: ['AS-03', 'AS-14', 'AS-18'], landscape: false, family: 'Flex Tape', burnedIn: 'the Flex Tape can and its label, top middle',
    watch: 'The patch is a real workaround, not a product we endorse.',
  },
  {
    id: 'all-my-homies-hate', imgflipId: '216523697', name: 'All My Homies Hate', rank: 60, image: 'all-my-homies-hate.jpg', width: 680, height: 615,
    logic: 'the group rejects something',
    slots: [
      s('hated', 'bottom, across their legs', '"All my homies hate [X]"', ['text'], { must: 'A process, policy or claim from the story the audience would gladly reject together. Write only the thing; code prints \'All my homies hate {x}\'. Never a person or a group of people.', pattern: 'All my homies hate {x}' }),
    ],
    situations: ['AS-02', 'AS-04', 'AS-16'], landscape: true, family: 'All My Homies Hate', burnedIn: null,
    watch: '"Hate" is the audience situation, aimed at a process or a claim, never a person hurt. The crude top line of the classic is not used, and nobody in the photo is ever labeled.',
  },
  {
    id: 'sleeping-shaq', imgflipId: '99683372', name: 'Sleeping Shaq', rank: 61, image: 'sleeping-shaq.jpg', width: 640, height: 631,
    logic: 'one party is checked out',
    slots: [
      s('sleeper', 'top-left panel, first line', 'who sleeps', ['entity'], { must: 'The player who is checked out.' }),
      s('missed', 'top-left panel, beside "i sleep"', 'what they sleep through', ['text'], { must: 'What that player ignores or misses, per the facts: a launch, a request, a trend.' }),
      s('wakes', 'bottom-left panel, beside "real shit?"', 'what wakes them', ['text'], { must: 'What finally gets that player\'s attention, per the facts.' }),
    ],
    situations: ['AS-10', 'AS-11'], landscape: false, family: 'Sleeping Shaq', burnedIn: '"i sleep" and "real shit?" in the photos',
    watch: '"Asleep" is inattention the facts show (a missed launch, a late reply). The image itself says "real shit?".',
  },
  {
    id: 'laughing-leo', imgflipId: '259237855', name: 'Laughing Leo', rank: 62, image: 'laughing-leo.png', width: 470, height: 470,
    logic: 'laughing at spin whose gap is on the image',
    slots: [
      s('claim', 'the wall beside his head (top right)', 'the claim', ['text'], { must: 'A piece of spin from the story, shown as the speaker\'s words, with the fact that undercuts it in the same line (\'"Maximize value". Disney bids $20M\'). Never at harm.' }),
      s('laugher', 'on his suit (bottom)', 'who laughs', ['entity'], { optional: true, must: 'The player laughing at the claim: a rival or critic the facts show reacting to it.' }),
    ],
    situations: ['AS-05', 'AS-06', 'AS-12'], landscape: false, family: 'Leonardo DiCaprio Laughing', burnedIn: null,
    watch: 'The laugh is at spin or a gap, never at harm.',
  },
  {
    id: 'bad-luck-brian', imgflipId: '61585', name: 'Bad Luck Brian', rank: 63, image: 'bad-luck-brian.jpg', width: 475, height: 562,
    logic: 'the cursed outcome',
    slots: [
      s('setup', 'top band, above his head', 'the step he takes', ['text'], { must: "A verb-first clause with no subject (2-7 words): the normal or hopeful step the unlucky party takes, per the facts ('Finally upgrades to Pro'). Brian is the viewer unless unlucky names a company." }),
      s('outcome', 'bottom, across his sweater', 'what undoes it', ['text'], { must: "The true result from the story that wastes, cancels or punishes exactly that step (1-7 words, concrete). Never a generic risk ('issues'), never harm to a person." }),
      s('unlucky', 'on his shoulder, above the caption', 'who has the bad luck', ['entity'], { optional: true, must: 'The player the bad luck happens to, when the meme speaks as that company.' }),
    ],
    situations: ['AS-01', 'AS-04', 'AS-11', 'AS-19'], landscape: false, family: 'Bad Luck Brian', burnedIn: null,
    watch: 'The curse is a real miss in the story, not invented misfortune. Brian is a real person; the joke is never about him.',
  },
  {
    id: 'something-of-a-scientist', imgflipId: '133946291', name: "You know, I'm something of a scientist myself", rank: 64, image: 'something-of-a-scientist.jpg', width: 1200, height: 600,
    logic: 'a non-expert claiming expertise',
    slots: [
      s('act', 'top band, across the top', 'the small deed', ['text'], { optional: true, must: "The small, token, adjacent or accidental thing the claimer did, per the facts, as the deed or '[claimer] after …' (4-10 words). Plainly smaller than the title in field. Leave empty only when the headline already does the setup." }),
      s('claimer', 'left, below the act line', 'who did it', ['entity', 'viewer'], { must: 'The company that did the act (logo), or the viewer.' }),
      s('field', 'bottom', '"You know, I\'m something of a [X] myself"', ['text'], { must: 'A bare role noun (1-2 words, no article) the act would never truly earn: the professional or expert the claimer is now posing as. Never the claimer\'s real job or a quote of its claim. Write only the role; code prints \'You know, I\'m something of a {x} myself\'.', pattern: "You know, I'm something of a {x} myself" }),
    ],
    situations: ['AS-05', 'AS-07', 'AS-20'], landscape: false, family: 'Something of a Scientist', burnedIn: null,
    watch: 'The claim is in the story, marked [CLAIM].',
  },
  {
    id: 'inhaling-seagull', imgflipId: '114585149', name: 'Inhaling Seagull', rank: 65, image: 'inhaling-seagull.jpg', width: 1269, height: 2825,
    logic: 'a mild prompt, an outsized scream',
    slots: [
      s('inhale', 'top of panel 1 (calm seagull)', 'the trigger or first beat', ['text', 'viewer'], { must: "The small trigger (a mild question, a tiny event the viewer meets) or the first and smallest step of a run, as a short present-tense clause from the facts. Never an explainer prompt ('So what is going on with X?')." }),
      s('build', 'top of panel 2 (head tilting back)', 'the second beat', ['text'], { optional: true, must: 'Optional. The next, bigger step of the run in parallel wording, or the reaction starting. Leave empty for the trigger-and-scream form.' }),
      s('wind-up', 'top of panel 3 (full inhale)', 'the inhale or the third beat', ['text'], { optional: true, fallback: '*INHALES*', must: "Empty prints '*INHALES*' (the trigger-and-scream form). Otherwise the third, bigger step of a run." }),
      s('yell', 'panel 4, the red scream', 'the scream', ['text', 'viewer'], { must: 'Two to six words, the loudest beat: an outsized reaction to a small trigger, the peak of the run, or a blunt deflating answer screamed, from the facts. It must be disproportionate to what set it off; never a calm fact, headline or policy position.' }),
      s('yeller', 'top-left of panel 4, beside the screaming seagull', 'who screams', ['entity', 'viewer'], { optional: true, must: 'Optional: who screams, when it is not obviously the viewer.' }),
    ],
    situations: ['AS-04', 'AS-07', 'AS-11', 'AS-12'], landscape: false, family: 'Inhaling Seagull', burnedIn: null,
    watch: 'The yell is a real announcement or complaint. A tall image: it sits narrow on the canvas, so both lines stay short.',
  },
  {
    id: 'scooby-mask', imgflipId: '145139900', name: 'Scooby doo mask reveal', rank: 66, image: 'scooby-mask.jpg', width: 720, height: 960,
    logic: 'the villain is someone known',
    slots: [
      s('disguise', 'the ghost (top left)', 'the disguise', ['text'], { must: 'What something was presented as: the new name, the "new" product, the front.' }),
      s('unmasked', 'the man unmasked (bottom left)', 'who it was', ['entity'], { must: 'Who it really was; the facts must show it is the same company, model or person.' }),
      s('revealer', "on Fred's shirt (bottom panel)", 'who pulls off the mask', ['viewer', 'entity'], { optional: true, must: 'Who pulls off the mask: the viewer, or the player the facts show exposing it.' }),
    ],
    situations: ['AS-05', 'AS-16'], landscape: true, family: 'Scooby-Doo Mask', burnedIn: null,
    watch: 'The reveal must be supported (same company, same model, same person).',
  },
  {
    id: 'no-yes', imgflipId: '129315248', name: 'No - Yes', rank: 67, image: 'no-yes.jpg', width: 429, height: 343,
    logic: 'a hard no, then a yes',
    slots: [
      s('no', 'top-right panel', 'the no', ['text'], { must: 'What a party in the story firmly said no to, or the viewer turns down.' }),
      s('yes', 'bottom-right panel', 'the yes', ['text'], { must: 'What that party then says yes to: often the same thing, later. Both must be real positions in the story.' }),
      s('chooser', 'on Drake\'s jacket (bottom panel)', 'who says no, then yes', ['entity'], { optional: true, must: 'The player saying no, then yes, when the meme speaks as that company.' }),
    ],
    situations: ['AS-02', 'AS-10', 'AS-13'], landscape: true, family: 'No Yes', burnedIn: null,
    watch: 'Both answers are real positions in the story.',
  },
  {
    id: 'panik-kalm-panik', imgflipId: '226297822', name: 'Panik Kalm Panik', rank: 68, image: 'panik-kalm-panik.png', width: 640, height: 881,
    logic: 'panic, relief, worse panic',
    slots: [
      s('panik', 'left of "Panik" (row 1)', 'the first worry', ['text'], { must: 'The first worrying development in the story.' }),
      s('kalm', 'left of "Kalm" (row 2)', 'the relief', ['text'], { must: 'What seems to resolve it, per the facts.' }),
      s('panik-again', 'left of the second "Panik" (row 3)', 'the worse twist', ['text'], { must: 'The twist that makes it worse, from the plot.' }),
    ],
    situations: ['AS-04', 'AS-11', 'AS-18', 'AS-19'], landscape: true, family: 'Panik Kalm Panik', burnedIn: '"Panik", "Kalm", "Panik" beside the heads',
    watch: 'All three beats are in the plot.',
  },
  {
    id: 'surprised-pikachu', imgflipId: '155067746', name: 'Surprised Pikachu', rank: 69, image: 'surprised-pikachu.jpg', width: 1893, height: 1892,
    logic: 'shock at a predictable result',
    slots: [
      s('obvious', 'the white band above Pikachu', 'what should have been obvious', ['text'], { must: 'The move and its predictable result, in one or two short beats (\'Ships it untested. It breaks.\'). The result must have been foreshadowed in the facts.' }),
      s('surprised', 'beside Pikachu (bottom left)', 'who is surprised', ['entity'], { optional: true, must: 'The player surprised by its own predictable result, when the meme speaks as that company.' }),
    ],
    situations: ['AS-03', 'AS-14', 'AS-18'], landscape: true, family: 'Surprised Pikachu', burnedIn: null,
    watch: 'The result must have been foreshadowed in the facts.',
  },
];

/**
 * The catalog the writer and the checks read: the approved cards with the
 * golden set's slot rewrites on top (planning/Memes/GOLDEN_SET.md G4). The
 * rewrites (lib/memes/golden-slots.generated.ts, written from the G3 dossiers
 * by scripts/memes_golden_cards.ts) change only a slot's where, role, MUST,
 * accepted kinds and optional flag, never its id or box; delete that file's
 * entries to fall back to the approved text. Drafts until Lucas approves.
 */
export const TEMPLATE_CATALOG: readonly TemplateCard[] = APPROVED_CARDS.map((t) => {
  const over = GOLDEN_SLOTS[t.id];
  if (!over) return t;
  return { ...t, slots: t.slots.map((x) => (over[x.id] && !x.fixed && !x.derived ? { ...x, ...over[x.id] } : x)) };
});

/** Templates that fail the imagery rules (ME-30, ME-31). Intake blocks them by id and by family. */
export const EXCLUDED_TEMPLATES: readonly ExcludedTemplate[] = [
  { imgflipId: '222403160', name: 'Bernie I Am Once Again Asking For Your Support', rank: 4, why: 'a sitting politician', rule: 'ME-31' },
  { imgflipId: '252600902', name: 'Always Has Been', rank: 6, why: 'a gun pointed at the other astronaut', rule: 'ME-30' },
  { imgflipId: '80707627', name: 'Sad Pablo Escobar', rank: 14, why: 'the figure is a cartel boss (crime)', rule: 'ME-30 / skip list' },
  { imgflipId: '129242436', name: 'Change My Mind', rank: 17, why: 'a partisan political commentator', rule: 'ME-31' },
  { imgflipId: '124055727', name: "Y'all Got Any More Of That", rank: 18, why: 'the joke is drug addiction', rule: 'ME-30 / skip list' },
  { imgflipId: '438680', name: 'Batman Slapping Robin', rank: 20, why: 'a slap (violence)', rule: 'ME-30' },
  { imgflipId: '224015000', name: 'Bernie Sanders Once Again Asking', rank: 21, why: 'a sitting politician (same family as rank 4)', rule: 'ME-31' },
  { imgflipId: '252758727', name: 'Mother Ignoring Kid Drowning In A Pool', rank: 32, why: 'a drowning child and a skeleton (death)', rule: 'ME-30 / skip list' },
  { imgflipId: '208915813', name: 'George Bush 9/11', rank: 42, why: 'a president at the 9/11 attacks (tragedy, politics)', rule: 'ME-30, ME-31' },
  { imgflipId: '171305372', name: 'Soldier protecting sleeping child', rank: 70, why: 'war, a child in danger', rule: 'ME-30' },
  { imgflipId: '247113703', name: 'A train hitting a school bus', rank: 71, why: 'a crash, children', rule: 'ME-30' },
  { imgflipId: '224514655', name: 'Anime Girl Hiding from Terminator', rank: 72, why: 'a weaponized figure', rule: 'ME-30' },
  { imgflipId: '221578498', name: 'Grant Gustin over grave', rank: 73, why: 'a grave / death', rule: 'ME-30' },
  { imgflipId: '104893621', name: 'Grim Reaper Knocking Door', rank: 74, why: 'death', rule: 'ME-30' },
  { imgflipId: '371619279', name: 'Megamind no bitches', rank: 75, why: 'the crude use of the format', rule: 'ME-30' },
  { imgflipId: '135678846', name: 'Who Killed Hannibal', rank: 76, why: 'a killing', rule: 'ME-30' },
];

const byId = new Map(TEMPLATE_CATALOG.map((t) => [t.id, t]));
export const templateCard = (id: string): TemplateCard | undefined => byId.get(id);

/** Slots the writer fills (not fixed, not derived). */
export const writableSlots = (t: TemplateCard): TemplateSlot[] => t.slots.filter((x) => !x.fixed && !x.derived);
