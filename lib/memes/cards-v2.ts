/**
 * Template cards v2 (ME-102, planning/Memes/UPGRADE_PLAN.md U2): what each
 * card carries, read against how the format is actually used. The slots and
 * their MUSTs stay in catalog.ts; this file adds the fields the matcher, the
 * writer and the judges need:
 *
 *   carries    the turn types the format expresses (lib/memes/turns.ts)
 *   beats      how many turn beats it holds, [min, max]
 *   carriedBy  'picture' when the image itself shows the relation, 'text'
 *              when the text must supply the tone. Taken from the blind
 *              coder's sort (.memes-local/eval/blind-check-2026-10-14.md),
 *              which predicted Lucas's ratings without seeing them.
 *   stance     the attitude the image projects
 *   usage      how the internet uses it, and the misuse to avoid
 *   punch      the slot read last, where the turn's payoff lands
 *   maxChars   the most characters one written slot may hold
 *   spoken     slots where a question or a line of speech is the format
 *   voice      a voice rule one slot may loosen (ME-104)
 *   benched    why the card is out of rotation (ME-103)
 *
 * Like the catalog, a change here needs Lucas's approval.
 */
import { TEMPLATE_CATALOG } from './catalog';
import type { TurnTypeId } from './turns';

export type CarriedBy = 'picture' | 'text';

export type CardV2 = {
  carries: readonly TurnTypeId[];
  beats: readonly [number, number];
  carriedBy: CarriedBy;
  stance: string;
  usage: string;
  punch: string;
  maxChars: number;
  spoken?: readonly string[];
  voice?: Readonly<Record<string, readonly 'exclamation'[]>>;
  benched?: string;
};

const BENCH = 'ME-103: 0 of 8 in the graded batch; out until its rewritten card proves out in the U6 round.';

