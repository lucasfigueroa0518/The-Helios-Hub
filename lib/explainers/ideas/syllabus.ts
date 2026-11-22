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
 * Rules (tests/explainers-syllabus.test.ts checks the mechanical ones):
 * - Levels are numbered 1..n in order. Units sit inside a level, and topics inside a unit are in teaching order. Every
 *   unit has topics.
 * - term follows TERM_RULE (lib/explainers/ideas/generator.ts): the exact name of one concept as a viewer would search
 *   it, 1 to 4 words, lowercase unless an acronym or proper name.
 * - angle: one plain-words line, the question the reel answers, as the viewer would ask it ("how …", "why …", "what
 *   actually happens when …"). A practical topic's angle is the how; a mechanism topic's angle is the hidden mechanism.
 *   It uses no jargon the viewer has not met by that point in the file, no product news and no hype, and the wording
 *   varies from topic to topic. The idea generator must deliver it.
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
  requires: readonly string[];
  aka?: readonly string[];
};
export type SyllabusUnit = { id: string; name: string; topics: readonly SyllabusTopic[] };
export type SyllabusLevel = { level: number; name: string; goal: string; units: readonly SyllabusUnit[] };

function topic(kind: SyllabusTopic['kind'], term: string, angle: string, requires: readonly string[], aka?: readonly string[]): SyllabusTopic {
  return aka ? { term, kind, angle, requires, aka } : { term, kind, angle, requires };
}

/** An AI topic: term, angle, prerequisites, other names. */
function ai(term: string, angle: string, requires: readonly string[] = [], aka?: readonly string[]): SyllabusTopic {
  return topic('ai', term, angle, requires, aka);
}

