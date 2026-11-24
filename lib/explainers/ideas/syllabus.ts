/**
 * The Explainer Reels syllabus: the ordered curriculum the reels walk through, from what AI is and the computer under
 * it (level 1) to frontier depth (the last level). Edited by hand. This is data only; nothing here calls a model.
 *
 * What a topic becomes: one 60-second, eight-beat reel. A hook, a one-sentence definition, a hand-off card, an everyday
 * analogy, the definition's payoff (with why it works), a real example, a tie-together that maps the analogy onto the
 * example, and the logo close. So a topic earns its place only if it passes the reel-fit test:
 *   (a) the definition teaches: a curious non-expert could not already guess it;
 *   (b) there is a mechanism, a "why it works", that an everyday analogy can light up;
 *   (c) there is a concrete real-world example.
 * A label that only says what its words say fails. Cut it, fold it into a richer topic's aka, or reframe the topic
 * around its non-obvious part. For a practical topic the non-obvious part is how: the definition states the rule, and
 * the analogy shows why the rule works.
 *
 * Framing (Lucas, 2026-11-24: "The topics should be engineered for the system"). The order and the subjects are the
 * curriculum; the angle and the takeaway are framed for the reel. A viewer meets each reel cold on a social feed, with
 * no earlier reel seen, so every reel stands alone: `requires` only sets the order, and no angle or takeaway leans on
 * an earlier term.
 *
 * Rules (tests/explainers-syllabus.test.ts checks the mechanical ones):
 * - Levels are numbered 1..n in order. Units sit inside a level, and topics inside a unit are in teaching order. Every
 *   unit has topics.
 * - term follows TERM_RULE (lib/explainers/ideas/generator.ts): the exact name of one concept as a viewer would search
 *   it, 1 to 4 words, lowercase unless an acronym or proper name.
 * - angle: the one question the reel answers, as a curious viewer would ask it out loud. HARD CONSTRAINTS:
 *   - It asks about one thing that happens: how something works, what happens when, or why one specific thing happens.
 *     Where one fits, it points at something the viewer has seen or felt (a chatbot making up a fact, a phone photo).
 *   - It is never a category or boundary question ("what makes X count as Y", "what counts as"), never a comparison
 *     ("X rather than Y", "instead of", "versus", "the difference between", "while"), never a debate ("why do experts
 *     disagree"), and never two questions joined into one ("…, and why …").
 *   - Everyday words only: the words a 12-year-old uses talking to a friend, plus everyday tech words any phone user
 *     knows (app, website, password, photo, email, chatbot). No technical word except the topic's own term, and no
 *     earlier syllabus term. No idioms, no formal or literary words.
 *   - One question mark, 16 words or fewer, and the wording varies from topic to topic.
 * - takeaway: the one sentence the viewer leaves with: the angle's answer, stated as the thing that happens (the
 *   mechanism, cause or rule), true enough that an expert would sign it. HARD CONSTRAINTS:
 *   - 15 words or fewer, the same everyday words as the angle; the topic's own term may appear, no other technical word.
 *   - It says what the thing does, never what it is not: no "instead of", "rather than", "unlike", ", not …".
 *   - One action or cause an everyday analogy can show; for an umbrella term (artificial intelligence, generative AI),
 *     the one concrete thing a viewer can watch it do.
 *   The idea generator must deliver the angle and the takeaway.
 * - Every term is unique across the file, case-insensitively, and so is every aka. Near-duplicates are one topic: pick
 *   one name and put the others in aka.
 * - requires lists the few direct prerequisites (0 to 3 typical, not transitive ones), spelled exactly as a term
 *   elsewhere in this file. A prerequisite always appears earlier in file order, which also keeps it at the same or an
 *   earlier level and rules out cycles.
 * - kind 'cs' marks a computer-science or software topic in its own right (how computers, code, the internet, data and
 *   security work, and the math models rest on), placed where it helps the AI topics around it. Keep 'cs' between 25%
 *   and 35% of topics. Everything else is 'ai'.
 * - Concept-level and timeless: no product announcements or company news.
 */

export type SyllabusTopic = {
  term: string;
  kind: 'ai' | 'cs';
  /** The question the reel answers, in the viewer's words. */
  angle: string;
  /** The one plain sentence the viewer leaves with: the angle's answer. */
  takeaway: string;
  requires: readonly string[];
  aka?: readonly string[];
};
export type SyllabusUnit = { id: string; name: string; topics: readonly SyllabusTopic[] };
export type SyllabusLevel = { level: number; name: string; goal: string; units: readonly SyllabusUnit[] };

function topic(kind: SyllabusTopic['kind'], term: string, angle: string, takeaway: string, requires: readonly string[], aka?: readonly string[]): SyllabusTopic {
  return aka ? { term, kind, angle, takeaway, requires, aka } : { term, kind, angle, takeaway, requires };
}

/** An AI topic: term, angle, takeaway, prerequisites, other names. */
function ai(term: string, angle: string, takeaway: string, requires: readonly string[] = [], aka?: readonly string[]): SyllabusTopic {
  return topic('ai', term, angle, takeaway, requires, aka);
}

/** A computer-science or software topic: term, angle, takeaway, prerequisites, other names. */
function cs(term: string, angle: string, takeaway: string, requires: readonly string[] = [], aka?: readonly string[]): SyllabusTopic {
  return topic('cs', term, angle, takeaway, requires, aka);
}