export const CARD_V2: Readonly<Record<string, CardV2>> = {
  drake: {
    carries: ['wandering-eye', 'double-standard', 'viewers-day'], beats: [2, 3], carriedBy: 'picture', stance: 'picky approval', punch: 'preferred', maxChars: 40,
    usage: 'Drake turns away from the top thing and points approvingly at the bottom thing. The joke is the choice: a preference that is revealing, petty or two-faced (a firm that bans AI for candidates and uses it to screen them). Never two neutral facts, never us declaring a winner.',
  },
  'two-buttons': {
    carries: ['dilemma', 'viewers-day'], beats: [3, 3], carriedBy: 'picture', stance: 'sweating', punch: 'chooser', maxChars: 30,
    usage: 'A man sweats over two red buttons. Each button is a real option and both must be hard to give up; the chooser is the viewer or the player the facts show stuck with this exact choice.',
  },
  'distracted-boyfriend': {
    carries: ['wandering-eye', 'says-vs-does'], beats: [3, 3], carriedBy: 'picture', stance: 'tempted', punch: 'new-thing', maxChars: 24,
    usage: 'A man walking with his girlfriend turns to stare at another woman. The new thing tempts, the boyfriend is who is tempted, the girlfriend is what they already have. The facts must show attention shifting while the old commitment is still there.',
  },
  'uno-draw-25': {
    carries: ['says-vs-does', 'dilemma', 'double-standard'], beats: [2, 2], carriedBy: 'picture', stance: 'stubborn', punch: 'refuser', maxChars: 40,
    usage: 'A card says "do this OR draw 25"; the player holds a huge hand. The card names an easy, sensible action the facts show was available; the refuser would rather pay any price than take it.',
  },
  'left-exit-12': {
    carries: ['dilemma', 'says-vs-does', 'wandering-eye'], beats: [2, 3], carriedBy: 'picture', stance: 'reckless swerve', punch: 'swerver', maxChars: 30,
    usage: 'A car swerves across lanes to take the exit at the last second. One sign is the sensible way straight on, the other the tempting exit; the car is who swerves. The swerve must be a real move in the facts.',
  },
  'anakin-padme': {
    carries: ['viewers-day', 'fine-print', 'says-vs-does'], beats: [2, 2], carriedBy: 'picture', stance: 'naive hope', punch: 'hope', maxChars: 40,
    usage: 'Anakin announces something in his own voice; Padme smiles and says the good outcome back to him ("…, right?"); his silence says no. The announcement is real news; the hope is what an ordinary user would assume, and the story must leave it genuinely open.',
  },
  'epic-handshake': {
    carries: ['unlikely-agreement'], beats: [3, 3], carriedBy: 'picture', stance: 'agreeing', punch: 'clasp', maxChars: 40,
    usage: 'Two muscular arms clasp hands. Each arm is a party; the clasp is the one thing they agree on or both do. The pair must be unlikely: rivals, opposites, sides that usually fight.',
  },
  'grus-plan': {
    carries: ['backfire', 'backwards-result', 'fine-print'], beats: [3, 4], carriedBy: 'picture', stance: 'smug, then dismay', punch: 'flaw', maxChars: 34,
    usage: 'Gru presents a plan on a flip chart: two confident steps, then a third that undoes the plan, which he re-reads in dismay. The steps are actions by one actor, in order; the flaw is a definite consequence those actions caused. Never narrate someone talking, never end on a caveat or a "may".',
  },
  'running-away-balloon': {
    carries: ['viewers-day'], beats: [2, 3], carriedBy: 'picture', stance: 'thwarted', punch: 'holder', maxChars: 30,
    usage: 'A man reaches for a balloon floating away while someone holds him back. The wanter is the viewer, the balloon is what they want, the holder is the real limit, rule, cost or delay in the facts.',
  },
  'disaster-girl': {
    carries: ['obvious-consequence', 'backwards-result', 'backfire'], beats: [2, 3], carriedBy: 'picture', stance: 'smug culprit', punch: 'culprit', maxChars: 36,
    usage: 'A girl smirks at the camera while a house burns behind her. She caused it: the fire is what her own decision wrecked (a product, a plan, never harm to people), and she is the company or viewer who did it.',
  },
  'waiting-skeleton': {
    carries: ['viewers-day', 'again'], beats: [2, 2], carriedBy: 'picture', stance: 'waiting forever', punch: 'wait', maxChars: 44,
    usage: "A skeleton on a bench, waiting so long it died. One top line, 'Me waiting for X', where X is a real promise or rollout in the facts that keeps not arriving; an optional bottom line gives the latest slip.",
  },
  'x-everywhere': {
    carries: ['again', 'obvious-consequence'], beats: [1, 2], carriedBy: 'text', stance: 'awed', punch: 'thing', maxChars: 28,
    usage: 'Buzz Lightyear gestures at the horizon to a worried Woody: "X, X everywhere." X must be something the facts show suddenly turning up in many places at once.',
  },
  'trade-offer': {
    carries: ['scale-gap', 'fine-print'], beats: [2, 3], carriedBy: 'text', stance: 'smug dealmaker', punch: 'you-receive', maxChars: 34,
    usage: 'A man in a suit presents a trade offer: "I receive X, you receive Y." The offerer is the player; what it takes is big and what the other side gets is small, both from the story\'s terms.',
  },
  'woman-yelling-at-cat': {
    carries: ['outrage-vs-shrug', 'double-standard'], beats: [2, 3], carriedBy: 'picture', stance: 'outrage vs indifference', punch: 'reply', maxChars: 40,
    usage: 'A woman screams and points across the table; a white cat sits behind a plate, unbothered. Her side is a real accusation; the cat\'s side is what the accused actually said or did in response.',
  },
  'marked-safe-from': {
    carries: ['viewers-day', 'fine-print'], beats: [1, 2], carriedBy: 'text', stance: 'relieved', punch: 'dodged', maxChars: 36,
    usage: 'A Facebook-style safety check: "Marked safe from X." X is something unpleasant the viewer really dodged, per the facts. Never near a real disaster or harm.',
  },
  'ancient-aliens': {
    carries: ['vested-interest', 'again'], beats: [2, 3], carriedBy: 'text', stance: 'conspiracy certainty', punch: 'explanation', maxChars: 40, spoken: ['setup'],
    usage: 'The History Channel guy shrugs: the answer is always aliens. The setup asks why something happened; the explanation is the one pet cause someone keeps reaching for (AI, money, a vested interest), in one to three words, and the facts must point to it. Not a quiz with a literal trivia answer.',
  },
  'bike-fall': {
    carries: ['backfire'], beats: [3, 4], carriedBy: 'picture', stance: 'self-sabotage', punch: 'outcome', maxChars: 36,
    usage: "A cyclist sets out, jams a stick in his own front wheel, and crashes. Panel 1: the rider and what it set out to do; panel 2: its own move in the facts; panel 3: the result that lands on the rider itself.",
  },
  'mocking-spongebob': {
    carries: ['says-vs-does', 'double-standard'], beats: [1, 2], carriedBy: 'text', stance: 'mocking', punch: 'claim', maxChars: 40, benched: BENCH,
    usage: 'SpongeBob, hunched, repeats a line back in alternating caps. Only for a line said at someone (a scolding, a dismissal, an excuse) that the facts show is hollow. Never a marketing line restated.',
  },
  'is-this-a-pigeon': {
    carries: ['fancy-name', 'self-congratulation'], beats: [2, 3], carriedBy: 'text', stance: 'confidently wrong', punch: 'question', maxChars: 30,
    usage: 'A man points at a butterfly and asks "Is this a pigeon?" The mislabeler is the player, the butterfly is the real thing in the facts, and the question is the wrong, flattering label the player puts on it.',
  },
  'you-guys-getting-paid': {
    carries: ['scale-gap', 'double-standard'], beats: [2, 2], carriedBy: 'text', stance: 'indignant', punch: 'reveal', maxChars: 36,
    usage: 'A teen on a tour bus learns the others are paid while he works for free: "You guys are getting paid?" The setup is the speaker and their worse deal; the reveal is the better deal the other side gets. Both sides must be identifiable on the image. Never a company\'s offer to the viewer.',
  },
  'one-does-not-simply': {
    carries: ['backwards-result', 'fine-print', 'viewers-day'], beats: [1, 2], carriedBy: 'text', stance: 'grave warning', punch: 'hard-thing', maxChars: 40,
    usage: 'Boromir warns: "One does not simply…" The line names something the story treats as easy that the facts show is hard. Only when it truly sounds easy; the format reads dated unless the line is sharp.',
  },
  'buff-doge-cheems': {
    carries: ['the-fall', 'scale-gap'], beats: [2, 2], carriedBy: 'picture', stance: 'strong vs weak', punch: 'weak-caption', maxChars: 36,
    usage: 'A muscular doge beside a small crying one: the same thing then and now (or a rival in the same job). Each dog speaks in the first person, the buff one bragging and Cheems failing at the same act, all from the facts.',
  },
  'same-picture': {
    carries: ['says-vs-does', 'fancy-name', 'unlikely-agreement'], beats: [2, 3], carriedBy: 'text', stance: 'deadpan', punch: 'right-picture', maxChars: 34,
    usage: 'Pam is asked to find the differences between two pictures and says they are the same picture. The two things are presented as different (a new name, a new product, a new promise) while the facts show they are the same thing, not merely two of a kind.',
  },
  'zero-days-without': {
    carries: ['again'], beats: [1, 2], carriedBy: 'picture', stance: 'resigned', punch: 'event', maxChars: 40,
    usage: 'Lenny resets the "days without an accident" sign to zero. The event is something the facts show happening again, after earlier times.',
  },
  'squidward-window': {
    carries: ['viewers-day', 'scale-gap'], beats: [2, 2], carriedBy: 'picture', stance: 'envious', punch: 'enjoyers', maxChars: 34,
    usage: 'Squidward looks out his window at SpongeBob and Patrick having fun. The watcher is the viewer; the enjoyers are whoever the facts show really getting the thing first.',
  },
  'expanding-brain': {
    carries: ['backwards-result', 'backfire', 'self-congratulation'], beats: [4, 4], carriedBy: 'text', stance: 'mock enlightenment', punch: 'take-4', maxChars: 34,
    usage: 'Four panels, the brain glowing brighter each time. Each take is presented as smarter and is more absurd, and the last, most "enlightened" one is the absurd or self-defeating move the story\'s player really made. The irony is the escalation. Never a timeline or a list of steps.',
  },
  trophy: {
    carries: ['the-fall', 'fine-print', 'self-congratulation'], beats: [1, 2], carriedBy: 'picture', stance: 'wistful', punch: 'missing', maxChars: 30, voice: { punch: ['exclamation'] },
    usage: 'A man points at an empty spot: "This is where I\'d put my X… if I had one!" X is a basic thing the speaker in the facts conspicuously lacks, as its own possession.',
  },
  'absolute-cinema': {
    carries: ['self-congratulation', 'backfire', 'obvious-consequence'], beats: [1, 2], carriedBy: 'text', stance: 'mock reverence', punch: 'cinema', maxChars: 40,
    usage: 'Scorsese raises his hands in awe: "Absolute cinema." The caption is one scene-like moment from the facts (a comeuppance, a twist, a fiasco, a perfectly timed rival move); the right-hand word may swap CINEMA for the honest verdict (MARKETING, GARBAGE).',
  },
  'oprah-you-get-a': {
    carries: ['again', 'obvious-consequence'], beats: [1, 2], carriedBy: 'text', stance: 'gleeful generosity', punch: 'gift', maxChars: 26,
    usage: 'Oprah shouts "You get an X! Everybody gets an X!" X is something the facts show handed to everyone at once (a feature, a price rise, ads).',
  },
  'tuxedo-pooh': {
    carries: ['fancy-name'], beats: [2, 2], carriedBy: 'picture', stance: 'fancy', punch: 'fancy', maxChars: 36,
    usage: 'Plain Pooh, then Pooh in a tuxedo. Top: the plain thing as it really is; bottom: the polished name it goes by, from the facts.',
  },
  'megamind-peeking': {
    carries: ['fine-print', 'scale-gap'], beats: [1, 2], carriedBy: 'text', stance: 'smug question', punch: 'missing', maxChars: 26,
    usage: 'Megamind leans in: "No X?" X is the obvious product, feature or perk the facts show a party lacks.',
  },
  'pawn-stars': {
    carries: ['scale-gap', 'fine-print'], beats: [2, 2], carriedBy: 'text', stance: 'lowball', punch: 'offer', maxChars: 34, spoken: ['ask'],
    usage: 'Top: the big ask, as a labeled line. Rick Harrison answers: "Best I can do is X." X is a real offer in the facts that is a tiny token of the ask, or a cheap substitute for it.',
  },
  'this-is-fine': {
    carries: ['outrage-vs-shrug', 'obvious-consequence', 'fine-print'], beats: [2, 2], carriedBy: 'picture', stance: 'calm denial', punch: 'sitter', maxChars: 36,
    usage: 'A dog sips coffee in a burning room: "This is fine." The fire is a real product, business or policy problem; the sitter is the player (or the viewer) calmly carrying on. Never harm.',
  },
  'thinking-about': {
    carries: ['outrage-vs-shrug', 'viewers-day'], beats: [2, 2], carriedBy: 'picture', stance: 'oblivious', punch: 'thought', maxChars: 40,
    usage: 'In bed, she worries ("I bet he\'s thinking about…"); he is thinking about something trivial. Both sides share one situation in the story: one side\'s anxious assumption, the other side\'s actual, smaller or stranger concern, said concretely.',
  },
  'bell-curve': {
    carries: ['backwards-result'], beats: [2, 3], carriedBy: 'picture', stance: 'midwit', punch: 'simple', maxChars: 34,
    usage: 'An IQ bell curve: the simple guy and the hooded expert say the same plain thing; the crying midwit in the middle overcomplicates it. The simple take is what the facts show is right and sounds almost dumb; the middle take is readable, not a jargon list.',
  },
  'they-dont-know': {
    carries: ['viewers-day', 'self-congratulation'], beats: [1, 2], carriedBy: 'picture', stance: 'smug secret', punch: 'secret', maxChars: 34,
    usage: 'A guy stands alone at a party thinking "They don\'t know X." X is the knower\'s own secret in the first person, or what is about to hit the dancing crowd, from the facts; the crowd may be labeled.',
  },
  'two-guys-bus': {
    carries: ['viewers-day', 'scale-gap'], beats: [2, 2], carriedBy: 'picture', stance: 'gloom vs view', punch: 'view', maxChars: 30,
    usage: 'On a bus, one man stares at a rock wall, the other at a beautiful view: two versions of the same ride. The labels name the grim side and the lucky side in parallel words, one condition flipped; an optional ceiling label names the shared ride.',
  },
  'imagination-spongebob': {
    carries: ['fancy-name'], beats: [2, 2], carriedBy: 'text', stance: 'delight', punch: 'imagined', maxChars: 36, benched: BENCH,
    usage: 'SpongeBob spreads his hands under a rainbow: "Imagination." Genuine delight at something small or absurdly mundane in the facts. Never a company\'s pitch shown straight: it reads as an endorsement.',
  },
  'monkey-puppet': {
    carries: ['double-standard', 'outrage-vs-shrug', 'fine-print'], beats: [2, 2], carriedBy: 'picture', stance: 'awkward side-eye', punch: 'looker', maxChars: 40,
    usage: 'A puppet monkey glances sideways, then looks away. The fact is awkward for one party; the looker is that same party, the one who would rather not look at it (or the viewer, when the fact is awkward for the viewer).',
  },
  'clown-makeup': {
    carries: ['backfire', 'backwards-result', 'self-congratulation'], beats: [4, 5], carriedBy: 'picture', stance: 'self-deluding', punch: 'step-4', maxChars: 32,
    usage: 'A man applies clown makeup in four steps, each a sillier take than the last, ending fully a clown. The steps are the player\'s own moves or statements in order; the last is its real claim or spin, shown as its claim.',
  },
  'roll-safe': {
    carries: ['vested-interest', 'obvious-consequence'], beats: [1, 2], carriedBy: 'text', stance: 'too clever', punch: 'twist', maxChars: 40,
    usage: 'A man taps his temple. Top: the problem or rule ("Can\'t X"); below: the smug, technically-true move that dodges it by removing the point ("if you Y"), a real move in the facts.',
  },
  'friendship-ended': {
    carries: ['wandering-eye'], beats: [2, 3], carriedBy: 'picture', stance: 'triumphant switch', punch: 'new-friend', maxChars: 24,
    usage: '"Friendship ended with X. Now Y is my best friend." The speaker is the player; X is the ally the facts show it dropping; Y is the new one. Companies and products, not people.',
  },
  'hide-the-pain': {
    carries: ['the-fall', 'fine-print', 'outrage-vs-shrug'], beats: [2, 2], carriedBy: 'picture', stance: 'pained smile', punch: 'pain', maxChars: 40,
    usage: 'Harold smiles in the top panel over a plan or hope that looks fine; in the bottom panel his grin strains over what actually happened (a bad number or backfire in the facts, never harm).',
  },
  'spiderman-triple': {
    carries: ['double-standard', 'unlikely-agreement', 'again'], beats: [2, 3], carriedBy: 'picture', stance: 'accusing each other', punch: 'right', maxChars: 24,
    usage: 'Three Spider-Men point at each other. Each is a party the facts show making the same kind of move they accuse the others of.',
  },
  'where-monkey': {
    carries: ['fine-print'], beats: [1, 2], carriedBy: 'text', stance: 'searching', punch: 'missing', maxChars: 26,
    usage: 'A puzzled monkey asks "Where X?" X is the thing the facts show was promised or expected and is missing.',
  },
  boardroom: {
    carries: ['says-vs-does', 'vested-interest'], beats: [2, 4], carriedBy: 'picture', stance: 'the sensible one gets thrown out', punch: 'rejected', maxChars: 26,
    usage: 'A boss asks a question; two answers go over well; the third person gives the sensible answer and is thrown out the window. The rejected answer is a real option the facts show was turned down, and the joke is that it was the sensible one.',
  },
  'types-of-headaches': {
    carries: ['viewers-day', 'fine-print'], beats: [1, 2], carriedBy: 'picture', stance: 'the worst one', punch: 'worst', maxChars: 30,
    usage: 'A chart of headaches, the worst one engulfing the whole head. The worst is a real cost or constraint in the story, named like the others in one to five words.',
  },
  'evil-kermit': {
    carries: ['says-vs-does', 'double-standard', 'vested-interest'], beats: [2, 3], carriedBy: 'picture', stance: 'tempted by the dark side', punch: 'inner', maxChars: 40,
    usage: 'Kermit faces a hooded Kermit. The good side is what the party knows it should do; the hooded inner voice is the tempting opposite the facts show it actually did or announced.',
  },
  'three-headed-dragon': {
    carries: ['unlikely-agreement', 'scale-gap'], beats: [3, 4], carriedBy: 'picture', stance: 'two serious, one goofy', punch: 'head-right', maxChars: 30,
    usage: 'A three-headed dragon, two fierce heads and one goofy one. All three heads are players in one mess; the goofy head is the one the facts show acting out of step with the other two.',
  },
  'flex-tape': {
    carries: ['fine-print', 'outrage-vs-shrug', 'scale-gap'], beats: [2, 3], carriedBy: 'picture', stance: 'slapdash fix', punch: 'patch', maxChars: 34,
    usage: 'A man slaps tape over a gushing leak. The leak is a real flaw or gap in the story; the patch is the quick fix the facts show was actually applied, shown as slapped on.',
  },
  'all-my-homies-hate': {
    carries: ['viewers-day'], beats: [1, 2], carriedBy: 'text', stance: 'united rejection', punch: 'hated', maxChars: 30,
    usage: '"All my homies hate X." X is a process, policy or claim from the story the audience would gladly reject together. Never a person or a group of people.',
  },
  'sleeping-shaq': {
    carries: ['outrage-vs-shrug', 'vested-interest'], beats: [2, 3], carriedBy: 'picture', stance: 'checked out until it matters to him', punch: 'wakes', maxChars: 34,
    usage: 'Shaq sleeps through one thing and jolts awake at another ("real shit?"). The sleeper is the player; what it ignores and what finally wakes it both come from the facts.',
  },
  'laughing-leo': {
    carries: ['says-vs-does'], beats: [1, 2], carriedBy: 'text', stance: 'laughing at spin', punch: 'claim', maxChars: 40, benched: BENCH,
    usage: 'Leonardo DiCaprio laughs with a drink. Only for spin whose undercutting fact is on the image too; the laugh lands on the gap, never on harm.',
  },
  'bad-luck-brian': {
    carries: ['fine-print', 'viewers-day', 'backfire'], beats: [1, 2], carriedBy: 'text', stance: 'cursed', punch: 'outcome', maxChars: 40,
    usage: 'Bad Luck Brian\'s school photo: a normal step, then the cursed thing that followed, in one line. A real miss in the story, as the viewer\'s or a player\'s luck; never about Brian.',
  },
  'something-of-a-scientist': {
    carries: ['self-congratulation'], beats: [2, 2], carriedBy: 'text', stance: 'smug self-credit', punch: 'field', maxChars: 26,
    usage: 'Willem Dafoe, pleased with himself: "You know, I\'m something of a X myself." The claimer is the player; X is the role outside its field that its own claim in the story gives it.',
  },
  'inhaling-seagull': {
    carries: ['outrage-vs-shrug', 'viewers-day', 'again'], beats: [2, 3], carriedBy: 'text', stance: 'winding up to scream', punch: 'yell', maxChars: 34, spoken: ['inhale', 'yell'], voice: { yell: ['exclamation'] },
    usage: 'A seagull inhales deeper and deeper over four panels, then screams. Either a tiny trigger gets an outsized scream, or a run of beats climbs panel by panel to a final beat that is belted. The scream must be disproportionate to its cause or the peak of the build.',
  },
  'scooby-mask': {
    carries: ['fancy-name', 'says-vs-does'], beats: [2, 3], carriedBy: 'picture', stance: 'unmasked', punch: 'unmasked', maxChars: 30,
    usage: 'Fred pulls the mask off the villain. The disguise is what something was presented as (a new name, a "new" product); under it is who it really was, and the facts must show it is the same company, model or person.',
  },
  'no-yes': {
    carries: ['says-vs-does', 'double-standard'], beats: [2, 3], carriedBy: 'picture', stance: 'hard no, then yes', punch: 'yes', maxChars: 34,
    usage: 'A firm no, then an eager yes. Both are real positions a party in the story took, often about the same thing at different times.',
  },
  'panik-kalm-panik': {
    carries: ['backfire', 'backwards-result', 'fine-print'], beats: [3, 3], carriedBy: 'picture', stance: 'panic, relief, worse panic', punch: 'panik-again', maxChars: 34,
    usage: 'Panik, then Kalm, then Panik again. A worrying development, what seems to resolve it, and the twist that makes it worse, all from the plot.',
  },
  'surprised-pikachu': {
    carries: ['obvious-consequence', 'backfire'], beats: [2, 3], carriedBy: 'text', stance: 'shocked at the obvious', punch: 'obvious', maxChars: 48,
    usage: 'Pikachu, mouth open in shock. The line is the move and its predictable result in two short beats ("Ships it untested. It breaks."); the result must have been foreshadowed in the facts.',
  },
};

export const cardV2 = (id: string): CardV2 | undefined => CARD_V2[id];

/** Cards the matcher may offer: every catalog card that is not benched. */
export const activeCards = () => TEMPLATE_CATALOG.filter((t) => CARD_V2[t.id] && !CARD_V2[t.id]!.benched);