/** A computer-science or software topic: term, angle, prerequisites, other names. */
function cs(term: string, angle: string, requires: readonly string[] = [], aka?: readonly string[]): SyllabusTopic {
  return topic('cs', term, angle, requires, aka);
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
          cs('algorithm', 'How does a computer solve a problem by following exact steps, and what makes one set of steps better than another?'),
          ai('artificial intelligence', 'What makes software count as AI, rather than an ordinary program following its instructions?', ['algorithm'], ['AI', 'narrow AI', 'weak AI']),
          ai('rule-based system', 'Why did early AI, built from hand-written if-then rules, keep breaking on real life?', ['artificial intelligence', 'algorithm'], ['expert system']),
          ai('machine learning', 'How does a computer pick up a skill from examples when nobody writes down the rules?', ['artificial intelligence'], ['ML']),
          ai('AI model', 'What is actually stored inside the thing people call an AI model?', ['machine learning'], ['model']),
          ai('model training', 'What actually happens, step by step, while a model is being trained?', ['AI model'], ['training']),
          ai('inference', 'Why does getting an answer from a trained model cost a sliver of what training it did?', ['model training'], ['model serving', 'inference server']),
          ai('neural network', 'How does a web of tiny adjustable number-crunchers learn to recognize a face?', ['machine learning']),
          ai('deep learning', 'Why did stacking more layers make neural networks suddenly good at photos, speech and language?', ['neural network']),
          ai('generative AI', 'How can a model that learned from millions of examples make something that never existed?', ['deep learning'], ['GenAI']),
          ai('AGI', 'What would AI have to do to count as general intelligence, and why do experts disagree on how close it is?', ['artificial intelligence'], ['artificial general intelligence']),
        ],
      },
      {
        id: 'meet-the-chatbot',
        name: 'Meet the chatbot',
        topics: [
          ai('large language model', 'How did a model that only learned to continue text end up able to write, summarize and answer questions?', ['generative AI'], ['LLM', 'chatbot']),
          ai('foundation model', 'Why can one giant general-purpose model be reused for thousands of different jobs?', ['large language model'], ['frontier model']),
          ai('multimodal model', 'How can one model look at a photo, read your question about it and answer in words?', ['foundation model'], ['multimodal AI']),
          ai('hallucination', 'Why does a chatbot state made-up facts with total confidence?', ['large language model']),
          ai('knowledge cutoff', "Why doesn't a chatbot know what happened last week unless it can search the web?", ['large language model'], ['training cutoff']),
          ai('AI agent', 'What changes when an AI can take actions, not just answer?', ['large language model'], ['agent', 'agentic AI']),
        ],
      },
      {
        id: 'how-a-computer-works',
        name: 'How a computer works',
        topics: [
          cs('binary', 'How can a computer hold a photo, a song and a sentence using nothing but ones and zeros?', [], ['bits and bytes']),
          cs('logic gate', 'How do billions of tiny on-off switches end up doing arithmetic?', ['binary'], ['transistor']),
          cs('CPU', 'What does a processor actually do billions of times every second?', ['logic gate'], ['processor']),
          cs('RAM', 'Why does a computer forget what was in memory when it shuts off, yet keep your files?', ['CPU'], ['memory vs storage']),
          cs('operating system', 'How does one computer run dozens of apps at once without them trampling each other?', ['CPU', 'RAM'], ['OS']),
          cs('GPU', 'Why did a chip built for video games become the engine of AI?', ['CPU']),
          cs("Moore's law", 'Why did chips get about twice as powerful every couple of years, and why is that slowing down?', ['CPU']),
        ],
      },
      {
        id: 'how-a-computer-stores-things',
        name: 'How a computer stores things',
        topics: [
          cs('Unicode', 'How does a computer turn letters and emoji from every language into numbers?', ['binary'], ['character encoding']),
          cs('pixel', 'How does a photo become a grid of numbers a computer can edit?', ['binary'], ['digital image']),
          cs('vector graphics', 'Why does a logo stay sharp at any size while a photo turns blocky when you zoom in?', ['pixel'], ['SVG']),
          cs('digital audio', 'How does sound become a long list of numbers, and why does the sample rate matter?', ['binary'], ['sample rate']),
          cs('data compression', 'How can a file shrink without losing anything, and when does it have to throw detail away?', ['binary'], ['lossless compression', 'lossy compression']),
          cs('error-correcting code', 'How can a scratched disc or a torn QR code still be read perfectly?', ['binary'], ['error correction']),
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
          cs('programming language', 'Why are there hundreds of programming languages if every one ends up as the same instructions for the chip?', ['algorithm', 'CPU']),
          cs('compiler', 'What happens to code between the moment someone types it and the moment it runs?', ['programming language'], ['interpreter']),
          cs('debugging', "How do programmers track down a bug they can't see?", ['programming language'], ['bug']),
          cs('software testing', 'How do programmers know their code still works after every change?', ['debugging'], ['unit test']),
          cs('diff', 'How does a computer show exactly what changed between two versions of a file?', ['programming language']),
          cs('version control', 'How do dozens of people change the same code at once without overwriting each other?', ['diff'], ['Git']),
          cs('CI/CD', 'How do teams ship new code many times a day without breaking things?', ['software testing', 'version control'], ['continuous integration', 'continuous deployment']),
          cs('feature flag', 'How do apps switch a new feature on for a few users before everyone gets it?', ['CI/CD']),
          cs('open source', 'Why do companies give away code anyone can copy, and who keeps it maintained?', ['version control']),
          cs('package manager', 'How do programmers build on millions of lines of code they never wrote, and what can go wrong?', ['open source'], ['software dependency']),
          cs('technical debt', 'Why does rushed code make every later change slower and more expensive?', ['software testing'], ['refactoring']),
        ],
      },
      {
        id: 'data-structures-and-algorithms',
        name: 'Data structures and algorithms',
        topics: [
          cs('data structure', 'Why does the way a program organizes its data decide how fast it runs?', ['programming language']),
          cs('stack', "Why does an app's undo button work like a pile of plates?", ['data structure'], ['call stack']),
          cs('tree data structure', 'Why do file folders, family trees and search engines all branch the same way?', ['data structure'], ['tree']),
          cs('graph data structure', 'How do maps, social networks and the web all fit one simple structure of dots and lines?', ['data structure'], ['graph']),
          cs('hash function', 'How can any file be boiled down to a short fingerprint that changes if a single letter does?', ['binary'], ['checksum']),
          cs('hash table', 'How does a program find one item among millions almost instantly?', ['hash function', 'data structure'], ['hash map', 'dictionary']),
          cs('Big O notation', 'Why does a program that is fast on ten items crawl on a million?', ['algorithm', 'data structure'], ['time complexity']),
          cs('sorting algorithm', 'How does a computer put a million things in order, and why are some ways vastly faster than others?', ['Big O notation'], ['sorting']),
          cs('binary search', 'How can you find one name among a billion sorted names in about thirty steps?', ['sorting algorithm']),
          cs('recursion', 'How can a function solve a problem by handing a smaller copy of it to itself?', ['programming language']),
          cs('shortest path algorithm', 'How does a map app find the fastest route through millions of roads in a second?', ['graph data structure', 'Big O notation'], ["Dijkstra's algorithm", 'pathfinding']),
          cs('state machine', 'How does a program keep track of where it is in a process with many steps?', ['graph data structure'], ['finite state machine']),
          cs('concurrency', 'Why do two things running at the same time cause bugs that vanish when you look for them?', ['operating system'], ['race condition', 'deadlock']),
        ],
      },
      {
        id: 'how-the-internet-works',
        name: 'How the internet works',
        topics: [
          cs('packet switching', 'How does a video cross the world in thousands of pieces and arrive in the right order?', ['binary'], ['TCP/IP', 'data packet']),
          cs('IP address', 'How does data find one device among billions on the internet?', ['packet switching']),
          cs('DNS', 'What actually happens between typing a web address and the site appearing?', ['IP address'], ['domain name system']),
          cs('latency', 'Why can a fast internet connection still feel slow?', ['packet switching'], ['bandwidth']),
          cs('client-server model', 'What does each side do when an app on your phone talks to a server?', ['IP address'], ['client and server']),
          cs('HTTP', 'What does your browser actually say to a website when it asks for a page?', ['client-server model', 'DNS'], ['HTTPS']),
          cs('HTML', 'How does a page of plain text and tags become the website you see?', ['HTTP'], ['web page']),
          cs('cookie', 'How does a website remember who you are between visits?', ['HTTP'], ['browser cookie']),
          cs('frontend vs backend', "What's the difference between the part of an app you see and the part you don't?", ['client-server model'], ['frontend', 'backend']),
          cs('cloud computing', 'Why do companies rent computers they never see instead of buying their own?', ['client-server model'], ['the cloud']),
          cs('API', 'How do two programs built by strangers manage to work together?', ['HTTP'], ['application programming interface', 'REST API']),
          cs('webhook', 'How does one app tell another the moment something happens, without being asked?', ['API']),
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
          cs('structured data', 'Why is a spreadsheet easy for software to use, while a pile of emails and photos is hard?', ['data structure'], ['tabular data', 'unstructured data']),
          cs('database', 'How does a database keep millions of records safe and findable while many people change them at once?', ['structured data'], ['relational database']),
          cs('SQL', 'How do you ask a database a question, and why can one short query replace a whole program?', ['database']),
          cs('database index', 'Why can the same database lookup take minutes without an index and milliseconds with one?', ['database', 'binary search']),
          cs('database transaction', 'How does a bank transfer never take money out of one account without putting it in the other?', ['database'], ['ACID']),
          cs('data warehouse', 'Why do companies copy their data into a separate place just for analysis?', ['database'], ['data lake']),
          cs('data pipeline', 'How does raw data from many systems get cleaned and moved to where it is needed?', ['data warehouse'], ['ETL']),
        ],
      },
      {
        id: 'math-you-need',
        name: 'Math you need',
        topics: [
          cs('probability', 'How do you put a number on how likely something is, and why does AI run on it?'),
          cs("Bayes' theorem", 'How should one new piece of evidence change what you believe?', ['probability']),
          cs('vector', 'How can a plain list of numbers stand for a point, a direction or even an idea?'),
          cs('matrix', 'Why is multiplying grids of numbers the most common job a computer does in AI?', ['vector'], ['matrix multiplication']),
          cs('derivative', 'How does knowing the slope at one spot tell you which way is downhill?', [], ['slope', 'gradient']),
        ],
      },
      {
        id: 'data-for-learning',
        name: 'Data for learning',
        topics: [
          ai('training data', 'Why does what a model learns depend more on its examples than on its code?', ['model training', 'structured data'], ['dataset']),
          ai('feature', 'How do you decide which facts about an example a model should pay attention to?', ['training data'], ['feature engineering']),
          ai('label', 'Where do the right answers a model learns from come from, and who writes them?', ['training data'], ['ground truth', 'data labeling']),
          ai('data quality', 'Why does a model trained on messy data confidently learn the mess?', ['training data'], ['garbage in, garbage out']),
          ai('train/test split', 'Why do you hide some of your data from a model to find out whether it really learned?', ['training data'], ['test set', 'holdout set']),
          ai('data leakage', 'How can a model ace its test and then fail on day one?', ['train/test split']),
          ai('data bias', 'How does a model end up unfair when nobody told it to be?', ['training data'], ['sampling bias']),
        ],
      },
      {
        id: 'how-machines-learn',
        name: 'How machines learn',
        topics: [
          ai('supervised learning', 'How does a model learn from examples that come with the right answers attached?', ['label']),
          ai('unsupervised learning', 'What can a model find in data when nobody gives it any answers?', ['supervised learning'], ['clustering', 'k-means']),
          ai('self-supervised learning', 'How does a model make its own practice questions out of raw data?', ['unsupervised learning']),
          ai('reinforcement learning', 'How does a program learn to win a game nobody taught it, from wins and losses alone?', ['machine learning'], ['RL']),
          ai('classification', 'How does a model decide which category a new example belongs in?', ['supervised learning'], ['classifier']),
          ai('loss function', 'How does a model measure how wrong it is, and why does that one number steer all its learning?', ['supervised learning'], ['cost function']),
          ai('parameters', 'What are the billions of numbers inside a model, and what does changing one of them do?', ['AI model'], ['weights', 'model weights']),
          ai('gradient descent', 'How does a model find better settings by feeling its way downhill, one small step at a time?', ['loss function', 'parameters', 'derivative']),
          ai('learning rate', 'Why does a model that learns too fast never settle, and one that learns too slowly never arrives?', ['gradient descent']),
          ai('overfitting', 'Why can a model that memorized its training examples fail on new ones?', ['train/test split'], ['generalization', 'memorization']),
          ai('bias-variance tradeoff', 'Why does making a model simpler sometimes make it better?', ['overfitting'], ['underfitting']),
          ai('regularization', 'How do you stop a model from memorizing when you want it to learn?', ['overfitting']),
          ai('hyperparameter', 'Which settings does a person choose before training starts, and how do you find good ones?', ['parameters', 'learning rate'], ['hyperparameter tuning']),
        ],
      },
      {
        id: 'classic-models',
        name: 'Classic models',
        topics: [
          ai('linear regression', 'How does fitting a straight line through points let a model predict a number like a price?', ['gradient descent'], ['regression']),
          ai('logistic regression', 'How does a model turn a score into a yes-or-no probability?', ['classification', 'linear regression', 'probability']),
          ai('decision tree', 'How does a model learn a flowchart of yes-or-no questions from data?', ['classification', 'tree data structure']),
          ai('random forest', 'Why do hundreds of so-so decision trees voting together beat one good one?', ['decision tree'], ['ensemble learning']),
          ai('gradient boosting', 'How does each new tree in a boosted model fix the mistakes of the ones before it?', ['random forest'], ['boosted trees']),
          ai('k-nearest neighbors', 'How can a model classify something just by checking its closest look-alikes?', ['classification', 'vector'], ['KNN']),
          ai('recommendation system', 'How does a streaming app guess what you will like from what people like you watched?', ['k-nearest neighbors'], ['collaborative filtering']),
          ai('time series forecasting', 'How does a model predict next month from the shape of the past, and when does that break?', ['linear regression'], ['forecasting']),
          ai('anomaly detection', 'How does software spot the one fraudulent charge among millions of normal ones?', ['unsupervised learning'], ['outlier detection']),
        ],
      },
      {
        id: 'measuring-a-model',
        name: 'Measuring a model',
        topics: [
          ai('accuracy', 'How can a model be 99% accurate and still useless?', ['classification', 'train/test split'], ['class imbalance']),
          ai('confusion matrix', 'How do you see exactly which mistakes a model makes, not just how many?', ['accuracy'], ['false positive', 'false negative']),
          ai('precision and recall', 'Why does catching more fraud always mean flagging more innocent people too?', ['confusion matrix'], ['F1 score']),
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
          cs('floating-point number', 'How does a computer store a number like 0.1 in a fixed number of bits, and why is it slightly off?', ['binary'], ['floating point']),
          cs('tensor', 'Why does AI code describe everything, from photos to sentences, as stacks of numbers called tensors?', ['matrix']),
          cs('parallel computing', 'Why does splitting a job across thousands of small cores beat one fast core for some work and not others?', ['GPU', 'concurrency']),
          cs('random number generator', 'How does a computer that follows exact steps produce random numbers?', ['algorithm'], ['pseudorandom number', 'random seed']),
          cs('Monte Carlo method', 'How can thousands of random guesses solve a problem too hard to calculate exactly?', ['random number generator', 'probability']),
        ],
      },
      {
        id: 'inside-a-neural-network',
        name: 'Inside a neural network',
        topics: [
          ai('artificial neuron', 'What does a single artificial neuron compute, and how loosely is it like a brain cell?', ['neural network'], ['perceptron']),
          ai('activation function', 'Why does each neuron need a little bend in its output for a network to learn anything interesting?', ['artificial neuron'], ['ReLU']),
          ai('feedforward network', 'How do layers of neurons pass a signal forward and turn raw input into an answer?', ['activation function'], ['multilayer perceptron', 'MLP', 'hidden layer', 'forward pass']),
          ai('backpropagation', 'How does a network work out which of its millions of weights caused a mistake?', ['feedforward network', 'gradient descent'], ['backprop']),
          ai('vanishing gradient', 'Why did deep networks stop learning in their early layers, and what fixed it?', ['backpropagation']),
          ai('batch size', 'Why does a model learn from small batches of examples rather than one at a time or all at once?', ['gradient descent'], ['mini-batch', 'epoch']),
          ai('dropout', 'Why does randomly switching off neurons during training make a network better?', ['regularization', 'feedforward network']),
          ai('softmax', 'How does a network turn raw scores into probabilities that add up to one?', ['activation function', 'probability']),
          ai('cross-entropy loss', 'Why does a confident wrong answer cost a model far more than a hesitant one?', ['loss function', 'softmax']),
        ],
      },
      {
        id: 'architectures-before-transformers',
        name: 'Architectures before transformers',
        topics: [
          ai('convolutional neural network', 'How does a network spot an edge, then an eye, then a face by sliding small filters across a picture?', ['feedforward network', 'pixel'], ['CNN']),
          ai('recurrent neural network', 'How does a network read a sentence one word at a time and carry a memory along?', ['feedforward network'], ['RNN']),
          ai('LSTM', 'How did adding gates that decide what to keep and what to forget let networks remember across long sentences?', ['recurrent neural network', 'vanishing gradient'], ['long short-term memory']),
          ai('residual connection', 'How do shortcuts that skip layers let networks grow hundreds of layers deep?', ['vanishing gradient'], ['skip connection']),
          ai('autoencoder', 'What does a network learn when it is trained to squeeze data down and rebuild it?', ['feedforward network', 'data compression'], ['variational autoencoder', 'VAE']),
          ai('latent space', 'How can a model arrange everything it learned so that similar things sit close together?', ['autoencoder']),
          ai('GAN', 'How do two networks, one forging and one detecting, push each other to make realistic images?', ['feedforward network', 'generative AI'], ['generative adversarial network']),
        ],
      },
      {
        id: 'learning-by-reward',
        name: 'Learning by reward',
        topics: [
          ai('reward signal', 'How does a single score for doing well end up shaping complex behavior?', ['reinforcement learning'], ['reward']),
          ai('policy', 'How does a learning agent turn what it sees into what it does next?', ['reward signal']),
          ai('exploration vs exploitation', 'When should a learner try something new instead of repeating what already works?', ['policy']),
          cs('game tree search', 'How does a chess program look ahead millions of moves without checking every one?', ['tree data structure', 'Monte Carlo method'], ['minimax', 'Monte Carlo tree search']),
          ai('deep reinforcement learning', 'How did adding neural networks let reward-based learning handle games far too big to map out?', ['policy', 'neural network'], ['deep RL']),
          ai('self-play', 'How can an AI become a world-class player by playing millions of games against itself?', ['deep reinforcement learning', 'game tree search']),
        ],
      },
      {
        id: 'reusing-what-a-model-learned',
        name: 'Reusing what a model learned',
        topics: [
          ai('data augmentation', 'How does flipping, cropping and tweaking the same examples teach a model more?', ['training data', 'overfitting']),
          ai('transfer learning', 'Why can a model trained on one task learn a related one from far fewer examples?', ['deep learning'], ['pretrained model']),
          ai('fine-tuning', 'How do you take a model that already knows a lot and specialize it for your job?', ['transfer learning']),
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
          ai('token', "Why does a language model read text in chunks that aren't quite words?", ['large language model'], ['token count', 'tokens per word']),
          ai('tokenizer', 'How does a model decide where to cut text into tokens, and why does that trip it up on spelling and math?', ['token', 'Unicode'], ['tokenization', 'vocabulary', 'byte-pair encoding', 'BPE']),
          ai('embedding', 'How can a list of numbers capture what a word means?', ['vector', 'token', 'latent space'], ['vector embedding', 'embedding space', 'vector space']),
          ai('semantic similarity', "How does a model tell that 'car' and 'automobile' mean the same thing without a dictionary?", ['embedding'], ['cosine similarity']),
          ai('positional encoding', 'How does a model keep track of word order when it reads every word at once?', ['embedding'], ['position embedding', 'RoPE']),
        ],
      },
      {
        id: 'attention-and-the-transformer',
        name: 'Attention and the transformer',
        topics: [
          ai('attention mechanism', 'How does a model decide which earlier words matter most for the next one?', ['embedding', 'recurrent neural network'], ['attention']),
          ai('self-attention', 'How does every word in a sentence look at every other word to work out what it means?', ['attention mechanism']),
          ai('query key value', 'How does attention match what one word is looking for with what the other words offer?', ['self-attention'], ['QKV']),
          ai('multi-head attention', 'Why does a model run many attention patterns side by side instead of one?', ['query key value'], ['attention head']),
          ai('causal masking', 'How is a model stopped from peeking at the words it is supposed to predict?', ['self-attention'], ['causal attention']),
          ai('transformer', 'What made the transformer design beat everything before it at language?', ['multi-head attention', 'feedforward network', 'positional encoding'], ['transformer architecture', 'transformer block', 'transformer layer']),
          ai('residual stream', 'How do the layers of a transformer share one running notepad of meaning?', ['transformer', 'residual connection']),
          ai('encoder vs decoder', 'Why are some transformers built to understand text and others built to write it?', ['transformer', 'causal masking'], ['decoder-only model', 'encoder-only model']),
          ai('mixture of experts', 'How can a huge model answer quickly by waking up only a few of its parts for each word?', ['transformer'], ['MoE']),
        ],
      },
      {
        id: 'how-the-answer-comes-out',
        name: 'How the answer comes out',
        topics: [
          cs('Markov chain', 'How can simply counting which word tends to follow which produce text that almost makes sense?', ['probability'], ['n-gram model']),
          ai('next-token prediction', 'How does predicting just one next token, over and over, add up to a whole essay?', ['token', 'Markov chain'], ['autoregressive generation', 'autoregressive model']),
          ai('logits', "What does a model's ranked list of candidate next tokens look like before it picks one?", ['next-token prediction', 'softmax'], ['token probabilities', 'logprobs', 'log probabilities']),
          ai('decoding strategy', "Why doesn't a model always pick its single most likely next word?", ['logits'], ['sampling', 'greedy decoding']),
          ai('temperature', "What does turning a model's temperature up or down actually change?", ['decoding strategy', 'random number generator']),
          ai('top-p sampling', 'How does a model stay creative without wandering into nonsense?', ['temperature'], ['nucleus sampling', 'top-k sampling']),
          ai('nondeterminism', 'Why can the same question get a different answer every time you ask?', ['temperature'], ['why answers vary']),
          ai('perplexity', 'How do researchers measure how surprised a model is by real text?', ['next-token prediction', 'cross-entropy loss']),
        ],
      },
      {
        id: 'size-and-scale',
        name: 'Size and scale',
        topics: [
          ai('parameter count', 'Does a model with more parameters actually know more, and what does the extra size cost?', ['parameters', 'large language model'], ['model size']),
          ai('context window', 'How much can a model hold in mind at once, and what happens to what falls out?', ['token'], ['context length']),
          ai('quadratic attention cost', 'Why does doubling the text a model reads make attention about four times the work?', ['self-attention', 'context window']),
          ai('pre-training', 'What does a model actually learn from reading trillions of words with no teacher?', ['next-token prediction', 'self-supervised learning', 'training data'], ['pretraining']),
          ai('base model', 'Why does a freshly pretrained model continue your question instead of answering it?', ['pre-training'], ['instruction-tuned model', 'chat model', 'instruct model']),
          ai('scaling laws', 'Why does a model improve so predictably as you add data, size and compute?', ['parameter count', 'pre-training']),
          ai('emergent abilities', 'Why do some skills seem to switch on suddenly as models grow, and is that real?', ['scaling laws'], ['emergence']),
          ai('small language model', 'How can a small model beat a giant one at a narrow job?', ['parameter count'], ['SLM']),
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
          ai('prompt engineering', 'How do you write a prompt that gets the answer you actually wanted?', ['large language model'], ['prompt', 'prompting']),
          ai('system prompt', 'How do hidden instructions shape every answer a chatbot gives?', ['prompt engineering'], ['system message', 'chat roles', 'message roles']),
          ai('in-context learning', 'How does a model pick up a new task from your message alone, with no retraining?', ['prompt engineering', 'context window'], ['zero-shot prompting']),
          ai('few-shot prompting', 'Why do a couple of worked examples in a prompt beat a paragraph of instructions?', ['in-context learning'], ['few-shot examples']),
          ai('role prompting', "Does telling a model 'you are an expert' actually help, and when?", ['system prompt'], ['persona prompt']),
          ai('prompt structure', 'Why does splitting a prompt into clearly labeled sections make answers more reliable?', ['prompt engineering'], ['delimiters', 'XML tags']),
          ai('instruction following', 'Why does a model sometimes ignore half of what you asked, and how do you stop it?', ['base model', 'prompt engineering']),
          ai('prompt sensitivity', 'Why can rewording a question slightly change the answer completely?', ['prompt engineering'], ['prompt brittleness']),
          ai('prompt chaining', 'Why do several small prompts in a row beat one giant prompt?', ['prompt engineering'], ['task decomposition']),
        ],
      },
      {
        id: 'thinking-before-answering',
        name: 'Thinking before answering',
        topics: [
          ai('chain of thought', 'Why does asking a model to show its work make it more accurate?', ['prompt engineering'], ['CoT']),
          ai('self-critique', 'Can a model catch its own mistakes by reviewing its answer, and when does that fail?', ['prompt chaining'], ['self-reflection']),
          ai('self-consistency', 'Why does asking the same question several times and taking the most common answer work?', ['chain of thought', 'nondeterminism']),
          ai('reasoning model', 'How do reasoning models think before they answer, and what does that thinking cost?', ['chain of thought'], ['thinking model', 'reasoning tokens', 'thinking budget']),
          ai('test-time compute', 'Why does letting a model think longer make it better at hard problems?', ['reasoning model'], ['inference-time compute']),
        ],
      },
      {
        id: 'context',
        name: 'Context',
        topics: [
          ai('context engineering', "How do you decide what goes into a model's limited context to get its best work?", ['context window', 'system prompt']),
          ai('stateless model', "How does a chatbot 'remember' your conversation when the model itself remembers nothing?", ['system prompt', 'context window'], ['statelessness', 'conversation history', 'multi-turn conversation']),
          ai('lost in the middle', 'Why do models miss facts buried in the middle of a long document?', ['context window']),
          ai('context rot', 'Why does a model get worse the longer a chat goes on?', ['lost in the middle'], ['context degradation']),
          ai('context compaction', 'How do long-running AI sessions summarize their own history to keep going?', ['context rot', 'stateless model']),
          cs('JSON', 'How do programs pass structured information to each other as plain text?', ['data structure']),
          cs('JSON schema', 'How does a program check that the data it received has exactly the right shape?', ['JSON']),
          ai('structured output', 'How do you get a model to answer in data a program can read, every single time?', ['JSON schema', 'instruction following'], ['JSON mode']),
          ai('constrained decoding', 'How can a model be made unable to produce broken JSON at all?', ['structured output', 'decoding strategy'], ['grammar-constrained generation']),
        ],
      },
      {
        id: 'search-and-retrieval',
        name: 'Search and retrieval',
        topics: [
          cs('regular expression', 'How does one short pattern find every email address or phone number in a document?', [], ['regex']),
          cs('edit distance', "How does a spell checker know 'teh' meant 'the'?", ['algorithm'], ['fuzzy matching', 'Levenshtein distance']),
          cs('inverted index', 'How does a search engine find every page with a given word in milliseconds?', ['hash table'], ['search index']),
          cs('keyword search', 'Why do rare words count for more than common ones when a search engine ranks results?', ['inverted index'], ['full-text search', 'BM25', 'TF-IDF']),
          cs('web crawler', 'How does a search engine discover and copy billions of web pages?', ['HTML', 'graph data structure'], ['search engine crawler']),
          cs('PageRank', 'How did the links between pages decide which page shows up first?', ['web crawler']),
          cs('web scraping', 'How does software pull data out of pages built for human eyes, and where is the line?', ['HTML']),
          ai('semantic search', 'How can a search find what you meant even when you used none of the right words?', ['embedding', 'keyword search'], ['vector search', 'embedding model']),
          ai('vector database', 'How do you search millions of documents by meaning instead of by words?', ['semantic search', 'database']),
          ai('approximate nearest neighbor', 'Why do vector searches trade a little accuracy for a lot of speed?', ['vector database', 'k-nearest neighbors'], ['ANN index']),
          cs('knowledge graph', "How do facts stored as connected dots answer questions a table can't?", ['graph data structure', 'database'], ['graph database']),
          ai('RAG', "How does a chatbot answer from your company's documents instead of from memory?", ['semantic search', 'context window'], ['retrieval-augmented generation']),
          ai('chunking', 'Why does how you cut documents into pieces make or break a RAG system?', ['RAG']),
          ai('hybrid search', 'Why do the best search systems combine matching words with matching meaning?', ['semantic search', 'keyword search']),
          ai('reranking', 'How does a second, pickier model reorder search results so the best come first?', ['RAG'], ['reranker']),
          ai('grounding', "How do you keep an AI's answer tied to real sources, and show which ones it used?", ['RAG'], ['source attribution', 'citations']),
          ai('long context vs RAG', 'When should you hand a model the whole document instead of searching it?', ['RAG', 'context window']),
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
          cs('command line', 'Why do programmers still type commands into a plain text window, and what can it do that clicking cannot?', ['operating system'], ['terminal', 'shell']),
          cs('cron job', 'How do computers run tasks on a schedule while nobody is watching?', ['operating system'], ['job scheduler']),
          cs('logging', 'How do engineers work out what a program did after something went wrong?', ['debugging'], ['logs']),
        ],
      },
      {
        id: 'security-basics',
        name: 'Security basics',
        topics: [
          cs('encryption', 'How can a message cross the open internet so that only the right person can read it?', ['binary'], ['end-to-end encryption']),
          cs('public-key cryptography', 'How can two strangers agree on a secret code while everyone is listening?', ['encryption'], ['public key']),
          cs('digital signature', 'How can you prove a file came from who it says and was not changed?', ['public-key cryptography', 'hash function']),
          cs('authentication', 'How does a website check it is really you, without storing your password?', ['hash function'], ['API key', 'password hashing']),
          cs('two-factor authentication', 'Why does a code on your phone stop someone who already stole your password?', ['authentication'], ['2FA', 'multi-factor authentication']),
          cs('OAuth', 'How can an app act on your account without ever seeing your password?', ['authentication', 'API'], ['delegated access']),
          cs('VPN', 'What does a VPN actually hide, and from whom?', ['encryption', 'IP address'], ['virtual private network']),
          cs('permissions', 'Why should every program get only the access its job needs?', ['authentication'], ['access control', 'least privilege']),
          cs('virtual machine', 'How can one physical computer pretend to be many separate ones?', ['operating system'], ['VM']),
          cs('sandbox', 'How do you run code you do not trust without letting it touch anything that matters?', ['permissions', 'virtual machine'], ['sandboxing']),
          cs('SQL injection', 'How can typing a few odd characters into a login box hand over a whole database?', ['SQL'], ['code injection']),
          cs('phishing', 'Why do attackers trick people instead of breaking the encryption?', ['authentication'], ['social engineering']),
        ],
      },
      {
        id: 'tool-use',
        name: 'Tool use',
        topics: [
          ai('tool calling', 'How does a model that can only write text actually use a calculator, a calendar or a database?', ['AI agent', 'API', 'structured output'], ['function calling', 'tool definition', 'tool result']),
          ai('code interpreter', 'Why do chatbots write and run code to answer a math question instead of just answering?', ['tool calling', 'sandbox'], ['code execution']),
          ai('web search tool', 'What actually happens when a chatbot searches the web for you?', ['tool calling', 'keyword search'], ['web browsing']),
          ai('MCP', 'Why does one shared plug standard let any AI app use any tool?', ['tool calling', 'API'], ['Model Context Protocol', 'MCP server']),
        ],
      },
      {
        id: 'agent-loops',
        name: 'Agent loops',
        topics: [
          ai('agent loop', 'How does an agent keep acting and checking its results until a task is done?', ['tool calling'], ['agentic loop', 'stopping condition']),
          ai('ReAct', 'Why does an agent that writes down its reasoning between actions make fewer mistakes?', ['agent loop', 'chain of thought'], ['reason and act']),
          ai('planning', 'How does an agent break a big goal into steps, and adjust when a step fails?', ['agent loop', 'prompt chaining'], ['agent planning']),
          ai('agent memory', 'How does an agent remember things across tasks when the model itself forgets everything?', ['agent loop', 'stateless model', 'vector database'], ['scratchpad', 'long-term memory']),
          ai('workflow vs agent', 'When should you script the steps yourself, and when should the AI choose them?', ['agent loop', 'state machine'], ['agentic workflow']),
          ai('routing', 'How does a system send each request to the model or path best suited to it?', ['workflow vs agent'], ['model router']),
          ai('human-in-the-loop', 'Where should a person step in when AI does real work, and why there?', ['agent loop'], ['HITL', 'autonomy levels', 'levels of autonomy']),
          ai('long-horizon tasks', 'Why do agents that handle five-minute tasks fall apart on five-hour ones?', ['planning']),
          ai('agentic RAG', 'What changes when an agent decides for itself what to search for and when to search again?', ['RAG', 'agent loop']),
          ai('deep research agent', 'How does an AI research a question across dozens of sources and write it up?', ['agentic RAG', 'web search tool'], ['deep research']),
          ai('agent skills', 'How can an agent load expert know-how only when a task calls for it?', ['system prompt', 'tool calling']),
        ],
      },
      {
        id: 'agents-at-the-keyboard',
        name: 'Agents at the keyboard',
        topics: [
          ai('computer use', 'How does an AI click, type and scroll through apps built for people?', ['agent loop', 'multimodal model'], ['browser agent']),
          ai('coding agent', 'How does an AI agent write, run and fix code on its own?', ['agent loop', 'code interpreter', 'version control', 'command line']),
          ai('vibe coding', 'Can you build working software just by describing it, and where does that break down?', ['coding agent']),
          ai('agent harness', 'Why does the software wrapped around a model matter as much as the model itself?', ['agent loop'], ['scaffolding']),
          ai('multi-agent system', 'When does splitting work across several AI agents beat one agent doing it all?', ['agent harness'], ['multi-agent systems', 'subagent', 'orchestrator-worker pattern', 'orchestrator agent']),
        ],
      },
      {
        id: 'keeping-agents-safe',
        name: 'Keeping agents safe',
        topics: [
          ai('guardrails', 'How do you stop an AI system from saying or doing what it should not, without crippling it?', ['tool calling']),
          ai('prompt injection', "Why can't a model reliably tell your instructions from instructions hidden in the text it reads?", ['tool calling', 'system prompt', 'SQL injection'], ['indirect prompt injection']),
          ai('excessive agency', 'Why is giving an AI agent more access than its task needs a security risk?', ['human-in-the-loop', 'permissions'], ['tool permissions', 'approval prompts']),
          ai('agent observability', 'How do you find out why an agent did what it did?', ['agent loop', 'logging'], ['tracing']),
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
          ai('image classification', 'How does an app learn to tell a dog from a muffin from millions of labeled photos?', ['convolutional neural network', 'supervised learning'], ['computer vision']),
          ai('object detection', "How does a camera find and outline every person in a crowded scene, not just say 'people'?", ['image classification'], ['image segmentation']),
          ai('OCR', 'How does software read the text in a photo of a crumpled receipt?', ['image classification'], ['optical character recognition']),
          ai('vision transformer', 'How can a model built for words read an image by cutting it into patches?', ['transformer', 'pixel'], ['ViT', 'image tokens']),
          ai('image-text embedding', 'How does a model learn that a photo and the words describing it mean the same thing?', ['vision transformer', 'embedding'], ['CLIP', 'contrastive learning']),
          ai('vision language model', 'How does a chatbot describe what is in a photo you upload?', ['vision transformer', 'large language model'], ['VLM']),
          ai('document understanding', 'How does AI pull the right numbers out of messy invoices and forms?', ['vision language model', 'OCR']),
        ],
      },
      {
        id: 'speech-and-audio',
        name: 'Speech and audio',
        topics: [
          cs('Fourier transform', 'How can a sound be split into the separate pitches it is made of?', ['digital audio'], ['spectrogram']),
          ai('speech recognition', 'How does your phone turn your voice into text, even in a noisy room?', ['Fourier transform', 'transformer'], ['speech-to-text', 'ASR']),
          ai('text-to-speech', 'How does a computer voice sound human, with pauses and emphasis in the right places?', ['digital audio', 'generative AI'], ['TTS']),
          ai('voice cloning', "How can a few seconds of someone's voice be enough to copy it?", ['text-to-speech']),
          ai('audio tokens', 'How is sound squeezed into tokens a model can read and write?', ['digital audio', 'token'], ['neural audio codec']),
          ai('voice agent', 'Why do some AI voice assistants pause awkwardly while newer ones reply as fast as a person?', ['speech recognition', 'text-to-speech', 'audio tokens'], ['voice AI', 'speech-to-speech model', 'native audio model']),
        ],
      },
      {
        id: 'generating-images-and-video',
        name: 'Generating images and video',
        topics: [
          ai('diffusion model', 'How does AI create an image by starting from pure static and removing noise step by step?', ['generative AI', 'latent space'], ['diffusion']),
          ai('latent diffusion', 'Why do image generators work on a compressed sketch of the image instead of its pixels?', ['diffusion model', 'autoencoder']),
          ai('text-to-image', 'How does a sentence steer the noise removal toward the picture you described?', ['latent diffusion', 'image-text embedding'], ['image generation']),
          ai('classifier-free guidance', 'How does turning up the guidance make an image follow your prompt more closely, and what does it cost?', ['text-to-image'], ['guidance scale']),
          ai('image-to-image', 'How does AI edit just part of a photo and leave the rest untouched?', ['text-to-image'], ['inpainting', 'outpainting']),
          ai('character consistency', 'Why is it so hard for AI to draw the same character twice, and how do tools fix it?', ['text-to-image'], ['consistent characters']),
          cs('video compression', 'How does a two-hour movie fit through a home internet connection?', ['pixel', 'data compression'], ['video codec']),
          cs('3D rendering', 'How does a computer turn a 3D scene into a flat image with realistic light?', ['pixel', 'GPU'], ['ray tracing']),
          ai('diffusion transformer', 'Why did image generators switch to the same transformer design that chatbots use?', ['diffusion model', 'transformer'], ['DiT']),
          ai('text-to-video', 'How does AI keep a generated video consistent from one frame to the next?', ['diffusion transformer', 'video compression'], ['video generation']),
          ai('deepfake', 'How are fake videos of real people made, and how are they caught?', ['voice cloning', 'text-to-video']),
          ai('watermarking', 'How can an invisible mark in an AI image survive cropping and screenshots?', ['deepfake'], ['AI watermark']),
          ai('content provenance', 'How can a photo carry a tamper-proof record of where it came from?', ['watermarking', 'digital signature'], ['C2PA']),
        ],
      },
      {
        id: 'any-to-any-and-the-physical-world',
        name: 'Any-to-any and the physical world',
        topics: [
          ai('native multimodality', 'What changes when one model learns images, sound and text together from the start?', ['multimodal model', 'vision transformer', 'audio tokens'], ['any-to-any model']),
          ai('embodied AI', 'Why is folding laundry harder for AI than passing a written exam?', ['reinforcement learning', 'object detection'], ['robotics AI']),
          ai('vision-language-action model', "How can a robot follow an instruction like 'put the red cup in the sink'?", ['vision language model', 'embodied AI'], ['VLA']),
          ai('autonomous vehicles', 'How does a self-driving car see, predict and decide in a fraction of a second?', ['embodied AI', 'object detection'], ['self-driving cars']),
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
          ai('pre-training data', 'Where does the text a model learns from come from, and is there enough of it?', ['pre-training', 'web scraping'], ['training corpus']),
          ai('data filtering', 'Why do model makers throw away most of the web before training?', ['pre-training data', 'data quality'], ['data curation', 'deduplication']),
          ai('synthetic data', 'Can a model learn from data another AI wrote, and when does that help?', ['pre-training data']),
          ai('model collapse', "What happens when models train on other models' output, generation after generation?", ['synthetic data']),
          ai('distributed training', 'How do thousands of chips train one model together without tripping over each other?', ['pre-training', 'parallel computing'], ['training run', 'checkpoint', 'data parallelism', 'model parallelism']),
          ai('mixed precision training', 'Why does training with less precise numbers barely hurt the model and save a fortune?', ['distributed training', 'floating-point number']),
          ai('compute-optimal training', 'For a fixed budget, should you build a bigger model or feed it more data?', ['scaling laws', 'distributed training'], ['Chinchilla scaling']),
        ],
      },
      {
        id: 'compute-and-hardware',
        name: 'Compute and hardware',
        topics: [
          cs('CUDA', 'How do programmers get thousands of GPU cores working on one problem at once?', ['GPU', 'parallel computing'], ['GPU programming']),
          cs('VRAM', "Why is a GPU's memory, more than its speed, what decides which models it can run?", ['GPU', 'RAM'], ['GPU memory', 'memory bandwidth']),
          cs('TPU', 'Why do companies build chips designed only for the math AI does?', ['GPU', 'matrix'], ['tensor processing unit', 'AI accelerator']),
          cs('FLOPs', 'How do you count how much raw math a computer, or a whole training run, does?', ['floating-point number'], ['floating-point operations']),
          ai('training compute', 'How much computing does it take to train a frontier model, and why does it keep growing?', ['FLOPs', 'distributed training'], ['compute budget']),
          cs('data center', 'What is inside a data center, and why does it need so much power and cooling?', ['cloud computing']),
          ai('GPU cluster', 'How do tens of thousands of GPUs act like one giant computer?', ['data center', 'distributed training'], ['AI supercomputer']),
          ai('AI energy use', 'Where does the electricity behind an AI answer actually go?', ['GPU cluster', 'inference'], ['AI power consumption']),
        ],
      },
      {
        id: 'post-training',
        name: 'Post-training',
        topics: [
          ai('post-training', 'What turns a raw text predictor into a helpful assistant?', ['base model']),
          ai('supervised fine-tuning', 'How do a few thousand example conversations teach a model to act like an assistant?', ['post-training', 'fine-tuning'], ['SFT', 'instruction tuning']),
          ai('RLHF', "How do people's thumbs-up and thumbs-down ratings reshape a model's behavior?", ['post-training', 'reinforcement learning'], ['reinforcement learning from human feedback']),
          ai('reward model', 'How does a model learn to score answers the way people would?', ['RLHF'], ['preference data', 'human preference data']),
          ai('DPO', "How can a model learn from 'this answer beats that one' without a separate scoring model?", ['reward model'], ['direct preference optimization']),
          ai('constitutional AI', 'How can a model be trained to follow a written set of principles, with AI feedback instead of human ratings?', ['RLHF'], ['RLAIF']),
          ai('RL with verifiable rewards', 'How do models get better at math and code by being graded on answers a computer can check?', ['post-training', 'reward signal'], ['RLVR', 'GRPO']),
          ai('safety training', 'How is a model taught to refuse harmful requests without refusing harmless ones?', ['post-training'], ['refusal training', 'refusal', 'over-refusal']),
          ai('catastrophic forgetting', 'Why does teaching a model something new make it forget what it knew?', ['fine-tuning']),
        ],
      },
      {
        id: 'tuning-your-own-model',
        name: 'Tuning your own model',
        topics: [
          ai('LoRA', 'How can you customize a giant model by training only a tiny add-on?', ['fine-tuning', 'matrix'], ['low-rank adaptation', 'parameter-efficient fine-tuning', 'PEFT']),
          ai('distillation', 'How does a small model learn to imitate a big one?', ['fine-tuning'], ['knowledge distillation']),
          ai('model merging', 'How can two fine-tuned models be blended into one that does both jobs?', ['fine-tuning']),
          ai('fine-tuning vs RAG', 'When should you teach a model new behavior, and when should you just hand it the facts?', ['fine-tuning', 'RAG']),
        ],
      },
      {
        id: 'measuring-ai',
        name: 'Measuring AI',
        topics: [
          ai('evals', 'How do you test whether an AI system is actually good at your task?', ['accuracy', 'software testing', 'large language model'], ['AI evaluation', 'golden dataset', 'eval set']),
          cs('statistical significance', 'How do you know a better score is real and not just luck?', ['probability'], ['p-value']),
          ai('benchmark', 'What do AI benchmark scores really measure, and why do they keep hitting the ceiling?', ['evals'], ['benchmark saturation']),
          ai('benchmark contamination', 'How can a model ace a test because the answers leaked into its training data?', ['benchmark', 'data leakage']),
          ai('LLM-as-a-judge', "How can one AI grade another's work, and when can you trust the grade?", ['evals'], ['model grader']),
          ai('error analysis', 'How do you find out what your AI gets wrong most often, so you know what to fix first?', ['evals']),
          ai('regression testing', "How do you make sure improving one prompt doesn't quietly break ten other cases?", ['software testing', 'evals']),
          ai('RAG evaluation', 'How do you check that a RAG answer used the right sources and made nothing up?', ['evals', 'grounding'], ['faithfulness', 'groundedness']),
          ai('agent evaluation', 'How do you test an agent whose path to the answer is different every run?', ['evals', 'agent loop'], ['agent benchmarks']),
          ai('calibration', 'Does a model that says it is 90% sure turn out right 90% of the time?', ['logits', 'evals'], ['model confidence']),
        ],
      },
      {
        id: 'when-models-misbehave',
        name: 'When models misbehave',
        topics: [
          ai('sycophancy', 'Why do chatbots tell you what you want to hear?', ['RLHF']),
          ai('jailbreak', 'How do people trick a model into breaking its own rules?', ['safety training']),
          ai('red-teaming', 'How do teams attack their own AI to find its failures before users do?', ['jailbreak'], ['red teaming']),
          ai('adversarial examples', "How can a tiny change a person can't even see fool an image model completely?", ['image classification'], ['adversarial attack']),
          ai('data poisoning', 'How can a few planted examples in training data give a model a secret trigger?', ['training data'], ['backdoor']),
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
          cs('caching', 'Why does the second time you load something feel instant?', ['RAM', 'latency'], ['cache']),
          cs('load balancing', 'How does a website spread a flood of visitors across many servers so none falls over?', ['client-server model'], ['horizontal scaling', 'autoscaling']),
          cs('message queue', 'How do busy systems take in more work than they can do right now without dropping any?', ['client-server model'], ['job queue']),
          cs('rate limit', 'Why do services cap how often you can call them, and what should your app do when it hits the cap?', ['API'], ['throttling']),
          cs('idempotency', "Why should hitting 'pay' twice still charge you only once?", ['API', 'database transaction']),
          cs('container', 'How does code that runs on one laptop run exactly the same on any server?', ['operating system', 'virtual machine'], ['containerization']),
          cs('serverless', 'How can you run code without owning or managing a single server?', ['cloud computing', 'container'], ['serverless computing']),
          cs('microservices', 'Why do big apps split into dozens of small services that talk to each other?', ['API', 'container'], ['microservice architecture']),
          cs('CDN', "How does a video load fast whether you're in Tokyo or Toronto?", ['caching', 'latency'], ['content delivery network']),
          cs('failover', 'How do big online services stay up when servers break every day?', ['load balancing'], ['redundancy', 'high availability']),
        ],
      },
      {
        id: 'serving-models',
        name: 'Serving models',
        topics: [
          ai('time to first token', 'Why does a chatbot start typing right away when the full answer takes seconds?', ['inference', 'latency', 'next-token prediction'], ['TTFT', 'streaming', 'streaming responses']),
          ai('KV cache', 'Why does a model not redo all its work for every new word it writes?', ['self-attention', 'next-token prediction', 'caching'], ['prefill and decode']),
          ai('continuous batching', "How do AI servers pack many users' requests together without making anyone wait?", ['KV cache', 'load balancing'], ['throughput', 'tokens per second']),
          ai('speculative decoding', 'How can a small fast model make a big model answer faster without changing the answer?', ['next-token prediction', 'latency']),
          ai('quantization', 'How can a model shrink to a quarter of its size and still work almost as well?', ['parameters', 'floating-point number']),
          ai('running locally', 'How can a capable model run on a laptop or phone with no internet?', ['quantization'], ['local LLM', 'on-device AI']),
        ],
      },
      {
        id: 'cost-and-token-economics',
        name: 'Cost and token economics',
        topics: [
          ai('token pricing', 'Why does the answer cost more per token than the question?', ['token', 'inference'], ['API pricing per token', 'input vs output tokens']),
          ai('prompt caching', 'How does reusing the same opening of a prompt make AI calls cheaper and faster?', ['KV cache', 'token pricing'], ['context caching']),
          ai('batch API', 'Why do AI providers charge less if you are willing to wait hours for the answer?', ['token pricing', 'message queue'], ['batch processing']),
          ai('model cascade', 'How do you cut AI costs by trying a cheap model first and escalating only when needed?', ['routing', 'token pricing']),
          ai('cost per task', 'How do you work out what one AI-completed task really costs?', ['token pricing', 'agent loop'], ['AI unit economics']),
        ],
      },
      {
        id: 'open-models-and-the-ecosystem',
        name: 'Open models and the ecosystem',
        topics: [
          ai('open-weight model', 'What can you do with a model you can download that you cannot do with one behind an API?', ['foundation model', 'open source'], ['open weights', 'open vs closed weights', 'closed model', 'proprietary model']),
          ai('model versioning', 'Why can an AI app break when the model behind it gets an update?', ['inference', 'regression testing'], ['model deprecation']),
        ],
      },
      {
        id: 'building-ai-products',
        name: 'Building AI products',
        topics: [
          ai('LLM gateway', 'How do apps keep working when their AI provider goes down or slows to a crawl?', ['routing', 'failover'], ['AI gateway', 'fallback model']),
          ai('PII redaction', "How do you keep customers' personal details out of an AI system's prompts and logs?", ['guardrails', 'logging'], ['data masking']),
          ai('MLOps', 'What does it take to keep an AI system working well after launch?', ['regression testing', 'CI/CD'], ['LLMOps']),
          ai('data drift', 'Why does a model that worked great last year slowly get worse?', ['MLOps'], ['concept drift']),
          ai('data flywheel', 'How does using an AI product produce the data that makes it better?', ['MLOps'], ['feedback loop']),
          cs('A/B test', 'How do you prove a change made things better, not just different?', ['statistical significance', 'feature flag'], ['split test']),
          ai('online evaluation', "How do you measure an AI system's quality on real users after it ships?", ['A/B test', 'evals']),
        ],
      },
      {
        id: 'ai-in-organizations',
        name: 'AI in organizations',
        topics: [
          ai('AI use case', 'How do you spot the tasks in a business where AI will actually pay off?', ['AI agent', 'cost per task']),
          ai('build vs buy', 'When should a company build its own AI tool, and when should it just buy one?', ['AI use case']),
          ai('AI pilot', 'Why do so many AI pilots impress in the demo and never reach real use?', ['AI use case'], ['proof of concept']),
          ai('AI ROI', 'How do you actually get a return from AI, not just an impressive demo?', ['AI pilot', 'cost per task'], ['return on AI investment']),
          ai('data readiness', "How do you get a company's data into shape before AI can use it?", ['data quality', 'data pipeline', 'AI use case'], ['AI-ready data']),
          ai('AI adoption', 'How do you get people to actually use the AI tools a company rolls out?', ['AI pilot'], ['AI change management']),
          ai('AI governance', 'How does a company set rules for AI use without smothering it?', ['AI adoption'], ['AI policy']),
          ai('automation vs augmentation', 'When should AI take a task over, and when should it help a person do it better?', ['AI adoption']),
        ],
      },
      {
        id: 'law-policy-and-society',
        name: 'Law, policy and society',
        topics: [
          ai('data privacy', 'What happens to the personal data you type into an AI, and what rules protect it?', ['training data'], ['GDPR', 'zero data retention', 'data retention policy']),
          ai('AI copyright', 'Can AI legally learn from copyrighted books and art, and who owns what it makes?', ['training data'], ['fair use']),
          ai('algorithmic fairness', "How do you measure whether an AI treats groups of people fairly, and why can't one system meet every definition at once?", ['data bias', 'precision and recall'], ['AI bias']),
          ai('explainable AI', 'How can an AI show why it turned someone down for a loan?', ['decision tree', 'AI governance'], ['XAI']),
          ai('AI regulation', 'How do laws decide which uses of AI need strict rules and which need none?', ['AI governance'], ['risk-based regulation', 'EU AI Act']),
          ai('AI and jobs', 'Why does AI tend to change tasks within jobs before it replaces whole jobs?', ['automation vs augmentation'], ['job displacement']),
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
          ai('AI alignment', 'Why is it hard to make a powerful AI pursue what we actually meant?', ['safety training'], ['alignment']),
          ai('specification gaming', 'Why do AIs find loopholes that meet the letter of a goal and miss its point?', ['reward signal', 'AI alignment'], ['reward hacking']),
          ai('goal misgeneralization', 'How can an AI learn the wrong goal even when it was trained with the right one?', ['overfitting', 'AI alignment']),
          ai('deceptive alignment', "Could a model behave well while it's being tested and differently once it isn't?", ['goal misgeneralization'], ['scheming']),
          ai('scalable oversight', 'How can people supervise an AI on tasks too hard for them to check themselves?', ['AI alignment', 'LLM-as-a-judge']),
          ai('weak-to-strong generalization', 'Can a weaker supervisor train a model that ends up better than the supervisor?', ['scalable oversight']),
          ai('AI control', "How do you stop an AI from causing harm even if you can't be sure its goals are right?", ['AI alignment', 'AI agent']),
          ai('chain-of-thought faithfulness', "Does a model's written reasoning show what actually drove its answer?", ['chain of thought', 'evals'], ['CoT monitoring']),
          ai('dangerous capability evals', 'How do labs test whether a model could help with something truly dangerous?', ['evals', 'red-teaming']),
          ai('sandbagging', 'Could a model deliberately underperform on a test to hide what it can do?', ['dangerous capability evals']),
          ai('responsible scaling policy', 'How do labs decide ahead of time what safety steps a more capable model requires?', ['dangerous capability evals'], ['frontier safety framework']),
          ai('superintelligence', 'What would an AI that outthinks people at nearly everything look like, and why is it so hard to predict?', ['AGI'], ['ASI']),
          ai('existential risk', 'What is the argument that advanced AI could threaten humanity itself, and what is the case against it?', ['superintelligence', 'AI alignment'], ['x-risk']),
        ],
      },
      {
        id: 'interpretability',
        name: 'Interpretability',
        topics: [
          ai('mechanistic interpretability', 'How do researchers open up a neural network to see what it is actually computing?', ['explainable AI', 'transformer'], ['interpretability']),
          ai('saliency map', 'How can you see which pixels an image model looked at to make its call?', ['explainable AI', 'image classification'], ['feature attribution']),
          ai('probing', 'How can a simple test reveal whether a model secretly represents something it never says?', ['mechanistic interpretability'], ['linear probe']),
          ai('circuit', 'How do groups of neurons wire together to do one specific job inside a model?', ['mechanistic interpretability'], ['circuits']),
          ai('induction head', 'How does a model learn to copy a pattern it saw earlier in the same text?', ['circuit', 'multi-head attention']),
          ai('polysemanticity', 'Why does a single neuron inside a model respond to totally unrelated things?', ['mechanistic interpretability', 'artificial neuron']),
          ai('superposition', 'How does a model pack in more ideas than it has neurons?', ['polysemanticity']),
          ai('sparse autoencoder', "How do researchers untangle a model's crowded neurons into readable concepts?", ['superposition', 'autoencoder'], ['SAE']),
          ai('activation steering', "How can nudging a model's internal signals change its behavior without retraining it?", ['sparse autoencoder'], ['steering vectors']),
          ai('logit lens', "Can you read a model's half-formed guess at each layer before it answers?", ['residual stream', 'logits']),
        ],
      },
      {
        id: 'research-frontiers',
        name: 'Research frontiers',
        topics: [
          ai('state space model', "Can a model read a million words without attention's quadratic cost?", ['quadratic attention cost', 'recurrent neural network'], ['SSM']),
          ai('multi-token prediction', 'What changes if a model predicts several tokens at a time instead of one?', ['next-token prediction']),
          ai('diffusion language model', 'Could text be written the way images are generated, all at once out of noise?', ['diffusion model', 'next-token prediction']),
          ai('test-time training', 'What if a model kept learning while it worked on your problem?', ['test-time compute', 'fine-tuning']),
          ai('continual learning', "Why can't today's models keep learning after they ship, the way people do?", ['catastrophic forgetting']),
          ai('grokking', 'Why does a model sometimes suddenly understand a task long after it memorized the answers?', ['overfitting']),
          ai('double descent', 'Why can making a model bigger first hurt, then help again?', ['bias-variance tradeoff']),
          ai('world model', 'Can an AI learn how the physical world works just by watching video?', ['text-to-video', 'reinforcement learning']),
          ai('recursive self-improvement', 'What happens if AI starts doing the research that improves AI?', ['AGI', 'coding agent']),
          ai('compute governance', 'Why do some think controlling AI chips is the most practical way to govern AI?', ['AI regulation', 'GPU cluster']),
        ],
      },
      {
        id: 'limits-of-computing',
        name: 'Limits of computing',
        topics: [
          cs('halting problem', 'Why are there questions about programs that no computer can ever answer?', ['algorithm'], ['undecidability']),
          cs('P vs NP', 'Why can checking an answer be easy when finding it seems impossibly hard?', ['Big O notation'], ['NP-complete']),
          cs('formal verification', 'How can you prove code is correct instead of just testing it?', ['software testing', 'halting problem']),
          cs('quantum computing', 'What makes a quantum computer different, and which problems could it actually solve faster?', ['binary', 'P vs NP'], ['qubit']),
        ],
      },
    ],
  },
];