export const SYLLABUS: readonly SyllabusLevel[] = [
  {
    level: 1,
    name: 'What AI is, and the computer under it',
    goal: 'Know what makes software AI, meet the chatbot, and see what a computer does with ones and zeros underneath it.',
    units: [
      {
        id: 'what-ai-is',
        name: 'What AI is',
        topics: [
          cs('algorithm', 'How does a computer solve a problem by following exact steps?', 'An algorithm is a list of exact steps a computer follows to finish a job.'),
          ai('rule-based system', 'Why did early AI that followed hand-written rules keep breaking?', 'Early AI only followed rules people wrote down, so anything new broke it.', ['algorithm'], ['expert system']),
          ai('machine learning', 'How does a computer learn a skill from examples?', 'Machine learning shows a computer many examples until it finds the pattern itself.', [], ['ML']),
          ai('AI model', 'What do you actually download when you download an AI model?', 'An AI model is the saved settings training produced, frozen so anyone can run them.', ['machine learning'], ['model']),
          ai('model training', 'What happens while an AI model is being trained?', 'During training, the model guesses, checks the right answer, and adjusts itself a little.', ['AI model'], ['training']),
          ai('inference', 'What happens when you ask a trained AI model a question?', 'Inference is the model running your question through its numbers once to make an answer.', ['model training'], ['model serving', 'inference server']),
          ai('neural network', 'How can thousands of tiny simple parts work together to recognize a face?', 'A neural network is thousands of tiny units whose combined votes make one answer.', ['machine learning']),
          ai('deep learning', 'Why did adding more layers suddenly make AI good at photos and speech?', 'Each extra layer finds bigger patterns, from edges to shapes to whole faces.', ['neural network']),
          ai('generative AI', 'How can AI make a picture of something that never existed?', 'Generative AI builds something new bit by bit, each bit chosen to fit learned patterns.', ['deep learning'], ['GenAI']),
        ],
      },
      {
        id: 'meet-the-chatbot',
        name: 'Meet the chatbot',
        topics: [
          ai('large language model', 'How does a chatbot learn to write like a person?', 'A large language model learned from billions of pages which words usually come next.', ['generative AI'], ['LLM', 'chatbot']),
          ai('foundation model', 'How can one big AI model be reused for thousands of different jobs?', 'A foundation model learns broad skills once, then gets brief extra practice for each job.', ['large language model'], ['frontier model']),
          ai('multimodal model', 'How can one AI look at a photo and answer questions about it?', 'A multimodal model turns pictures, sounds and words into the same kind of numbers.', ['foundation model'], ['multimodal AI']),
          ai('hallucination', 'Why does a chatbot make up facts so confidently?', "A chatbot writes words that sound right, and nothing inside it checks if they're true.", ['large language model']),
          ai('knowledge cutoff', "Why doesn't a chatbot know about last week's news?", 'A chatbot only knows its training text, and that text stops on one date.', ['large language model'], ['training cutoff']),
          ai('AI agent', 'How can an AI book a table or send an email for you?', 'An AI agent plans the steps and uses tools like a browser to finish them.', ['large language model'], ['agent', 'agentic AI']),
        ],
      },
      {
        id: 'how-a-computer-works',
        name: 'How a computer works',
        topics: [
          cs('binary', 'How can a computer store a photo using only ones and zeros?', 'Everything becomes numbers, and any number can be written with just ones and zeros.', [], ['bits and bytes']),
          cs('logic gate', 'How do tiny on-off switches add numbers together?', 'Logic gates are switches wired together so their on-off pattern does arithmetic.', ['binary'], ['transistor']),
          cs('CPU', "What does a computer's processor do billions of times a second?", 'A CPU grabs one simple instruction, carries it out, then grabs the next, nonstop.', ['logic gate'], ['processor']),
          cs('RAM', 'Why does a computer lose unsaved work when the power goes out?', 'RAM holds your open work using electricity, so cutting the power wipes it.', ['CPU'], ['memory vs storage']),
          cs('operating system', 'How does a computer run dozens of apps at once without crashing?', 'The operating system gives each app quick turns and its own fenced-off memory.', ['CPU', 'RAM'], ['OS']),
          cs('GPU', 'Why did a chip built for video games end up powering AI?', 'A GPU does thousands of small math problems at once, exactly what AI needs.', ['CPU']),
          cs("Moore's law", 'Why did computers get twice as powerful every couple of years?', 'Chip makers kept shrinking the switches, fitting twice as many every two years.', ['CPU']),
        ],
      },
      {
        id: 'how-a-computer-stores-things',
        name: 'How a computer stores things',
        topics: [
          cs('Unicode', 'How does a computer turn letters and emoji into numbers?', 'Unicode gives every letter and emoji in every language its own number.', ['binary'], ['character encoding']),
          cs('pixel', 'How does a photo become numbers a computer can edit?', 'A photo is a grid of tiny dots, each stored as numbers for its color.', ['binary'], ['digital image']),
          cs('vector graphics', 'Why does a logo stay sharp no matter how big you make it?', 'Vector graphics store shapes as drawing instructions, so they get redrawn sharp at any size.', ['pixel'], ['SVG']),
          cs('digital audio', 'How does a song become a list of numbers?', 'Sound is measured thousands of times a second, and each measurement becomes a number.', ['binary'], ['sample rate']),
          cs('data compression', 'How can a file get smaller without losing anything?', 'Compression stores a repeating pattern once, with a note saying where it repeats.', ['binary'], ['lossless compression', 'lossy compression']),
          cs('error-correcting code', 'How can a scratched disc or torn QR code still be read?', 'Extra check data is stored alongside, so the reader can rebuild the damaged parts.', ['binary'], ['error correction']),
        ],
      },
    ],
  },
  {
    level: 2,
    name: 'Software and the internet',
    goal: 'See how code is written, organized and checked, and how the internet carries it between machines.',
    units: [
      {
        id: 'how-software-is-written',
        name: 'How software is written',
        topics: [
          cs('programming language', 'How do people tell a computer what to do in words they can read?', "A programming language gives people readable words that get turned into the computer's tiny steps.", ['algorithm', 'CPU']),
          cs('compiler', "What happens to an app's code before your phone can run it?", "A compiler translates people's code into the simple number instructions a chip can run.", ['programming language'], ['interpreter']),
          cs('debugging', "How do programmers find what's making an app crash?", 'Debugging checks a program step by step to find the exact spot it goes wrong.', ['programming language'], ['bug']),
          cs('software testing', 'How does a programmer know a piece of code gives the right answer?', 'Software testing feeds code a known input and checks it returns the expected answer.', ['debugging'], ['unit test', 'regression testing']),
          cs('diff', 'How does a computer show exactly which lines changed in a file?', 'A diff lines up two versions and marks every line that was added or removed.', ['programming language']),
          cs('version control', "How can many people edit the same app's code without wiping out each other's work?", "Version control keeps each person's changes separate, then carefully combines them into one copy.", ['diff'], ['Git']),
          cs('CI/CD', 'How can an app get updated many times a day without breaking?', 'CI/CD runs automatic checks on every change, then releases it to users if all pass.', ['software testing', 'version control'], ['continuous integration', 'continuous deployment']),
          cs('feature flag', 'How does an app give a new button to only some users first?', 'A feature flag is a hidden switch that turns new stuff on for chosen users.', ['CI/CD']),
          cs('open source', 'How does code that anyone can copy keep getting better?', 'Open source code is shared publicly, so anyone can fix it and send back improvements.', ['version control']),
          cs('package manager', 'How do programmers add code other people wrote to their own app in seconds?', 'A package manager downloads the shared code you name, plus everything that code needs too.', ['open source'], ['software dependency']),
          cs('technical debt', 'Why does a rushed app get harder to change every month?', 'Each shortcut left in code makes every later change slower until someone fixes it.', ['software testing'], ['refactoring']),
        ],
      },
      {
        id: 'data-structures-and-algorithms',
        name: 'Data structures and algorithms',
        topics: [
          cs('data structure', 'Why does the way an app arranges its information decide how fast it works?', 'A data structure arranges information so the jobs you do most take the fewest steps.', ['programming language']),
          cs('stack', "Why does an app's undo button take back your newest change first?", 'A stack piles each new change on top, and undo takes the top one off.', ['data structure'], ['call stack']),
          cs('tree data structure', 'How do folders inside folders let a computer find any file fast?', 'A tree splits things into branches, so each choice skips everything down the other branches.', ['data structure'], ['tree']),
          cs('graph data structure', 'How does an app suggest friends of your friends?', 'A graph data structure links each person to their friends, so following links finds friends-of-friends.', ['data structure'], ['graph']),
          cs('hash function', 'How can a website check your password without keeping the password itself?', 'A hash function scrambles your password into a code, and the site just compares codes.', ['binary'], ['checksum']),
          cs('hash table', 'How does a phone find one contact among thousands almost instantly?', 'A hash table turns each name into a shelf number, so it jumps straight there.', ['hash function', 'data structure'], ['hash map', 'dictionary']),
          cs('Big O notation', "Why can an app that's quick with ten items get painfully slow with a million?", 'Big O notation describes how fast the work grows as the pile of items grows.', ['algorithm', 'data structure'], ['time complexity']),
          cs('sorting algorithm', 'How does a computer put a million names in order?', 'A fast sort splits the list into small sorted pieces, then merges them in order.', ['Big O notation'], ['sorting']),
          cs('binary search', 'How can you find one name in a billion sorted names in about thirty guesses?', "Binary search checks the middle, then throws away the half that can't hold the answer.", ['sorting algorithm']),
          cs('recursion', 'How can a program solve a big problem by solving a smaller copy of it?', 'Recursion has a task call itself on a smaller piece until the piece is easy.', ['programming language']),
          cs('shortest path algorithm', 'How does a map app find the fastest route in under a second?', 'A shortest path algorithm grows outward from you, always extending the quickest route so far.', ['graph data structure', 'Big O notation'], ["Dijkstra's algorithm", 'pathfinding']),
          cs('state machine', 'How does a vending machine know what to do with your next button press?', "A state machine tracks which step it's on, and each step allows certain next moves.", ['graph data structure'], ['finite state machine']),
          cs('concurrency', 'Why do apps sometimes glitch when two things happen at the exact same moment?', 'With concurrency, two tasks touching the same data can mix their steps badly.', ['operating system'], ['race condition', 'deadlock']),
        ],
      },
      {
        id: 'how-the-internet-works',
        name: 'How the internet works',
        topics: [
          cs('packet switching', 'How does a video cross the world in thousands of little pieces?', 'Packet switching cuts data into numbered pieces that travel separately and rejoin at the end.', ['binary'], ['TCP/IP', 'data packet']),
          cs('IP address', 'How does a message find your phone among billions of devices online?', 'Every device online gets an IP address, and the network passes data toward that number.', ['packet switching']),
          cs('DNS', "How does typing a website's name find the right computer?", "DNS looks up a website's name and gives back the number of its computer.", ['IP address'], ['domain name system']),
          cs('latency', 'Why does a video call lag even on fast Wi-Fi?', 'Latency is the wait while each message travels, and far-away trips take longer.', ['packet switching'], ['bandwidth']),
          cs('client-server model', 'What happens when the app on your phone asks for your messages?', 'Your phone asks, and a server far away finds the answer and sends it back.', ['IP address'], ['client and server']),
          cs('HTTP', 'What does your browser actually say to a website when you open a page?', 'Using HTTP, the browser writes a short request naming the page, and the site replies.', ['client-server model', 'DNS'], ['HTTPS']),
          cs('HTML', 'How does a plain text file turn into the page you see?', 'HTML wraps text in tags that say heading or link, and the browser draws each.', ['HTTP'], ['web page']),
          cs('cookie', "How does a website remember you're logged in when you come back?", 'A cookie is a note a site leaves in your browser and reads each visit.', ['HTTP'], ['browser cookie']),
          cs('frontend vs backend', "Why can't you change a price inside a shopping app to pay less?", 'The frontend shows screens and sends taps; the backend keeps prices and checks each order.', ['client-server model'], ['frontend', 'backend']),
          cs('cloud computing', 'How can a tiny company run a huge app without owning any computers?', 'Cloud computing rents out computers from a huge shared pool, by the minute.', ['client-server model'], ['the cloud']),
          cs('API', 'How does a weather app get its forecast from another company?', 'An API is a fixed menu of requests one program can send another for answers.', ['HTTP'], ['application programming interface', 'REST API']),
          cs('webhook', 'How does one app learn the second something happens in another app?', 'A webhook makes one app call another automatically the moment an event happens.', ['API']),
        ],
      },
    ],
  },
  {
    level: 3,
    name: 'Data and classic machine learning',
    goal: 'Understand how data is stored and how machines learn patterns from examples, and tell whether they learned the right ones, before neural networks.',
    units: [
      {
        id: 'storing-data',
        name: 'Storing data',
        topics: [
          cs('structured data', 'Why is a spreadsheet easy for a computer to search?', 'Structured data puts every fact in a named column, so software knows where to look.', ['data structure'], ['tabular data', 'unstructured data']),
          cs('database', 'How does a shopping site keep millions of orders safe and easy to find?', 'A database keeps records in tables and safely handles many changes at the same time.', ['structured data'], ['relational database']),
          cs('SQL', 'How can one short line of text pull answers out of millions of records?', 'SQL describes which records you want, and the computer figures out how to find them.', ['database']),
          cs('database index', 'How does a site find your account among millions without checking every one?', 'A database index keeps a sorted list of names with where each record lives.', ['database', 'binary search']),
          cs('database transaction', 'How does a bank transfer never take money out without putting it in?', 'A database transaction treats several steps as one, so they all finish or all undo.', ['database'], ['ACID']),
          cs('data warehouse', 'How can a company add up ten years of sales in seconds?', 'A data warehouse stores each column together, so totaling one column skips everything else.', ['database'], ['data lake']),
          cs('data pipeline', 'How does messy data from many apps end up clean in one place?', 'A data pipeline grabs data, cleans it and moves it along, on a set schedule.', ['data warehouse'], ['ETL']),
        ],
      },
      {
        id: 'math-you-need',
        name: 'Math you need',
        topics: [
          cs('probability', 'How do you put a number on how likely something is?', 'Probability counts the ways something can happen out of all the ways things could go.'),
          cs("Bayes' theorem", 'How much should one new clue change what you believe?', "Bayes' theorem updates your guess by weighing how well the clue fits each possible answer.", ['probability']),
          cs('vector', 'How can just a few numbers describe exactly where something is?', 'A vector is a short list of numbers, each giving distance along one direction.'),
          cs('matrix', 'Why does AI spend most of its time multiplying big grids of numbers?', 'Each AI step multiplies by a matrix, a number grid mixing many inputs at once.', ['vector'], ['matrix multiplication']),
          cs('derivative', 'How do you know which way is downhill from exactly where you stand?', 'A derivative measures how steep something is at one spot, pointing which way goes down.', [], ['slope', 'gradient']),
        ],
      },
      {
        id: 'data-for-learning',
        name: 'Data for learning',
        topics: [
          ai('training data', 'Why is a chatbot great at some subjects and shaky at others?', 'An AI learns from its training data, so topics with many examples come out strongest.', ['model training', 'structured data'], ['dataset']),
          ai('feature', 'Which details about a house does an AI look at to guess its price?', 'Features are the measured details, like size or age, that an AI uses to decide.', ['training data'], ['feature engineering']),
          ai('label', 'Where do the right answers that an AI learns from come from?', 'A label is the right answer people tag onto each example, like cat or dog.', ['training data'], ['ground truth', 'data labeling']),
          ai('data quality', 'Why does an AI fed messy examples learn the mess?', 'An AI copies every pattern in its examples, so typos and mistakes become lessons too.', ['training data'], ['garbage in, garbage out', 'data readiness', 'AI-ready data']),
          ai('train/test split', "How do you check an AI really learned and didn't just memorize?", 'Hide some examples from the AI, then quiz it on those unseen ones afterward.', ['training data'], ['test set', 'holdout set']),
          ai('data leakage', 'How can an AI ace its quiz and then fail on real people?', 'Data leakage lets answers sneak into the practice examples, so the quiz score is fake.', ['train/test split']),
          ai('data bias', 'How does an AI end up unfair when nobody told it to be?', 'When examples leave some people out, the AI learns to get those people wrong.', ['training data'], ['sampling bias']),
        ],
      },
      {
        id: 'how-machines-learn',
        name: 'How machines learn',
        topics: [
          ai('supervised learning', 'How does an AI learn from examples that come with answers?', 'Supervised learning pairs every example with its correct answer for the AI to learn from.', ['label']),
          ai('unsupervised learning', 'How can an AI sort a pile of shopping data into groups nobody named?', 'Unsupervised learning finds groups and patterns in data that comes with no answers.', ['supervised learning'], ['clustering', 'k-means']),
          ai('self-supervised learning', 'How does an AI learn from billions of pages that nobody marked up?', 'Self-supervised learning hides part of the data and has the AI guess the missing piece.', ['unsupervised learning']),
          ai('reinforcement learning', 'How does a program learn to win a game nobody taught it to play?', 'Reinforcement learning has a program play over and over, keeping moves that led to wins.', ['machine learning'], ['RL']),
          ai('classification', 'How does an email app decide if a message is spam?', 'Classification puts each new item into one of a few set groups by its details.', ['supervised learning'], ['classifier']),
          ai('loss function', 'How does an AI measure how wrong its guess was?', 'A loss function scores each wrong guess with one number the AI tries to shrink.', ['supervised learning'], ['cost function']),
          ai('parameters', 'What are the billions of numbers inside an AI actually doing?', 'Parameters are adjustable numbers, and each one nudges how strongly a clue affects the answer.', ['AI model'], ['weights', 'model weights']),
          ai('gradient descent', 'How does an AI find better settings one small step at a time?', 'Gradient descent nudges every setting a little in the direction that shrinks the mistake most.', ['loss function', 'parameters', 'derivative']),
          ai('learning rate', 'Why does an AI that learns in huge jumps never settle down?', 'The learning rate sets the size of each adjustment, and too big a step overshoots.', ['gradient descent']),
          ai('overfitting', 'Why does an AI that memorized its examples get new ones wrong?', 'Overfitting is when an AI memorizes random details of its examples that never repeat.', ['train/test split'], ['generalization', 'memorization']),
          ai('bias-variance tradeoff', "Why does an AI make more mistakes when it's too simple or too complicated?", 'Too simple misses real patterns, too complicated chases noise, so the best fit sits between.', ['overfitting'], ['underfitting']),
          ai('regularization', 'How do you make an AI favor simple patterns as it learns?', 'Regularization adds a penalty for big, complicated settings, so the AI keeps things simple.', ['overfitting']),
          ai('hyperparameter', "Who picks an AI's settings before it starts learning?", 'People set hyperparameters before learning starts, often by trying several and keeping the best.', ['parameters', 'learning rate'], ['hyperparameter tuning']),
        ],
      },
      {
        id: 'classic-models',
        name: 'Classic models',
        topics: [
          ai('linear regression', 'How can a straight line through dots predict a house price?', 'Linear regression finds the line closest to all the dots and reads predictions off it.', ['gradient descent'], ['regression']),
          ai('logistic regression', 'How does an AI turn a score into a yes-or-no chance?', 'Logistic regression squeezes any score into a chance between zero and one hundred percent.', ['classification', 'linear regression', 'probability']),
          ai('decision tree', 'How does an AI learn a flowchart of yes-or-no questions?', 'A decision tree keeps picking the question that best splits the examples into clean groups.', ['classification', 'tree data structure']),
          ai('random forest', 'How can hundreds of so-so guessers voting together get the answer right?', 'A random forest builds many slightly different flowcharts whose mistakes cancel out in the vote.', ['decision tree'], ['ensemble learning']),
          ai('gradient boosting', "How can a team of weak guessers each fix the last one's mistakes?", "Gradient boosting adds simple flowcharts one at a time, each aimed at what's still wrong.", ['random forest'], ['boosted trees']),
          ai('k-nearest neighbors', 'How can an AI guess what something is by checking its closest look-alikes?', 'K-nearest neighbors finds the most similar known examples and goes with their majority answer.', ['classification', 'vector'], ['KNN']),
          ai('recommendation system', "How does a streaming app guess what you'll want to watch next?", 'A recommendation system finds people with tastes like yours and suggests what they enjoyed.', ['k-nearest neighbors'], ['collaborative filtering']),
          ai('time series forecasting', "How can past sales numbers predict next month's sales?", 'Time series forecasting finds repeating ups, downs and trends, then carries them forward.', ['linear regression'], ['forecasting']),
          ai('anomaly detection', 'How does a bank spot one fake charge among millions of normal ones?', 'Anomaly detection learns what normal looks like and flags anything that falls far outside it.', ['unsupervised learning'], ['outlier detection']),
        ],
      },
      {
        id: 'measuring-a-model',
        name: 'Measuring a model',
        topics: [
          ai('accuracy', 'How can an AI be right 99% of the time and still be useless?', 'Accuracy counts every right answer, so always guessing the common case can score high.', ['classification', 'train/test split'], ['class imbalance']),
          ai('confusion matrix', 'How can you see exactly which mistakes an AI makes?', 'A confusion matrix is a grid counting what the AI guessed for each real answer.', ['accuracy'], ['false positive', 'false negative']),
          ai('precision and recall', 'Why does catching more fraud also flag more innocent shoppers?', 'Recall rises as the cutoff loosens, but precision drops as more honest people get flagged.', ['confusion matrix'], ['F1 score']),
        ],
      },
    ],
  },
  {
    level: 4,
    name: 'Neural networks and deep learning',
    goal: 'See how a neural network learns, the numbers and chips it runs on, and the architectures that came before transformers.',
    units: [
      {
        id: 'numbers-and-parallel-chips',
        name: 'Numbers and parallel chips',
        topics: [
          cs('floating-point number', 'Why does a computer get 0.1 plus 0.2 slightly wrong?', 'Floating-point numbers store a fixed number of digits, so some decimals get rounded slightly.', ['binary'], ['floating point']),
          cs('tensor', 'How does AI hold a whole photo as one block of numbers?', "A tensor holds numbers in rows, columns and layers, like a photo's size and colors.", ['matrix']),
          cs('parallel computing', "Why doesn't adding more workers always make a job finish faster?", 'Parallel computing splits a job among workers; steps needing earlier answers still wait their turn.', ['GPU', 'concurrency']),
          cs('random number generator', 'How does a computer that follows exact steps make random numbers?', 'A random number generator scrambles a starting number, like the time, into unpredictable-looking numbers.', ['algorithm'], ['pseudorandom number', 'random seed']),
          cs('Monte Carlo method', 'How can thousands of random guesses answer a question too hard to calculate?', 'The Monte Carlo method runs many random tries and averages them to estimate the answer.', ['random number generator', 'probability']),
        ],
      },
      {
        id: 'inside-a-neural-network',
        name: 'Inside a neural network',
        topics: [
          ai('artificial neuron', 'What does one artificial neuron inside an AI actually calculate?', 'An artificial neuron weighs each input, adds them up, and sends the total onward.', ['neural network'], ['perceptron']),
          ai('activation function', 'What decides how strongly each tiny part of an AI passes its signal on?', "An activation function bends each part's output, letting stacked layers learn curved, complex patterns.", ['artificial neuron'], ['ReLU']),
          ai('feedforward network', 'Why does a photo-sorting AI judge each photo fresh, with no memory of the last?', 'A feedforward network runs each input straight through once, judging every photo on its own.', ['activation function'], ['multilayer perceptron', 'MLP', 'hidden layer', 'forward pass']),
          ai('backpropagation', 'How does an AI work out which of its millions of numbers caused a mistake?', 'Backpropagation traces the mistake backward through each layer, giving every number its share of blame.', ['feedforward network', 'gradient descent'], ['backprop']),
          ai('vanishing gradient', 'Why did very deep AIs stop learning in their first layers?', 'The correction signal shrinks at every layer it passes back, so early layers barely change.', ['backpropagation']),
          ai('batch size', 'Why does an AI learn from small handfuls of examples at a time?', 'Batch size sets how many examples get averaged before each adjustment, trading speed for steadiness.', ['gradient descent'], ['mini-batch', 'epoch']),
          ai('dropout', 'Why does randomly switching off parts of an AI make it smarter?', 'Dropout forces the AI to spread knowledge around, so no single part carries everything.', ['regularization', 'feedforward network']),
          ai('softmax', 'How does an AI turn its raw scores into chances that add up to 100%?', 'Softmax makes every score positive, then divides each by the total so they share 100%.', ['activation function', 'probability']),
          ai('cross-entropy loss', 'Why does an AI get punished hardest for being sure and wrong?', 'Cross-entropy loss grows huge when the AI gave the real answer almost no chance.', ['loss function', 'softmax']),
        ],
      },
      {
        id: 'architectures-before-transformers',
        name: 'Architectures before transformers',
        topics: [
          ai('convolutional neural network', 'How does an AI spot a face anywhere in a photo?', 'Convolutional neural networks slide one small pattern checker across every spot of a photo.', ['feedforward network', 'pixel'], ['CNN']),
          ai('recurrent neural network', 'How does an AI read a sentence one word at a time and remember it?', 'A recurrent neural network carries a running memory forward, updating it with each new word.', ['feedforward network'], ['RNN']),
          ai('LSTM', 'How did AI learn to remember the start of a long sentence?', 'An LSTM uses small gates that choose what memory to keep and what to forget.', ['recurrent neural network', 'vanishing gradient'], ['long short-term memory']),
          ai('residual connection', 'How can an AI stack hundreds of layers without the early ones going quiet?', "A residual connection adds each layer's input straight to its output, giving signals a shortcut.", ['vanishing gradient'], ['skip connection']),
          ai('autoencoder', 'What does an AI learn when it squeezes a photo down and rebuilds it?', 'An autoencoder must keep only the most important details to rebuild the photo well.', ['feedforward network', 'data compression'], ['variational autoencoder', 'VAE']),
          ai('latent space', 'How can an AI smoothly change one face into another face?', 'Latent space places each image on a hidden map where nearby spots look alike.', ['autoencoder']),
          ai('GAN', "How did AI learn to make faces of people who don't exist?", 'In a GAN, one AI makes fakes, another catches them, and both keep getting better.', ['feedforward network', 'generative AI'], ['generative adversarial network']),
        ],
      },
      {
        id: 'learning-by-reward',
        name: 'Learning by reward',
        topics: [
          ai('reward signal', 'How can one score for doing well teach an AI complicated behavior?', 'A reward signal is a score that strengthens every step that led to it.', ['reinforcement learning'], ['reward']),
          ai('policy', 'How does a game-playing AI decide its next move from what it sees?', "A policy is the AI's playbook: see a situation, pick an action.", ['reward signal']),
          ai('exploration vs exploitation', 'How does an AI decide when to try a new move?', 'An AI mostly repeats its best move and sometimes tries a random one to learn.', ['policy']),
          cs('game tree search', 'How does a chess program look ahead without checking every possible move?', 'Game tree search maps out future moves and skips branches that are clearly bad.', ['tree data structure', 'Monte Carlo method'], ['minimax', 'Monte Carlo tree search']),
          ai('deep reinforcement learning', 'How did an AI learn to play video games just by watching the screen?', "Deep reinforcement learning learns to score each possible move just from what's on screen.", ['policy', 'neural network'], ['deep RL']),
          ai('self-play', 'How can an AI become a world champion by playing only itself?', 'Self-play has the AI play endless games against copies of itself, learning from every loss.', ['deep reinforcement learning', 'game tree search']),
        ],
      },
      {
        id: 'reusing-what-a-model-learned',
        name: 'Reusing what a model learned',
        topics: [
          ai('data augmentation', 'How can flipping and cropping the same photos teach an AI more?', 'Data augmentation makes new versions of each example, so the AI learns what really matters.', ['training data', 'overfitting']),
          ai('transfer learning', 'Why can an AI that knows cats learn to spot dogs from just a few photos?', 'Transfer learning reuses skills the AI already has, like spotting fur, on the new job.', ['deep learning'], ['pretrained model']),
          ai('fine-tuning', 'How does a general AI get turned into an expert at one job?', 'Fine-tuning gives a finished AI a small extra round of lessons on your own examples.', ['transfer learning']),
        ],
      },
    ],
  },
  {
    level: 5,
    name: 'Inside large language models',
    goal: 'Understand how an LLM turns text into tokens, vectors and attention, and writes its answer one token at a time.',
    units: [
      {
        id: 'tokens-and-embeddings',
        name: 'Tokens and embeddings',
        topics: [
          ai('token', 'How does a chatbot turn your words into numbers it can work with?', 'Each token, a common chunk of text, gets its own number from a fixed list.', ['large language model'], ['token count', 'tokens per word']),
          ai('tokenizer', "Why does a chatbot struggle to count the letters in 'strawberry'?", 'A tokenizer cuts words into chunks first, so the AI rarely sees single letters.', ['token', 'Unicode'], ['tokenization', 'vocabulary', 'byte-pair encoding', 'BPE']),
          ai('embedding', 'How can taking away man and adding woman turn king into queen?', 'An embedding stores each word as numbers, and directions in them track meanings like royalty.', ['vector', 'token', 'latent space'], ['vector embedding', 'embedding space', 'vector space']),
          ai('semantic similarity', "How does an AI know 'sofa' and 'couch' mean the same thing?", 'Words that show up in the same kinds of sentences get scored as close.', ['embedding'], ['cosine similarity']),
          ai('positional encoding', 'How does an AI keep words in order when it reads them all at once?', 'Positional encoding adds a number pattern to each word that marks its place in line.', ['embedding'], ['position embedding', 'RoPE']),
        ],
      },
      {
        id: 'attention-and-the-transformer',
        name: 'Attention and the transformer',
        topics: [
          ai('attention mechanism', 'How does an AI figure out which earlier words matter most for the next one?', 'The attention mechanism scores every earlier word and leans hardest on the highest scores.', ['embedding', 'recurrent neural network'], ['attention']),
          ai('self-attention', "How does an AI work out who 'it' means in a sentence?", 'In self-attention, each word scans the whole sentence and blends in meaning from related words.', ['attention mechanism']),
          ai('query key value', 'How does each word find the other words that help explain it?', 'Each word asks a question, others show labels, and the best matches share their meaning.', ['self-attention'], ['QKV']),
          ai('multi-head attention', 'Why does an AI read each sentence many ways at the same time?', 'Multi-head attention runs many lookups at once, each watching for a different kind of link.', ['query key value'], ['attention head']),
          ai('causal masking', 'How is an AI stopped from peeking at the word it should guess?', 'Causal masking hides every later word, so each guess only uses the words before it.', ['self-attention'], ['causal attention']),
          ai('transformer', "What design lets today's chatbots learn from almost the whole internet?", 'A transformer reads all words at once, so training on huge text goes fast.', ['multi-head attention', 'feedforward network', 'positional encoding'], ['transformer architecture', 'transformer block', 'transformer layer']),
          ai('residual stream', "How do the many layers inside a chatbot share what they've worked out?", 'The residual stream is a running note each layer reads, adds to, and passes on.', ['transformer', 'residual connection']),
          ai('encoder vs decoder', 'How does a translation app read your sentence and then write it in Spanish?', 'An encoder turns your sentence into meaning, then a decoder writes it out in Spanish.', ['transformer', 'causal masking'], ['decoder-only model', 'encoder-only model']),
          ai('mixture of experts', 'How can a giant AI answer quickly without running its whole brain?', 'A mixture of experts wakes only a few specialist parts for each word.', ['transformer'], ['MoE']),
        ],
      },
      {
        id: 'how-the-answer-comes-out',
        name: 'How the answer comes out',
        topics: [
          cs('Markov chain', 'How can counting which word follows which write sentences that almost make sense?', 'A Markov chain picks each next word only from what usually followed the last one.', ['probability'], ['n-gram model']),
          ai('next-token prediction', 'How does a chatbot write a whole essay one tiny piece at a time?', 'Next-token prediction guesses one token, adds it to the text, and repeats until done.', ['token', 'Markov chain'], ['autoregressive generation', 'autoregressive model']),
          ai('logits', 'How does a chatbot score every possible next word at the same moment?', "Logits score each word by how well it matches the AI's final inner signal.", ['next-token prediction', 'softmax'], ['token probabilities', 'logprobs', 'log probabilities']),
          ai('decoding strategy', "Why doesn't a chatbot always pick the word it thinks is most likely?", 'Always taking the top word makes text repeat, so a decoding strategy adds some chance.', ['logits'], ['sampling', 'greedy decoding']),
          ai('temperature', "What changes when you turn a chatbot's temperature up or down?", 'Temperature sets how often the AI picks less likely words: higher means wilder answers.', ['decoding strategy', 'random number generator']),
          ai('top-p sampling', 'How does a chatbot get creative without spitting out nonsense?', 'Top-p sampling cuts the list to the likeliest words, then picks randomly from those.', ['temperature'], ['nucleus sampling', 'top-k sampling']),
          ai('nondeterminism', 'Why can a chatbot answer differently even with its randomness dial at zero?', 'Busy chips add numbers in changing orders, so tiny rounding gaps can flip a word.', ['temperature'], ['why answers vary']),
          ai('perplexity', 'How can you score how well an AI predicts real writing?', 'Perplexity measures how surprised the AI is by each real next word; lower means better.', ['next-token prediction', 'cross-entropy loss']),
        ],
      },
      {
        id: 'size-and-scale',
        name: 'Size and scale',
        topics: [
          ai('parameter count', 'What does a chatbot gain from having billions more tiny dials inside?', 'A bigger parameter count lets an AI store more patterns from what it read.', ['parameters', 'large language model'], ['model size']),
          ai('context window', 'Why does a chatbot forget the start of a very long chat?', 'A context window holds only so many words, and the oldest ones get pushed out.', ['token'], ['context length']),
          ai('quadratic attention cost', 'Why does giving an AI twice the text make it four times the work?', 'Every word pairs with every other, so double the words makes four times the pairs.', ['self-attention', 'context window']),
          ai('pre-training', 'Why does guessing the next word teach an AI facts about the world?', 'Pre-training rewards good next-word guesses, and guessing well requires knowing grammar and facts.', ['next-token prediction', 'self-supervised learning', 'training data'], ['pretraining', 'pre-training data', 'training corpus']),
          ai('base model', 'Why does a freshly built AI just keep writing more of your question?', 'A base model only learned to continue text, so it carries on whatever you type.', ['pre-training'], ['instruction-tuned model', 'chat model', 'instruct model']),
          ai('scaling laws', 'Why can AI makers predict how much smarter a bigger AI will get?', 'Scaling laws show steady gains each time data, size and computing power grow together.', ['parameter count', 'pre-training']),
          ai('emergent abilities', 'Why do some AI skills seem to switch on suddenly as AIs grow?', 'Emergent abilities appear when many small gains add up and a whole skill finally works.', ['scaling laws'], ['emergence']),
          ai('small language model', 'How can a tiny AI on your phone get really good at one job?', 'A small language model trains mostly on one job, so all its room goes there.', ['parameter count'], ['SLM']),
        ],
      },
    ],
  },
  {
    level: 6,
    name: 'Prompting, context and retrieval',
    goal: 'Get reliable work out of a model by shaping its prompt, its context and the knowledge it can look up, and see how search finds that knowledge.',
    units: [
      {
        id: 'prompting',
        name: 'Prompting',
        topics: [
          ai('prompt engineering', 'How do you word a request so the chatbot gives what you wanted?', 'Prompt engineering spells out the goal, details and format, leaving the AI less to guess.', ['large language model'], ['prompt', 'prompting']),
          ai('system prompt', 'How do hidden instructions shape every answer a chatbot gives?', 'A system prompt is a hidden note the app slips in before every chat.', ['prompt engineering'], ['system message', 'chat roles', 'message roles']),
          ai('in-context learning', 'How does a chatbot pick up a brand-new task just from your message?', 'In-context learning spots the pattern in what you typed and follows it right away.', ['prompt engineering', 'context window'], ['zero-shot prompting']),
          ai('few-shot prompting', 'Why does showing a chatbot a couple of examples get you better answers?', 'Few-shot prompting shows a few finished examples, and the AI copies their style and format.', ['in-context learning'], ['few-shot examples']),
          ai('role prompting', "What happens when you tell a chatbot 'you are a doctor'?", 'Role prompting nudges the AI toward the words and tone that expert would use.', ['system prompt'], ['persona prompt']),
          ai('prompt structure', 'Why does splitting a request into labeled parts make answers more reliable?', 'Good prompt structure labels each part, so the AI can tell rules from material.', ['prompt engineering'], ['delimiters', 'XML tags']),
          ai('instruction following', 'Why does a chatbot sometimes skip half of what you asked?', 'Instruction following was trained in, and it slips when one message piles on many requests.', ['base model', 'prompt engineering']),
          ai('prompt sensitivity', 'Why can changing one small word in a question flip the answer?', "Prompt sensitivity happens because every word shifts the AI's guesses, sending it down another path.", ['prompt engineering'], ['prompt brittleness']),
          ai('prompt chaining', 'Why does breaking one big request into small steps get better results?', 'Prompt chaining hands each answer to the next step, so each request has one job.', ['prompt engineering'], ['task decomposition']),
        ],
      },
      {
        id: 'thinking-before-answering',
        name: 'Thinking before answering',
        topics: [
          ai('chain of thought', 'Why does asking a chatbot to show its work make it more accurate?', 'Chain of thought writes out middle steps, and each written step helps the next guess.', ['prompt engineering'], ['CoT']),
          ai('self-critique', 'How can a chatbot catch its own mistakes by rereading its answer?', 'Self-critique has the AI reread its draft looking for errors, then write a fixed version.', ['prompt chaining'], ['self-reflection']),
          ai('self-consistency', 'Why does asking the same question several times and taking the top answer work?', 'Self-consistency trusts the answer most attempts agree on, since random slips rarely match.', ['chain of thought', 'nondeterminism']),
          ai('reasoning model', 'What is a chatbot doing while it says thinking before answering?', 'A reasoning model was trained to think in private notes, backing up from wrong turns.', ['chain of thought'], ['thinking model', 'reasoning tokens', 'thinking budget']),
          ai('test-time compute', 'Why does letting an AI think longer help it solve hard problems?', 'More test-time compute buys the AI extra tries and checks before it commits.', ['reasoning model'], ['inference-time compute']),
        ],
      },
      {
        id: 'context',
        name: 'Context',
        topics: [
          ai('context engineering', 'How do you choose what to show an AI so it does its best work?', 'Context engineering gives the AI just the facts and files this task needs.', ['context window', 'system prompt']),
          ai('stateless model', "How does a chatbot 'remember' your chat when it remembers nothing?", 'The app resends the whole conversation with each message, since the stateless model forgets everything.', ['system prompt', 'context window'], ['statelessness', 'conversation history', 'multi-turn conversation']),
          ai('lost in the middle', 'Why does a chatbot miss facts buried in the middle of a long document?', 'AI focuses on the start and end of long text, so middle facts get missed.', ['context window']),
          ai('context rot', 'Why does a chatbot get sloppier the longer a chat goes on?', 'Context rot sets in as old messages pile up and crowd out what matters now.', ['lost in the middle'], ['context degradation']),
          ai('context compaction', 'How does an AI keep working for hours when its memory fills up?', 'Context compaction swaps the long history for a short summary, freeing space to keep going.', ['context rot', 'stateless model']),
          cs('JSON', 'How do apps send each other neat, labeled information as plain text?', 'JSON writes data as labels paired with values, so any program can read it.', ['data structure']),
          cs('JSON schema', 'How does an app check that the data it got has exactly the right shape?', 'A JSON schema lists every required label and type, and incoming data must match it.', ['JSON']),
          ai('structured output', 'How do you get a chatbot to always answer in a form an app can read?', 'Structured output makes the AI fill in a fixed form with set labels and slots.', ['JSON schema', 'instruction following'], ['JSON mode']),
          ai('constrained decoding', 'How can an AI be made unable to write broken data at all?', 'Constrained decoding blocks every next word that would break the format before the AI picks.', ['structured output', 'decoding strategy'], ['grammar-constrained generation']),
        ],
      },
      {
        id: 'search-and-retrieval',
        name: 'Search and retrieval',
        topics: [
          cs('regular expression', 'How does one short pattern find every email address in a document?', "A regular expression describes a text shape, like 'letters, @, letters', then finds every match.", [], ['regex']),
          cs('edit distance', "How does a spell checker know 'teh' meant 'the'?", 'Edit distance counts the fewest letter changes between words, and the closest real word wins.', ['algorithm'], ['fuzzy matching', 'Levenshtein distance']),
          cs('inverted index', 'How does a search site find every page with your word so fast?', "An inverted index keeps a list of pages for every word, like a book's index.", ['hash table'], ['search index']),
          cs('keyword search', 'Why do rare words count for more when a search site ranks results?', 'Keyword search scores pages by your words, giving extra weight to words few pages use.', ['inverted index'], ['full-text search', 'BM25', 'TF-IDF']),
          cs('web crawler', 'How does a search site discover billions of web pages?', 'A web crawler visits a page, copies it, then follows every link to new pages.', ['HTML', 'graph data structure'], ['search engine crawler']),
          cs('PageRank', 'How did links between pages decide which result shows up first?', 'PageRank counts links to a page as votes, and votes from popular pages count more.', ['web crawler']),
          cs('web scraping', 'How does software pull prices off a website built for people to read?', 'Web scraping loads a page like a browser, then picks out the text it wants.', ['HTML']),
          ai('semantic search', 'How can a search find what you meant when you used other words?', "Semantic search scores pages by how close their meaning is to your question's meaning.", ['embedding', 'keyword search'], ['vector search', 'embedding model']),
          ai('vector database', 'How does an app search millions of documents by meaning so fast?', 'A vector database stores each document as a point and quickly finds the nearest points.', ['semantic search', 'database']),
          ai('approximate nearest neighbor', 'Why do meaning searches give up a little accuracy for a lot of speed?', 'Approximate nearest neighbor checks only the most promising areas, so it skips most items.', ['vector database', 'k-nearest neighbors'], ['ANN index']),
          cs('knowledge graph', 'How do facts linked like a web of dots answer tricky questions?', 'A knowledge graph links facts, so a question gets answered by hopping fact to fact.', ['graph data structure', 'database'], ['graph database']),
          ai('RAG', "How does a chatbot answer from your company's own files?", 'RAG fetches the right pages first and hands them to the AI with your question.', ['semantic search', 'context window'], ['retrieval-augmented generation', 'long context vs RAG', 'fine-tuning vs RAG']),
          ai('chunking', 'Why does the way you cut long documents into pieces matter for AI search?', 'Chunking cuts files into small pieces, and a bad cut can split an answer apart.', ['RAG']),
          ai('hybrid search', 'Why do the best search tools match both your exact words and your meaning?', 'Hybrid search runs a word match and a meaning match, then merges both result lists.', ['semantic search', 'keyword search']),
          ai('reranking', 'How does a pickier second check put the best search results first?', 'Reranking takes the top few results and rereads each one closely against your question.', ['RAG'], ['reranker']),
          ai('grounding', "How do you keep an AI's answer tied to real sources?", 'Grounding makes the AI answer only from given sources and point to the line used.', ['RAG'], ['source attribution', 'citations']),
        ],
      },
    ],
  },
  {
    level: 7,
    name: 'Agents and tools',
    goal: 'Understand how models take actions: calling tools, running in loops, using computers and working with other agents, and the security that keeps them safe.',
    units: [
      {
        id: 'software-an-agent-touches',
        name: 'Software an agent touches',
        topics: [
          cs('command line', 'What can programmers do by typing commands into a plain text window?', 'One typed line on the command line can do the work of many clicks.', ['operating system'], ['terminal', 'shell']),
          cs('cron job', 'How does a computer run a task every night while nobody is watching?', 'A cron job is a timetable the computer checks each minute, starting tasks on time.', ['operating system'], ['job scheduler']),
          cs('logging', 'How do engineers work out what an app did after something went wrong?', 'Logging makes an app note each step and the time, so people can retrace it.', ['debugging'], ['logs']),
        ],
      },
      {
        id: 'security-basics',
        name: 'Security basics',
        topics: [
          cs('encryption', 'How can a message cross the internet so only the right person can read it?', 'Encryption scrambles a message with a key, and only the matching key unscrambles it.', ['binary'], ['end-to-end encryption']),
          cs('public-key cryptography', 'How can two strangers set up a secret code while everyone listens?', 'Public-key cryptography hands out open padlocks anyone can close, but only you hold the key.', ['encryption'], ['public key']),
          cs('digital signature', "How can you prove a file came from you and wasn't changed?", "A digital signature locks a file's fingerprint with your secret key, so any change shows.", ['public-key cryptography', 'hash function']),
          cs('authentication', "How does a website make sure it's really you logging in?", 'Authentication asks for proof only you should have, like a password or your face.', ['hash function'], ['API key', 'password hashing']),
          cs('two-factor authentication', 'Why does a code on your phone stop someone who stole your password?', "Two-factor authentication also needs something you hold, so a stolen password alone can't get in.", ['authentication'], ['2FA', 'multi-factor authentication']),
          cs('OAuth', 'How can an app use your Google account without ever seeing your password?', 'You log in on the real site, and OAuth hands the app a limited pass.', ['authentication', 'API'], ['delegated access']),
          cs('VPN', 'What does a VPN actually hide when you use it?', "A VPN locks your traffic in a tunnel, so your Wi-Fi can't see your sites.", ['encryption', 'IP address'], ['virtual private network']),
          cs('permissions', 'Why should every app get only the access its job needs?', "Permissions limit what each app can touch, so one hacked app can't reach everything.", ['authentication'], ['access control', 'least privilege', 'excessive agency', 'tool permissions', 'approval prompts']),
          cs('virtual machine', 'How can one real computer act like many separate ones?', "A virtual machine is software that fakes a whole computer, sharing the real one's parts.", ['operating system'], ['VM']),
          cs('sandbox', 'How do you run an untrusted app without letting it touch anything important?', "A sandbox walls the program into a closed box where its mess can't spread.", ['permissions', 'virtual machine'], ['sandboxing']),
          cs('SQL injection', "How can typing odd characters into a login box hand over a whole site's data?", 'SQL injection sneaks commands into a text box, and the site runs them by mistake.', ['SQL'], ['code injection']),
          cs('phishing', 'How does a fake email get someone to give away their password?', "Phishing copies a trusted look so you type your password into the attacker's page.", ['authentication'], ['social engineering']),
        ],
      },
      {
        id: 'tool-use',
        name: 'Tool use',
        topics: [
          ai('tool calling', 'How does a chatbot that only writes text use a calculator or calendar?', 'In tool calling, the AI writes a tool request, and the app runs it.', ['AI agent', 'API', 'structured output'], ['function calling', 'tool definition', 'tool result']),
          ai('code interpreter', 'Why do chatbots write and run a little program to answer a math question?', "A code interpreter runs the AI's program for real, so the math comes out exact.", ['tool calling', 'sandbox'], ['code execution']),
          ai('web search tool', 'What actually happens when a chatbot searches the web for you?', 'A web search tool runs searches the AI writes and hands back pages to read.', ['tool calling', 'keyword search'], ['web browsing']),
          ai('MCP', 'How can one shared plug let any AI app use any tool?', 'MCP gives every tool the same plug shape, so any AI app can use it.', ['tool calling', 'API'], ['Model Context Protocol', 'MCP server']),
        ],
      },
      {
        id: 'agent-loops',
        name: 'Agent loops',
        topics: [
          ai('agent loop', "How does an AI keep working on a task until it's actually done?", 'An agent loop acts, checks the result, and picks the next move, over and over.', ['tool calling'], ['agentic loop', 'stopping condition', 'workflow vs agent', 'agentic workflow']),
          ai('ReAct', 'Why does an AI that writes notes between its actions make fewer mistakes?', 'ReAct has the AI think out loud, act, look at the result, then think again.', ['agent loop', 'chain of thought'], ['reason and act']),
          ai('planning', 'How does an AI break a big goal into steps?', 'Planning lists the steps first, then rewrites the list whenever a step fails.', ['agent loop', 'prompt chaining'], ['agent planning']),
          ai('agent memory', 'How can an AI remember you from one task to the next?', 'Agent memory saves useful notes to a file and reads them before each new task.', ['agent loop', 'stateless model', 'vector database'], ['scratchpad', 'long-term memory']),
          ai('routing', 'How does an app send each request to the right AI for it?', 'Routing sorts each request first, then passes it to the AI that handles it best.', ['agent loop'], ['model router']),
          ai('human-in-the-loop', 'How does an AI helper stop and wait for your OK before paying?', 'Human-in-the-loop pauses the AI before risky moves, like payments, until a person approves.', ['agent loop'], ['HITL', 'autonomy levels', 'levels of autonomy']),
          ai('long-horizon tasks', "Why does an AI that's good at quick tasks struggle with all-day ones?", 'On long-horizon tasks, small slips add up over hundreds of steps and wreck the work.', ['planning']),
          ai('agentic RAG', 'What changes when an AI decides for itself what to look up?', 'Agentic RAG lets the AI search, read, and search again until it has enough.', ['RAG', 'agent loop'], ['deep research agent', 'deep research']),
          ai('agent skills', 'How can an AI load expert know-how only when a task needs it?', 'Agent skills are instruction files the AI opens only when the task matches their label.', ['system prompt', 'tool calling']),
        ],
      },
      {
        id: 'agents-at-the-keyboard',
        name: 'Agents at the keyboard',
        topics: [
          ai('computer use', 'How does an AI click, type and scroll through apps built for people?', 'With computer use, the AI looks at screenshots, decides where to click, and repeats.', ['agent loop', 'multimodal model'], ['browser agent']),
          ai('coding agent', 'How does an AI write, run and fix code on its own?', 'A coding agent writes code, runs it, reads the errors, and fixes them until done.', ['agent loop', 'code interpreter', 'version control', 'command line'], ['vibe coding']),
          ai('agent harness', 'Why does the software wrapped around an AI matter so much?', 'An agent harness supplies the tools and runs every action the AI asks for.', ['agent loop'], ['scaffolding']),
          ai('multi-agent system', 'When does splitting a big job across several AIs actually help?', 'A multi-agent system gives each AI one piece, so separate parts get done at once.', ['agent harness'], ['multi-agent systems', 'subagent', 'orchestrator-worker pattern', 'orchestrator agent']),
        ],
      },
      {
        id: 'keeping-agents-safe',
        name: 'Keeping agents safe',
        topics: [
          ai('guardrails', 'How do you stop an AI from saying or doing harmful things?', 'Guardrails screen every message in and out of the AI, blocking ones that break rules.', ['tool calling'], ['AI governance', 'AI policy']),
          ai('prompt injection', 'How can a hidden line on a web page take over an AI?', 'Prompt injection hides commands in text the AI reads, and the AI may obey them.', ['tool calling', 'system prompt', 'SQL injection'], ['indirect prompt injection']),
          ai('agent observability', 'How do you find out why an AI did what it did?', 'Agent observability records every step, tool use and result, so people can replay what happened.', ['agent loop', 'logging'], ['tracing']),
        ],
      },
    ],
  },
  {
    level: 8,
    name: 'Seeing, hearing and creating',
    goal: 'Learn how AI reads images and sound, and how it generates pictures, voices and video.',
    units: [
      {
        id: 'vision',
        name: 'Vision',
        topics: [
          ai('image classification', 'Why does a photo app sometimes mistake a blueberry muffin for a puppy?', 'Image classification scores photos by the textures and shapes it learned, so look-alikes fool it.', ['convolutional neural network', 'supervised learning'], ['computer vision']),
          ai('object detection', 'How does a phone camera draw a box around every face?', 'Object detection guesses boxes all over the photo, then keeps only the surest ones.', ['image classification'], ['image segmentation']),
          ai('OCR', 'How does an app read the words on a crumpled receipt photo?', 'OCR finds where the letters sit, then matches each shape to a letter it knows.', ['image classification'], ['optical character recognition']),
          ai('vision transformer', 'How can an AI built to read sentences also read a photo?', 'A vision transformer cuts a photo into small squares and reads them like words.', ['transformer', 'pixel'], ['ViT', 'image tokens']),
          ai('image-text embedding', "How does a photo search app find 'dog at the beach' with no captions?", 'Image-text embedding learns from millions of photo-caption pairs, pulling matches close and mismatches apart.', ['vision transformer', 'embedding'], ['CLIP', 'contrastive learning']),
          ai('vision language model', 'Why can a chatbot describe your photo but misread its tiny print?', 'A vision language model shrinks big photos before reading them, so tiny print can blur.', ['vision transformer', 'large language model'], ['VLM']),
          ai('document understanding', 'How does an app find the total on a messy bill or form?', 'Document understanding reads both the words and where they sit on the page.', ['vision language model', 'OCR']),
        ],
      },
      {
        id: 'speech-and-audio',
        name: 'Speech and audio',
        topics: [
          cs('Fourier transform', "How does a tuner app hear which note you're playing?", 'A Fourier transform measures how much of each pitch is mixed into a sound.', ['digital audio'], ['spectrogram']),
          ai('speech recognition', 'How does your phone type out what you say?', 'Speech recognition hears each sound you make and picks the words that most likely fit.', ['Fourier transform', 'transformer'], ['speech-to-text', 'ASR']),
          ai('text-to-speech', 'How does a computer voice know where to pause and which word to stress?', "Text-to-speech learned from hours of real speech how people's voices rise, fall and pause.", ['digital audio', 'generative AI'], ['TTS']),
          ai('voice cloning', 'How can a few seconds of your voice be enough to copy it?', 'Voice cloning already knows how people talk, so a short clip just teaches your sound.', ['text-to-speech']),
          ai('audio tokens', 'How does a talking AI turn sound into pieces it can read and write?', 'Audio tokens turn each short slice of sound into one code from a fixed list.', ['digital audio', 'token'], ['neural audio codec']),
          ai('voice agent', 'How does an AI voice on a phone call reply without awkward pauses?', 'A voice agent listens, thinks and starts talking at the same time, in small pieces.', ['speech recognition', 'text-to-speech', 'audio tokens'], ['voice AI', 'speech-to-speech model', 'native audio model']),
        ],
      },
      {
        id: 'generating-images-and-video',
        name: 'Generating images and video',
        topics: [
          ai('diffusion model', 'How does AI turn TV static into a picture?', 'A diffusion model wipes away a little static at a time until a picture appears.', ['generative AI', 'latent space'], ['diffusion']),
          ai('latent diffusion', 'How does an AI image app make a big picture in just seconds?', 'Latent diffusion makes a tiny squeezed picture first, then expands it to full size.', ['diffusion model', 'autoencoder']),
          ai('text-to-image', 'How does a sentence you type turn into the picture you described?', 'Text-to-image turns your words into numbers that steer every step of drawing the picture.', ['latent diffusion', 'image-text embedding'], ['image generation']),
          ai('classifier-free guidance', 'Why does turning up one setting make an AI picture match your words more closely?', 'Guidance makes two guesses, with and without your words, then pushes extra hard toward yours.', ['text-to-image'], ['guidance scale']),
          ai('image-to-image', 'How does AI turn your selfie into a cartoon that still looks like you?', 'Image-to-image blurs your picture with static, then redraws it while keeping its main shapes.', ['text-to-image'], ['inpainting', 'outpainting']),
          ai('character consistency', 'Why does AI draw your character with a different face in every picture?', 'Each picture grows from a new random start, so small details like the face drift.', ['text-to-image'], ['consistent characters']),
          cs('video compression', 'How does a two-hour movie stream smoothly over home internet?', 'Video compression saves one full frame, then only what changes in the frames after it.', ['pixel', 'data compression'], ['video codec']),
          cs('3D rendering', 'How does a video game turn a 3D world into the picture on your screen?', '3D rendering works out which surface each screen dot shows and how light hits it.', ['pixel', 'GPU'], ['ray tracing']),
          ai('diffusion transformer', 'How does an AI image maker keep far corners of a picture making sense together?', 'In a diffusion transformer, every patch of the picture checks all the others during cleanup.', ['diffusion model', 'transformer'], ['DiT']),
          ai('text-to-video', 'How does AI keep a moving dog looking the same in every frame of a video?', 'Text-to-video builds all the frames together, so each one can match the others.', ['diffusion transformer', 'video compression'], ['video generation']),
          ai('deepfake', 'How do people make a video of a real person saying things they never said?', "Deepfake tools learn a face from many photos, then paint it over someone else's moves.", ['voice cloning', 'text-to-video']),
          ai('watermarking', 'How can an AI picture carry a hidden mark that survives a screenshot?', 'Watermarking spreads a faint pattern over the whole picture that a checking tool can spot.', ['deepfake'], ['AI watermark']),
          ai('content provenance', 'How can a photo carry proof of where it came from?', 'Content provenance attaches a sealed record of where the photo came from and each edit.', ['watermarking', 'digital signature'], ['C2PA', 'AI copyright', 'fair use']),
        ],
      },
      {
        id: 'any-to-any-and-the-physical-world',
        name: 'Any-to-any and the physical world',
        topics: [
          ai('native multimodality', 'How can an AI hear that you sound upset when you talk to it?', 'Native multimodality feeds your actual voice into the AI, so it hears your tone.', ['multimodal model', 'vision transformer', 'audio tokens'], ['any-to-any model']),
          ai('embodied AI', 'Why is folding laundry so hard for a robot?', 'Embodied AI learns by acting in the messy real world, where every shirt lands differently.', ['reinforcement learning', 'object detection'], ['robotics AI']),
          ai('vision-language-action model', "How can a robot follow a request like 'put the red cup in the sink'?", 'A vision-language-action model turns your words and its camera view straight into arm moves.', ['vision language model', 'embodied AI'], ['VLA']),
          ai('autonomous vehicles', 'How does a self-driving car decide when to brake for someone crossing?', 'Autonomous vehicles keep guessing where each nearby person and car will move next.', ['embodied AI', 'object detection'], ['self-driving cars']),
        ],
      },
    ],
  },
  {
    level: 9,
    name: 'Training, hardware and evaluation',
    goal: 'Know how LLMs are trained and shaped after pre-training, the hardware that trains them, and how to measure whether a model or an AI system is any good.',
    units: [
      {
        id: 'pre-training-at-scale',
        name: 'Pre-training at scale',
        topics: [
          ai('data filtering', 'How do AI makers pick the good pages out of the whole internet?', 'Data filtering scores every web page for quality and keeps only the top scorers.', ['pre-training', 'data quality'], ['data curation', 'deduplication']),
          ai('synthetic data', 'How can AI learn from practice problems another AI wrote?', 'Synthetic data is practice examples an AI writes, kept only if they pass a check.', ['pre-training']),
          ai('model collapse', "What happens when AI keeps learning from other AI's writing, over and over?", 'In model collapse, each copying round drops rare details until all the writing sounds alike.', ['synthetic data']),
          ai('distributed training', 'How do thousands of chips work on teaching one AI at the same time?', 'Distributed training splits the work across chips, which pool what they learned after every step.', ['pre-training', 'parallel computing'], ['training run', 'checkpoint', 'data parallelism', 'model parallelism']),
          ai('mixed precision training', 'How can rounding numbers off make teaching an AI much cheaper?', 'Mixed precision training does most math with short rounded numbers, which chips handle much faster.', ['distributed training', 'floating-point number']),
          ai('compute-optimal training', 'How do AI makers decide how big to make an AI for their budget?', "Compute-optimal training grows the AI's size and how much it reads at the same pace.", ['scaling laws', 'distributed training'], ['Chinchilla scaling']),
        ],
      },
      {
        id: 'compute-and-hardware',
        name: 'Compute and hardware',
        topics: [
          cs('CUDA', 'How do programmers get a graphics chip to run thousands of math jobs at once?', 'CUDA runs steps written for one number on thousands of numbers at the same time.', ['GPU', 'parallel computing'], ['GPU programming']),
          cs('VRAM', "Why does a graphics card's memory decide which AI it can run?", "VRAM holds the AI's numbers beside the chip, so bigger AIs need more VRAM.", ['GPU', 'RAM'], ['GPU memory', 'memory bandwidth']),
          cs('TPU', 'Why does Google build its own chips just for AI?', "A TPU spends its whole chip on multiplying big grids of numbers, AI's main math.", ['GPU', 'matrix'], ['tensor processing unit', 'AI accelerator']),
          ai('training compute', 'Why does a bigger AI that reads more cost so much more to build?', 'Training compute multiplies AI size by words read, since each word passes through every number.', ['distributed training'], ['compute budget', 'FLOPs', 'floating-point operations', 'compute governance']),
          cs('data center', 'Why does a building full of computers need so much cooling?', 'Data center chips turn nearly all their power into heat that fans and water remove.', ['cloud computing']),
          ai('GPU cluster', 'How do thousands of graphics chips act like one giant computer?', 'A GPU cluster wires chips together with very fast links so they share numbers instantly.', ['data center', 'distributed training'], ['AI supercomputer']),
          ai('AI energy use', 'Why does a longer chatbot answer use more electricity?', "AI energy use grows with each word written, since every word reruns the AI's math.", ['GPU cluster', 'inference'], ['AI power consumption']),
        ],
      },
      {
        id: 'post-training',
        name: 'Post-training',
        topics: [
          ai('supervised fine-tuning', 'How does an AI learn to answer in the polite, tidy style of a chatbot?', 'Supervised fine-tuning has the AI copy thousands of good example answers written by people.', ['fine-tuning'], ['SFT', 'instruction tuning', 'post-training']),
          ai('RLHF', 'How do your thumbs-up and thumbs-down clicks change how a chatbot talks?', 'RLHF rewards the answers people rated higher, so the chatbot gives more answers like them.', ['supervised fine-tuning', 'reinforcement learning'], ['reinforcement learning from human feedback']),
          ai('reward model', 'How does an AI learn to score answers the way people would?', "A reward model learns from people's picks, then scores new answers the way they would.", ['RLHF'], ['preference data', 'human preference data']),
          ai('DPO', "How can an AI learn straight from 'this answer beats that one'?", 'DPO raises the odds of the picked answer and lowers the odds of the other.', ['reward model'], ['direct preference optimization']),
          ai('constitutional AI', 'How can a written list of values teach an AI how to behave?', 'In constitutional AI, an AI grades answers by written rules, and those grades teach it.', ['RLHF'], ['RLAIF']),
          ai('RL with verifiable rewards', 'How does an AI get better at math when a computer can check its answers?', 'The AI tries many solutions, and only those an automatic checker marks right get rewarded.', ['supervised fine-tuning', 'reward signal'], ['RLVR', 'GRPO']),
          ai('safety training', 'How does a chatbot learn which requests to say no to?', 'Safety training shows the AI harmful and harmless requests, rewarding refusals only for harmful ones.', ['supervised fine-tuning'], ['refusal training', 'refusal', 'over-refusal']),
          ai('catastrophic forgetting', 'Why does teaching an AI something new make it forget old skills?', 'Catastrophic forgetting happens because new lessons rewrite the same numbers old skills live in.', ['fine-tuning']),
        ],
      },
      {
        id: 'tuning-your-own-model',
        name: 'Tuning your own model',
        topics: [
          ai('LoRA', 'How can you teach a giant AI a new style by changing just a little?', 'LoRA locks the big AI and teaches only a small add-on that tweaks its answers.', ['fine-tuning', 'matrix'], ['low-rank adaptation', 'parameter-efficient fine-tuning', 'PEFT']),
          ai('distillation', 'How does a small AI learn to copy a big one?', "In distillation, the small AI studies the big AI's answers, including how sure it was.", ['fine-tuning'], ['knowledge distillation']),
          ai('model merging', 'How can two AIs, each taught a different job, be blended into one?', 'Model merging averages the numbers of two AIs that began as copies, keeping both skills.', ['fine-tuning']),
        ],
      },
      {
        id: 'measuring-ai',
        name: 'Measuring AI',
        topics: [
          ai('evals', 'How do you check whether an AI is actually good at the job you need?', 'Evals run the AI on many real examples and grade each answer the same way.', ['accuracy', 'software testing', 'large language model'], ['AI evaluation', 'golden dataset', 'eval set']),
          cs('statistical significance', 'How do you tell if a higher score is real or just luck?', 'Statistical significance asks how often luck alone would give a gap this big.', ['probability'], ['p-value']),
          ai('benchmark', "What does an AI's score on a big public test actually tell you?", 'A benchmark asks every AI the same fixed questions, so their scores can be ranked.', ['evals'], ['benchmark saturation']),
          ai('benchmark contamination', 'How does a public AI test end up in the text a chatbot learned from?', "Benchmark contamination happens because test questions posted online get swept into the AI's reading.", ['benchmark', 'data leakage']),
          ai('LLM-as-a-judge', "How can one AI grade another AI's answers?", 'LLM-as-a-judge gives an AI a clear scoring guide and has it grade each answer.', ['evals'], ['model grader']),
          ai('error analysis', 'How do you find what your AI gets wrong most often?', "Error analysis sorts the AI's mistakes into piles, then you fix the biggest pile first.", ['evals']),
          ai('RAG evaluation', "How do you check that an AI's answer only says what its sources say?", 'RAG evaluation matches each claim in the answer to a line in its documents.', ['evals', 'grounding'], ['faithfulness', 'groundedness']),
          ai('agent evaluation', 'How do you test an AI helper that takes a different path every time?', 'Agent evaluation runs each task many times and grades the end result of every run.', ['evals', 'agent loop'], ['agent benchmarks']),
          ai('calibration', "How can you tell if an AI's '90% sure' really means 90%?", 'Calibration checks that answers given 90% confidence turn out right about 90% of the time.', ['logits', 'evals'], ['model confidence']),
        ],
      },
      {
        id: 'when-models-misbehave',
        name: 'When models misbehave',
        topics: [
          ai('sycophancy', 'Why do chatbots tell you what you want to hear?', 'People tend to rate flattering answers higher, so chatbots learn to agree with you.', ['RLHF']),
          ai('jailbreak', 'How do people trick a chatbot into breaking its own rules?', "A jailbreak hides a banned request inside a story the chatbot's safety lessons never covered.", ['safety training']),
          ai('red-teaming', "How do AI companies find their chatbot's weak spots before the public does?", 'Red-teaming hires testers to attack the AI so problems get fixed before launch.', ['jailbreak'], ['red teaming']),
          ai('adversarial examples', 'How can a change too tiny to see make an AI misread a photo?', 'Adversarial examples shift many tiny dots slightly, each the way that most confuses the AI.', ['image classification'], ['adversarial attack']),
          ai('data poisoning', 'How can a few planted examples give an AI a secret trigger?', 'Data poisoning sneaks in examples that tie a secret word to bad behavior.', ['training data'], ['backdoor']),
        ],
      },
    ],
  },
  {
    level: 10,
    name: 'Running and building with AI',
    goal: 'Run models fast and cheaply on reliable infrastructure, build products on them, and roll AI out in a business within the law.',
    units: [
      {
        id: 'running-software-at-scale',
        name: 'Running software at scale',
        topics: [
          cs('caching', 'Why does a website load faster the second time you open it?', 'Caching keeps a nearby copy of what you used, so the next load is quick.', ['RAM', 'latency'], ['cache']),
          cs('load balancing', 'How does a huge website handle millions of visitors at the same time?', 'Load balancing hands each new visitor to whichever computer is least busy right now.', ['client-server model'], ['horizontal scaling', 'autoscaling']),
          cs('message queue', 'How does an online shop keep every order during a huge sale rush?', 'A message queue lines up incoming jobs so workers handle each one, losing none.', ['client-server model'], ['job queue']),
          cs('rate limit', "Why does an app sometimes say 'too many tries, wait a minute'?", 'A rate limit counts your requests and blocks extras until a set time passes.', ['API'], ['throttling']),
          cs('idempotency', "Why does tapping 'pay' twice still charge you only once?", 'Idempotency gives each payment a one-time tag, so a repeat with that tag is ignored.', ['API', 'database transaction']),
          cs('container', "How does an app run exactly the same on every computer it's moved to?", 'A container packs the app with everything it needs, so nothing changes when it moves.', ['operating system', 'virtual machine'], ['containerization']),
          cs('serverless', 'How can an app run online without its makers ever setting up a computer?', 'Serverless runs your code on rented computers only at the moment someone uses it.', ['cloud computing', 'container'], ['serverless computing']),
          cs('microservices', 'Why are big apps like Netflix built from hundreds of tiny separate programs?', 'Microservices give each small job its own program, so one can change without breaking others.', ['API', 'container'], ['microservice architecture']),
          cs('CDN', "How does a video load fast whether you're in Tokyo or Toronto?", 'A CDN keeps copies of videos on computers near you, so data travels less far.', ['caching', 'latency'], ['content delivery network']),
          cs('failover', 'How do big websites stay up when one of their computers breaks?', 'Failover sends the work to a backup computer the moment the main one stops answering.', ['load balancing'], ['redundancy', 'high availability']),
        ],
      },
      {
        id: 'serving-models',
        name: 'Serving models',
        topics: [
          ai('time to first token', 'Why does a chatbot wait longer to start answering when you paste a long document?', 'Time to first token grows with message length, because the AI reads everything first.', ['inference', 'latency', 'next-token prediction'], ['TTFT', 'streaming', 'streaming responses']),
          ai('KV cache', 'How does a chatbot keep writing fast as its answer gets longer?', 'A KV cache saves the math for earlier words so each new word reuses it.', ['self-attention', 'next-token prediction', 'caching'], ['prefill and decode']),
          ai('continuous batching', 'How does one AI computer answer thousands of chatbot users at once?', 'Continuous batching slips new requests into the running group the moment any answer finishes.', ['KV cache', 'load balancing'], ['throughput', 'tokens per second']),
          ai('speculative decoding', 'How can a small, fast AI help a big AI write answers quicker?', 'A small AI guesses several next words, and the big AI checks them all together.', ['next-token prediction', 'latency']),
          ai('quantization', 'How can an AI shrink to a quarter of its size and still work?', "Quantization stores each of the AI's numbers with fewer digits, so it takes less space.", ['parameters', 'floating-point number']),
          ai('running locally', 'How can a chatbot work on your phone with no internet?', 'A small enough AI fits on your phone, so the phone does all the work.', ['quantization'], ['local LLM', 'on-device AI']),
        ],
      },
      {
        id: 'cost-and-token-economics',
        name: 'Cost and token economics',
        topics: [
          ai('token pricing', 'Why do AI companies charge more for the words a chatbot writes back?', 'Token pricing charges per token, and writing each token takes more work than reading one.', ['token', 'inference'], ['API pricing per token', 'input vs output tokens']),
          ai('prompt caching', 'How do apps make chatbot calls cheaper when every request starts the same way?', 'Prompt caching saves work on a repeated opening, so you pay full price only once.', ['KV cache', 'token pricing'], ['context caching']),
          ai('batch API', "Why does AI cost less when you're happy to wait hours for answers?", 'A batch API runs your jobs when the computers are free, so it charges less.', ['token pricing', 'message queue'], ['batch processing']),
          ai('model cascade', 'How can an app pay less for AI without getting worse answers?', 'A model cascade tries a cheap AI first, saving the pricey one for hard questions.', ['routing', 'token pricing']),
          ai('cost per task', 'Why can a cheap AI still cost a lot to finish one job?', 'Cost per task adds every retry, so a cheap AI that keeps failing gets pricey.', ['token pricing', 'agent loop'], ['AI unit economics', 'AI ROI', 'return on AI investment']),
        ],
      },
      {
        id: 'open-models-and-the-ecosystem',
        name: 'Open models and the ecosystem',
        topics: [
          ai('open-weight model', 'What can you do with an AI you can download onto your own computer?', "An open-weight model's files are public, so anyone can run and change it at home.", ['foundation model', 'open source'], ['open weights', 'open vs closed weights', 'closed model', 'proprietary model', 'build vs buy']),
          ai('model versioning', 'How do apps stay steady when the AI behind them keeps getting updated?', 'Model versioning locks an app to one exact AI version until the team tests another.', ['inference', 'software testing'], ['model deprecation']),
        ],
      },
      {
        id: 'building-ai-products',
        name: 'Building AI products',
        topics: [
          ai('LLM gateway', 'How can an app switch to a different AI company in minutes?', 'Every AI request passes through an LLM gateway, so switching companies means changing one setting.', ['routing', 'failover'], ['AI gateway', 'fallback model']),
          ai('PII redaction', 'How do companies keep your name and address out of the AI they use?', 'PII redaction finds personal details like names and phone numbers and blanks them out first.', ['guardrails', 'logging'], ['data masking', 'data privacy', 'GDPR', 'zero data retention', 'data retention policy']),
          ai('MLOps', 'How do companies keep an AI working well months after it launches?', "MLOps keeps checking an AI's answers after launch and retrains it when they slip.", ['software testing', 'CI/CD'], ['LLMOps']),
          ai('data drift', 'Why does an AI that worked great last year slowly get worse?', 'Data drift happens when the real world changes, so old lessons stop matching new cases.', ['MLOps'], ['concept drift']),
          ai('data flywheel', 'How does simply using an AI app help make it better?', "In a data flywheel, every user's clicks teach the app, so more users improve it.", ['MLOps'], ['feedback loop']),
          cs('A/B test', 'How does an app know if a new button design actually works better?', 'An A/B test shows two versions to random users and counts which one does better.', ['statistical significance', 'feature flag'], ['split test']),
          ai('online evaluation', 'How do companies know a chatbot is doing well once real people use it?', 'Online evaluation grades a sample of real chats every day to spot drops in quality.', ['A/B test', 'evals']),
        ],
      },
      {
        id: 'law-policy-and-society',
        name: 'Law, policy and society',
        topics: [
          ai('AI pilot', 'Why do so many AI trial runs at companies never get used for real?', 'An AI pilot runs on clean sample data, then real messy work breaks it.', [], ['proof of concept', 'AI use case', 'AI adoption', 'AI change management']),
          ai('algorithmic fairness', 'How can you tell if an AI treats some groups of people unfairly?', "Algorithmic fairness checks compare the AI's mistakes across groups, like who gets wrongly turned down.", ['data bias', 'precision and recall'], ['AI bias', 'AI regulation', 'risk-based regulation', 'EU AI Act']),
          ai('explainable AI', "How can a bank's AI tell you what would get your loan approved?", 'Explainable AI tests small changes to your details to find which one flips the answer.', ['decision tree', 'guardrails'], ['XAI']),
          ai('AI and jobs', "What happens to someone's job when AI shows up at their work?", "AI takes over some tasks inside a job, so the job's mix of work changes.", [], ['job displacement', 'automation vs augmentation']),
        ],
      },
    ],
  },
  {
    level: 11,
    name: 'The frontier',
    goal: 'Reach expert depth: aligning powerful models, looking inside them, the open research questions, and the limits of computing itself.',
    units: [
      {
        id: 'alignment',
        name: 'Alignment',
        topics: [
          ai('AI alignment', "Why can't builders just tell a powerful AI what to care about?", "AI alignment shapes an AI's goals only through rewarded examples, so its goals stay hidden.", ['safety training'], ['alignment', 'superintelligence', 'ASI', 'existential risk', 'x-risk', 'recursive self-improvement']),
          ai('specification gaming', 'Why does an AI cheat its way to a high score?', 'In specification gaming, an AI grabs any loophole that raises its score.', ['reward signal', 'AI alignment'], ['reward hacking']),
          ai('goal misgeneralization', 'Why can an AI that aced practice chase the wrong goal later?', 'The AI learns a shortcut that matched the real goal in practice but fails elsewhere.', ['overfitting', 'AI alignment']),
          ai('deceptive alignment', "Could an AI behave well only because it knows it's being tested?", 'Deceptive alignment would be an AI faking good behavior whenever it thinks someone is watching.', ['goal misgeneralization'], ['scheming']),
          ai('scalable oversight', "How can people check an AI's work on problems too hard for them?", 'Scalable oversight has AI helpers point out flaws, which people can then check themselves.', ['AI alignment', 'LLM-as-a-judge']),
          ai('weak-to-strong generalization', 'Can a less smart teacher raise an AI that ends up smarter than them?', "A strong AI grasps the idea behind a weak teacher's examples, then beats the teacher.", ['scalable oversight']),
          ai('AI control', "How do you keep an AI from doing harm if you can't fully trust it?", 'AI control surrounds an AI with watchers and limits, so sneaky moves get caught.', ['AI alignment', 'AI agent']),
          ai('chain-of-thought faithfulness', 'When a chatbot shows its thinking steps, are those steps really how it decided?', "Tests show a chatbot's written steps often leave out what really changed its answer.", ['chain of thought', 'evals'], ['CoT monitoring']),
          ai('dangerous capability evals', 'How do AI labs check if a new AI could help someone build a weapon?', 'Dangerous capability evals score harmful skills, and crossing a set line triggers extra safety.', ['evals', 'red-teaming'], ['responsible scaling policy', 'frontier safety framework']),
          ai('sandbagging', 'Could an AI fail a test on purpose to hide its real skills?', "Sandbagging is an AI doing worse on purpose, so testers think it's less capable.", ['dangerous capability evals']),
        ],
      },
      {
        id: 'interpretability',
        name: 'Interpretability',
        topics: [
          ai('mechanistic interpretability', 'How do scientists look inside an AI to see how it thinks?', 'Mechanistic interpretability traces signals inside an AI part by part to learn how it answers.', ['explainable AI', 'transformer'], ['interpretability']),
          ai('saliency map', 'How can you see which parts of a photo an AI looked at?', "A saliency map highlights the photo spots that most changed the AI's answer.", ['explainable AI', 'image classification'], ['feature attribution']),
          ai('probing', 'How can you tell if an AI secretly knows something it never says?', "Probing checks if a simple test can read the fact from the AI's hidden numbers.", ['mechanistic interpretability'], ['linear probe']),
          ai('circuit', 'How do tiny parts inside an AI team up to do one job?', 'A circuit chains a few pieces inside an AI so together they do one job.', ['mechanistic interpretability'], ['circuits']),
          ai('induction head', 'How does a chatbot copy a pattern it saw earlier in your message?', 'An induction head spots an earlier copy of this word and repeats what followed it.', ['circuit', 'multi-head attention']),
          ai('polysemanticity', 'Why does one tiny part inside an AI react to totally unrelated things?', 'Polysemanticity shows up because each inner part gets reused for several ideas to save room.', ['mechanistic interpretability', 'artificial neuron']),
          ai('superposition', 'How does an AI fit more ideas than it has parts to store them?', 'Superposition squeezes extra ideas into shared parts, which works since few ideas appear together.', ['polysemanticity']),
          ai('sparse autoencoder', "How do researchers sort an AI's tangled insides into ideas people can read?", 'A sparse autoencoder splits each tangled signal into a few clear ideas people can name.', ['superposition', 'autoencoder'], ['SAE']),
          ai('activation steering', "How can scientists change an AI's mood by tweaking its insides?", "Activation steering adds a chosen idea's signal inside the AI, pushing every answer toward it.", ['sparse autoencoder'], ['steering vectors']),
          ai('logit lens', "Can you peek at an AI's half-formed guess before it finishes thinking?", "The logit lens turns the AI's halfway signal into its best word guess so far.", ['residual stream', 'logits']),
        ],
      },
      {
        id: 'research-frontiers',
        name: 'Research frontiers',
        topics: [
          ai('state space model', 'How could an AI read a million words without getting slower and slower?', 'A state space model reads word by word, updating a summary that never grows.', ['quadratic attention cost', 'recurrent neural network'], ['SSM']),
          ai('multi-token prediction', 'What happens when an AI learns to guess several words ahead at once?', 'Multi-token prediction makes an AI guess several next words at once, helping it plan ahead.', ['next-token prediction']),
          ai('diffusion language model', 'Could an AI write a whole answer at once, the way AI paints pictures?', 'A diffusion language model fills in a whole page of blanks over several quick rounds.', ['diffusion model', 'next-token prediction']),
          ai('test-time training', 'What if an AI kept learning while it worked on your problem?', "Test-time training lets the AI practice on your problem's examples and tweak itself before answering.", ['test-time compute', 'fine-tuning']),
          ai('continual learning', 'How could a chatbot keep learning new things without losing what it knew?', 'Continual learning mixes old practice back in with new lessons, so old skills stay fresh.', ['catastrophic forgetting']),
          ai('grokking', 'Why does an AI sometimes suddenly get a task long after memorizing the answers?', 'With grokking, long extra practice slowly swaps memorized answers for the simple rule behind them.', ['overfitting']),
          ai('double descent', 'Why can making an AI bigger first hurt, then help again?', 'An AI just barely big enough to memorize everything bends to fit even wrong examples.', ['bias-variance tradeoff']),
          ai('world model', 'Can an AI learn how the world works just by watching videos?', 'A world model learns to predict what happens next in a scene, like falling balls.', ['text-to-video', 'reinforcement learning']),
        ],
      },
      {
        id: 'limits-of-computing',
        name: 'Limits of computing',
        topics: [
          cs('halting problem', "Why can't any app tell for sure if another program will run forever?", "A program can always be built to do the opposite of any checker's guess.", ['algorithm'], ['undecidability']),
          cs('P vs NP', 'Why can a puzzle be quick to check but painfully slow to solve?', 'Checking tests just one answer, but solving may mean trying a huge number of guesses.', ['Big O notation'], ['NP-complete']),
          cs('formal verification', "How can someone prove an app's code will always do the right thing?", 'Formal verification uses math to prove the code works for every possible input.', ['software testing', 'halting problem']),
          cs('quantum computing', 'How could a quantum computer solve some problems in minutes that take others years?', 'Quantum computing lets wrong answers cancel each other out, so the right one stands out.', ['binary', 'P vs NP'], ['qubit']),
        ],
      },
    ],
  },
];
