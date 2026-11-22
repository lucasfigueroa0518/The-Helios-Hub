# Explainer Reels syllabus (draft 2, for review)

403 topics in 11 levels; 118 are computer science (29%), marked **CS**. Each topic's line after the dash is its *angle*: what the reel answers, which the idea writer must deliver.

Levels group the topics for reading. Reels follow the **teaching order**: AI topics and CS topics each go in level order, woven so about one reel in three is CS (never more than 4 CS in a row), and every topic comes after the ones it builds on.

**The first 30 reels, in teaching order:** Algorithm (CS) · Artificial Intelligence · Rule-Based System · Binary (CS) · Machine Learning · AI Model · Logic Gate (CS) · Model Training · Inference · Neural Network · CPU (CS) · Deep Learning · Generative AI · RAM (CS) · AGI · Large Language Model · Foundation Model · Operating System (CS) · Multimodal Model · Hallucination · GPU (CS) · Knowledge Cutoff · AI Agent · Moore's Law (CS) · Programming Language (CS) · Data Structure (CS) · Structured Data (CS) · Training Data · Feature · Label

Source: `lib/explainers/ideas/syllabus.ts`.

## Level 1: What AI is, and the computer under it (30)

_Know what makes software AI, meet the chatbot, and see what a computer does with ones and zeros underneath it._

**What AI is**

- **Algorithm** · CS: How does a computer solve a problem by following exact steps, and what makes one set of steps better than another?
- **Artificial Intelligence** (also: AI, narrow AI, weak AI): What makes software count as AI, rather than an ordinary program following its instructions?
- **Rule-Based System** (also: expert system): Why did early AI, built from hand-written if-then rules, keep breaking on real life?
- **Machine Learning** (also: ML): How does a computer pick up a skill from examples when nobody writes down the rules?
- **AI Model** (also: model): What is actually stored inside the thing people call an AI model?
- **Model Training** (also: training): What actually happens, step by step, while a model is being trained?
- **Inference** (also: model serving, inference server): Why does getting an answer from a trained model cost a sliver of what training it did?
- **Neural Network**: How does a web of tiny adjustable number-crunchers learn to recognize a face?
- **Deep Learning**: Why did stacking more layers make neural networks suddenly good at photos, speech and language?
- **Generative AI** (also: GenAI): How can a model that learned from millions of examples make something that never existed?
- **AGI** (also: artificial general intelligence): What would AI have to do to count as general intelligence, and why do experts disagree on how close it is?

**Meet the chatbot**

- **Large Language Model** (also: LLM, chatbot): How did a model that only learned to continue text end up able to write, summarize and answer questions?
- **Foundation Model** (also: frontier model): Why can one giant general-purpose model be reused for thousands of different jobs?
- **Multimodal Model** (also: multimodal AI): How can one model look at a photo, read your question about it and answer in words?
- **Hallucination**: Why does a chatbot state made-up facts with total confidence?
- **Knowledge Cutoff** (also: training cutoff): Why doesn't a chatbot know what happened last week unless it can search the web?
- **AI Agent** (also: agent, agentic AI): What changes when an AI can take actions, not just answer?

**How a computer works**

- **Binary** · CS (also: bits and bytes): How can a computer hold a photo, a song and a sentence using nothing but ones and zeros?
- **Logic Gate** · CS (also: transistor): How do billions of tiny on-off switches end up doing arithmetic?
- **CPU** · CS (also: processor): What does a processor actually do billions of times every second?
- **RAM** · CS (also: memory vs storage): Why does a computer forget what was in memory when it shuts off, yet keep your files?
- **Operating System** · CS (also: OS): How does one computer run dozens of apps at once without them trampling each other?
- **GPU** · CS: Why did a chip built for video games become the engine of AI?
- **Moore's Law** · CS: Why did chips get about twice as powerful every couple of years, and why is that slowing down?

**How a computer stores things**

- **Unicode** · CS (also: character encoding): How does a computer turn letters and emoji from every language into numbers?
- **Pixel** · CS (also: digital image): How does a photo become a grid of numbers a computer can edit?
- **Vector Graphics** · CS (also: SVG): Why does a logo stay sharp at any size while a photo turns blocky when you zoom in?
- **Digital Audio** · CS (also: sample rate): How does sound become a long list of numbers, and why does the sample rate matter?
- **Data Compression** · CS (also: lossless compression, lossy compression): How can a file shrink without losing anything, and when does it have to throw detail away?
- **Error-Correcting Code** · CS (also: error correction): How can a scratched disc or a torn QR code still be read perfectly?

## Level 2: Software and the internet (36)

_See how code is written, organized and checked, and how the internet carries it between machines._

**How software is written**

- **Programming Language** · CS: Why are there hundreds of programming languages if every one ends up as the same instructions for the chip?
- **Compiler** · CS (also: interpreter): What happens to code between the moment someone types it and the moment it runs?
- **Debugging** · CS (also: bug): How do programmers track down a bug they can't see?
- **Software Testing** · CS (also: unit test): How do programmers know their code still works after every change?
- **Diff** · CS: How does a computer show exactly what changed between two versions of a file?
- **Version Control** · CS (also: Git): How do dozens of people change the same code at once without overwriting each other?
- **CI/CD** · CS (also: continuous integration, continuous deployment): How do teams ship new code many times a day without breaking things?
- **Feature Flag** · CS: How do apps switch a new feature on for a few users before everyone gets it?
- **Open Source** · CS: Why do companies give away code anyone can copy, and who keeps it maintained?
- **Package Manager** · CS (also: software dependency): How do programmers build on millions of lines of code they never wrote, and what can go wrong?
- **Technical Debt** · CS (also: refactoring): Why does rushed code make every later change slower and more expensive?

**Data structures and algorithms**

- **Data Structure** · CS: Why does the way a program organizes its data decide how fast it runs?
- **Stack** · CS (also: call stack): Why does an app's undo button work like a pile of plates?
- **Tree Data Structure** · CS (also: tree): Why do file folders, family trees and search engines all branch the same way?
- **Graph Data Structure** · CS (also: graph): How do maps, social networks and the web all fit one simple structure of dots and lines?
- **Hash Function** · CS (also: checksum): How can any file be boiled down to a short fingerprint that changes if a single letter does?
- **Hash Table** · CS (also: hash map, dictionary): How does a program find one item among millions almost instantly?
- **Big O Notation** · CS (also: time complexity): Why does a program that is fast on ten items crawl on a million?
- **Sorting Algorithm** · CS (also: sorting): How does a computer put a million things in order, and why are some ways vastly faster than others?
- **Binary Search** · CS: How can you find one name among a billion sorted names in about thirty steps?
- **Recursion** · CS: How can a function solve a problem by handing a smaller copy of it to itself?
- **Shortest Path Algorithm** · CS (also: Dijkstra's algorithm, pathfinding): How does a map app find the fastest route through millions of roads in a second?
- **State Machine** · CS (also: finite state machine): How does a program keep track of where it is in a process with many steps?
- **Concurrency** · CS (also: race condition, deadlock): Why do two things running at the same time cause bugs that vanish when you look for them?

**How the internet works**

- **Packet Switching** · CS (also: TCP/IP, data packet): How does a video cross the world in thousands of pieces and arrive in the right order?
- **IP Address** · CS: How does data find one device among billions on the internet?
- **DNS** · CS (also: domain name system): What actually happens between typing a web address and the site appearing?
- **Latency** · CS (also: bandwidth): Why can a fast internet connection still feel slow?
- **Client-Server Model** · CS (also: client and server): What does each side do when an app on your phone talks to a server?
- **HTTP** · CS (also: HTTPS): What does your browser actually say to a website when it asks for a page?
- **HTML** · CS (also: web page): How does a page of plain text and tags become the website you see?
- **Cookie** · CS (also: browser cookie): How does a website remember who you are between visits?
- **Frontend vs Backend** · CS (also: frontend, backend): What's the difference between the part of an app you see and the part you don't?
- **Cloud Computing** · CS (also: the cloud): Why do companies rent computers they never see instead of buying their own?
- **API** · CS (also: application programming interface, REST API): How do two programs built by strangers manage to work together?
- **Webhook** · CS: How does one app tell another the moment something happens, without being asked?

## Level 3: Data and classic machine learning (44)

_Understand how data is stored and how machines learn patterns from examples, and tell whether they learned the right ones, before neural networks._

**Storing data**

- **Structured Data** · CS (also: tabular data, unstructured data): Why is a spreadsheet easy for software to use, while a pile of emails and photos is hard?
- **Database** · CS (also: relational database): How does a database keep millions of records safe and findable while many people change them at once?
- **SQL** · CS: How do you ask a database a question, and why can one short query replace a whole program?
- **Database Index** · CS: Why can the same database lookup take minutes without an index and milliseconds with one?
- **Database Transaction** · CS (also: ACID): How does a bank transfer never take money out of one account without putting it in the other?
- **Data Warehouse** · CS (also: data lake): Why do companies copy their data into a separate place just for analysis?
- **Data Pipeline** · CS (also: ETL): How does raw data from many systems get cleaned and moved to where it is needed?

**Math you need**

- **Probability** · CS: How do you put a number on how likely something is, and why does AI run on it?
- **Bayes' Theorem** · CS: How should one new piece of evidence change what you believe?
- **Vector** · CS: How can a plain list of numbers stand for a point, a direction or even an idea?
- **Matrix** · CS (also: matrix multiplication): Why is multiplying grids of numbers the most common job a computer does in AI?
- **Derivative** · CS (also: slope, gradient): How does knowing the slope at one spot tell you which way is downhill?

**Data for learning**

- **Training Data** (also: dataset): Why does what a model learns depend more on its examples than on its code?
- **Feature** (also: feature engineering): How do you decide which facts about an example a model should pay attention to?
- **Label** (also: ground truth, data labeling): Where do the right answers a model learns from come from, and who writes them?
- **Data Quality** (also: garbage in, garbage out): Why does a model trained on messy data confidently learn the mess?
- **Train/test Split** (also: test set, holdout set): Why do you hide some of your data from a model to find out whether it really learned?
- **Data Leakage**: How can a model ace its test and then fail on day one?
- **Data Bias** (also: sampling bias): How does a model end up unfair when nobody told it to be?

**How machines learn**

- **Supervised Learning**: How does a model learn from examples that come with the right answers attached?
- **Unsupervised Learning** (also: clustering, k-means): What can a model find in data when nobody gives it any answers?
- **Self-Supervised Learning**: How does a model make its own practice questions out of raw data?
- **Reinforcement Learning** (also: RL): How does a program learn to win a game nobody taught it, from wins and losses alone?
- **Classification** (also: classifier): How does a model decide which category a new example belongs in?
- **Loss Function** (also: cost function): How does a model measure how wrong it is, and why does that one number steer all its learning?
- **Parameters** (also: weights, model weights): What are the billions of numbers inside a model, and what does changing one of them do?
- **Gradient Descent**: How does a model find better settings by feeling its way downhill, one small step at a time?
- **Learning Rate**: Why does a model that learns too fast never settle, and one that learns too slowly never arrives?
- **Overfitting** (also: generalization, memorization): Why can a model that memorized its training examples fail on new ones?
- **Bias-Variance Tradeoff** (also: underfitting): Why does making a model simpler sometimes make it better?
- **Regularization**: How do you stop a model from memorizing when you want it to learn?
- **Hyperparameter** (also: hyperparameter tuning): Which settings does a person choose before training starts, and how do you find good ones?

**Classic models**

- **Linear Regression** (also: regression): How does fitting a straight line through points let a model predict a number like a price?
- **Logistic Regression**: How does a model turn a score into a yes-or-no probability?
- **Decision Tree**: How does a model learn a flowchart of yes-or-no questions from data?
- **Random Forest** (also: ensemble learning): Why do hundreds of so-so decision trees voting together beat one good one?
- **Gradient Boosting** (also: boosted trees): How does each new tree in a boosted model fix the mistakes of the ones before it?
- **K-Nearest Neighbors** (also: KNN): How can a model classify something just by checking its closest look-alikes?
- **Recommendation System** (also: collaborative filtering): How does a streaming app guess what you will like from what people like you watched?
- **Time Series Forecasting** (also: forecasting): How does a model predict next month from the shape of the past, and when does that break?
- **Anomaly Detection** (also: outlier detection): How does software spot the one fraudulent charge among millions of normal ones?

**Measuring a model**

- **Accuracy** (also: class imbalance): How can a model be 99% accurate and still useless?
- **Confusion Matrix** (also: false positive, false negative): How do you see exactly which mistakes a model makes, not just how many?
- **Precision and Recall** (also: F1 score): Why does catching more fraud always mean flagging more innocent people too?

## Level 4: Neural networks and deep learning (30)

_See how a neural network learns, the numbers and chips it runs on, and the architectures that came before transformers._

**Numbers and parallel chips**

- **Floating-Point Number** · CS (also: floating point): How does a computer store a number like 0.1 in a fixed number of bits, and why is it slightly off?
- **Tensor** · CS: Why does AI code describe everything, from photos to sentences, as stacks of numbers called tensors?
- **Parallel Computing** · CS: Why does splitting a job across thousands of small cores beat one fast core for some work and not others?
- **Random Number Generator** · CS (also: pseudorandom number, random seed): How does a computer that follows exact steps produce random numbers?
- **Monte Carlo Method** · CS: How can thousands of random guesses solve a problem too hard to calculate exactly?

**Inside a neural network**

- **Artificial Neuron** (also: perceptron): What does a single artificial neuron compute, and how loosely is it like a brain cell?
- **Activation Function** (also: ReLU): Why does each neuron need a little bend in its output for a network to learn anything interesting?
- **Feedforward Network** (also: multilayer perceptron, MLP, hidden layer, forward pass): How do layers of neurons pass a signal forward and turn raw input into an answer?
- **Backpropagation** (also: backprop): How does a network work out which of its millions of weights caused a mistake?
- **Vanishing Gradient**: Why did deep networks stop learning in their early layers, and what fixed it?
- **Batch Size** (also: mini-batch, epoch): Why does a model learn from small batches of examples rather than one at a time or all at once?
- **Dropout**: Why does randomly switching off neurons during training make a network better?
- **Softmax**: How does a network turn raw scores into probabilities that add up to one?
- **Cross-Entropy Loss**: Why does a confident wrong answer cost a model far more than a hesitant one?

**Architectures before transformers**

- **Convolutional Neural Network** (also: CNN): How does a network spot an edge, then an eye, then a face by sliding small filters across a picture?
- **Recurrent Neural Network** (also: RNN): How does a network read a sentence one word at a time and carry a memory along?
- **LSTM** (also: long short-term memory): How did adding gates that decide what to keep and what to forget let networks remember across long sentences?
- **Residual Connection** (also: skip connection): How do shortcuts that skip layers let networks grow hundreds of layers deep?
- **Autoencoder** (also: variational autoencoder, VAE): What does a network learn when it is trained to squeeze data down and rebuild it?
- **Latent Space**: How can a model arrange everything it learned so that similar things sit close together?
- **GAN** (also: generative adversarial network): How do two networks, one forging and one detecting, push each other to make realistic images?

**Learning by reward**

- **Reward Signal** (also: reward): How does a single score for doing well end up shaping complex behavior?
- **Policy**: How does a learning agent turn what it sees into what it does next?
- **Exploration vs Exploitation**: When should a learner try something new instead of repeating what already works?
- **Game Tree Search** · CS (also: minimax, Monte Carlo tree search): How does a chess program look ahead millions of moves without checking every one?
- **Deep Reinforcement Learning** (also: deep RL): How did adding neural networks let reward-based learning handle games far too big to map out?
- **Self-Play**: How can an AI become a world-class player by playing millions of games against itself?

**Reusing what a model learned**

- **Data Augmentation**: How does flipping, cropping and tweaking the same examples teach a model more?
- **Transfer Learning** (also: pretrained model): Why can a model trained on one task learn a related one from far fewer examples?
- **Fine-Tuning**: How do you take a model that already knows a lot and specialize it for your job?

## Level 5: Inside large language models (30)

_Understand how an LLM turns text into tokens, vectors and attention, and writes its answer one token at a time._

**Tokens and embeddings**

- **Token** (also: token count, tokens per word): Why does a language model read text in chunks that aren't quite words?
- **Tokenizer** (also: tokenization, vocabulary, byte-pair encoding, BPE): How does a model decide where to cut text into tokens, and why does that trip it up on spelling and math?
- **Embedding** (also: vector embedding, embedding space, vector space): How can a list of numbers capture what a word means?
- **Semantic Similarity** (also: cosine similarity): How does a model tell that 'car' and 'automobile' mean the same thing without a dictionary?
- **Positional Encoding** (also: position embedding, RoPE): How does a model keep track of word order when it reads every word at once?

**Attention and the transformer**

- **Attention Mechanism** (also: attention): How does a model decide which earlier words matter most for the next one?
- **Self-Attention**: How does every word in a sentence look at every other word to work out what it means?
- **Query Key Value** (also: QKV): How does attention match what one word is looking for with what the other words offer?
- **Multi-Head Attention** (also: attention head): Why does a model run many attention patterns side by side instead of one?
- **Causal Masking** (also: causal attention): How is a model stopped from peeking at the words it is supposed to predict?
- **Transformer** (also: transformer architecture, transformer block, transformer layer): What made the transformer design beat everything before it at language?
- **Residual Stream**: How do the layers of a transformer share one running notepad of meaning?
- **Encoder vs Decoder** (also: decoder-only model, encoder-only model): Why are some transformers built to understand text and others built to write it?
- **Mixture of Experts** (also: MoE): How can a huge model answer quickly by waking up only a few of its parts for each word?

**How the answer comes out**

- **Markov Chain** · CS (also: n-gram model): How can simply counting which word tends to follow which produce text that almost makes sense?
- **Next-Token Prediction** (also: autoregressive generation, autoregressive model): How does predicting just one next token, over and over, add up to a whole essay?
- **Logits** (also: token probabilities, logprobs, log probabilities): What does a model's ranked list of candidate next tokens look like before it picks one?
- **Decoding Strategy** (also: sampling, greedy decoding): Why doesn't a model always pick its single most likely next word?
- **Temperature**: What does turning a model's temperature up or down actually change?
- **Top-P Sampling** (also: nucleus sampling, top-k sampling): How does a model stay creative without wandering into nonsense?
- **Nondeterminism** (also: why answers vary): Why can the same question get a different answer every time you ask?
- **Perplexity**: How do researchers measure how surprised a model is by real text?

**Size and scale**

- **Parameter Count** (also: model size): Does a model with more parameters actually know more, and what does the extra size cost?
- **Context Window** (also: context length): How much can a model hold in mind at once, and what happens to what falls out?
- **Quadratic Attention Cost**: Why does doubling the text a model reads make attention about four times the work?
- **Pre-Training** (also: pretraining): What does a model actually learn from reading trillions of words with no teacher?
- **Base Model** (also: instruction-tuned model, chat model, instruct model): Why does a freshly pretrained model continue your question instead of answering it?
- **Scaling Laws**: Why does a model improve so predictably as you add data, size and compute?
- **Emergent Abilities** (also: emergence): Why do some skills seem to switch on suddenly as models grow, and is that real?
- **Small Language Model** (also: SLM): How can a small model beat a giant one at a narrow job?

## Level 6: Prompting, context and retrieval (40)

_Get reliable work out of a model by shaping its prompt, its context and the knowledge it can look up, and see how search finds that knowledge._

**Prompting**

- **Prompt Engineering** (also: prompt, prompting): How do you write a prompt that gets the answer you actually wanted?
- **System Prompt** (also: system message, chat roles, message roles): How do hidden instructions shape every answer a chatbot gives?
- **In-Context Learning** (also: zero-shot prompting): How does a model pick up a new task from your message alone, with no retraining?
- **Few-Shot Prompting** (also: few-shot examples): Why do a couple of worked examples in a prompt beat a paragraph of instructions?
- **Role Prompting** (also: persona prompt): Does telling a model 'you are an expert' actually help, and when?
- **Prompt Structure** (also: delimiters, XML tags): Why does splitting a prompt into clearly labeled sections make answers more reliable?
- **Instruction Following**: Why does a model sometimes ignore half of what you asked, and how do you stop it?
- **Prompt Sensitivity** (also: prompt brittleness): Why can rewording a question slightly change the answer completely?
- **Prompt Chaining** (also: task decomposition): Why do several small prompts in a row beat one giant prompt?

**Thinking before answering**

- **Chain of Thought** (also: CoT): Why does asking a model to show its work make it more accurate?
- **Self-Critique** (also: self-reflection): Can a model catch its own mistakes by reviewing its answer, and when does that fail?
- **Self-Consistency**: Why does asking the same question several times and taking the most common answer work?
- **Reasoning Model** (also: thinking model, reasoning tokens, thinking budget): How do reasoning models think before they answer, and what does that thinking cost?
- **Test-Time Compute** (also: inference-time compute): Why does letting a model think longer make it better at hard problems?

**Context**

- **Context Engineering**: How do you decide what goes into a model's limited context to get its best work?
- **Stateless Model** (also: statelessness, conversation history, multi-turn conversation): How does a chatbot 'remember' your conversation when the model itself remembers nothing?
- **Lost in the Middle**: Why do models miss facts buried in the middle of a long document?
- **Context Rot** (also: context degradation): Why does a model get worse the longer a chat goes on?
- **Context Compaction**: How do long-running AI sessions summarize their own history to keep going?
- **JSON** · CS: How do programs pass structured information to each other as plain text?
- **JSON Schema** · CS: How does a program check that the data it received has exactly the right shape?
- **Structured Output** (also: JSON mode): How do you get a model to answer in data a program can read, every single time?
- **Constrained Decoding** (also: grammar-constrained generation): How can a model be made unable to produce broken JSON at all?

**Search and retrieval**

- **Regular Expression** · CS (also: regex): How does one short pattern find every email address or phone number in a document?
- **Edit Distance** · CS (also: fuzzy matching, Levenshtein distance): How does a spell checker know 'teh' meant 'the'?
- **Inverted Index** · CS (also: search index): How does a search engine find every page with a given word in milliseconds?
- **Keyword Search** · CS (also: full-text search, BM25, TF-IDF): Why do rare words count for more than common ones when a search engine ranks results?
- **Web Crawler** · CS (also: search engine crawler): How does a search engine discover and copy billions of web pages?
- **PageRank** · CS: How did the links between pages decide which page shows up first?
- **Web Scraping** · CS: How does software pull data out of pages built for human eyes, and where is the line?
- **Semantic Search** (also: vector search, embedding model): How can a search find what you meant even when you used none of the right words?
- **Vector Database**: How do you search millions of documents by meaning instead of by words?
- **Approximate Nearest Neighbor** (also: ANN index): Why do vector searches trade a little accuracy for a lot of speed?
- **Knowledge Graph** · CS (also: graph database): How do facts stored as connected dots answer questions a table can't?
- **RAG** (also: retrieval-augmented generation): How does a chatbot answer from your company's documents instead of from memory?
- **Chunking**: Why does how you cut documents into pieces make or break a RAG system?
- **Hybrid Search**: Why do the best search systems combine matching words with matching meaning?
- **Reranking** (also: reranker): How does a second, pickier model reorder search results so the best come first?
- **Grounding** (also: source attribution, citations): How do you keep an AI's answer tied to real sources, and show which ones it used?
- **Long Context vs RAG**: When should you hand a model the whole document instead of searching it?

## Level 7: Agents and tools (39)

_Understand how models take actions: calling tools, running in loops, using computers and working with other agents, and the security that keeps them safe._

**Software an agent touches**

- **Command Line** · CS (also: terminal, shell): Why do programmers still type commands into a plain text window, and what can it do that clicking cannot?
- **Cron Job** · CS (also: job scheduler): How do computers run tasks on a schedule while nobody is watching?
- **Logging** · CS (also: logs): How do engineers work out what a program did after something went wrong?

**Security basics**

- **Encryption** · CS (also: end-to-end encryption): How can a message cross the open internet so that only the right person can read it?
- **Public-Key Cryptography** · CS (also: public key): How can two strangers agree on a secret code while everyone is listening?
- **Digital Signature** · CS: How can you prove a file came from who it says and was not changed?
- **Authentication** · CS (also: API key, password hashing): How does a website check it is really you, without storing your password?
- **Two-Factor Authentication** · CS (also: 2FA, multi-factor authentication): Why does a code on your phone stop someone who already stole your password?
- **OAuth** · CS (also: delegated access): How can an app act on your account without ever seeing your password?
- **VPN** · CS (also: virtual private network): What does a VPN actually hide, and from whom?
- **Permissions** · CS (also: access control, least privilege): Why should every program get only the access its job needs?
- **Virtual Machine** · CS (also: VM): How can one physical computer pretend to be many separate ones?
- **Sandbox** · CS (also: sandboxing): How do you run code you do not trust without letting it touch anything that matters?
- **SQL Injection** · CS (also: code injection): How can typing a few odd characters into a login box hand over a whole database?
- **Phishing** · CS (also: social engineering): Why do attackers trick people instead of breaking the encryption?

**Tool use**

- **Tool Calling** (also: function calling, tool definition, tool result): How does a model that can only write text actually use a calculator, a calendar or a database?
- **Code Interpreter** (also: code execution): Why do chatbots write and run code to answer a math question instead of just answering?
- **Web Search Tool** (also: web browsing): What actually happens when a chatbot searches the web for you?
- **MCP** (also: Model Context Protocol, MCP server): Why does one shared plug standard let any AI app use any tool?

**Agent loops**

- **Agent Loop** (also: agentic loop, stopping condition): How does an agent keep acting and checking its results until a task is done?
- **ReAct** (also: reason and act): Why does an agent that writes down its reasoning between actions make fewer mistakes?
- **Planning** (also: agent planning): How does an agent break a big goal into steps, and adjust when a step fails?
- **Agent Memory** (also: scratchpad, long-term memory): How does an agent remember things across tasks when the model itself forgets everything?
- **Workflow vs Agent** (also: agentic workflow): When should you script the steps yourself, and when should the AI choose them?
- **Routing** (also: model router): How does a system send each request to the model or path best suited to it?
- **Human-in-the-Loop** (also: HITL, autonomy levels, levels of autonomy): Where should a person step in when AI does real work, and why there?
- **Long-Horizon Tasks**: Why do agents that handle five-minute tasks fall apart on five-hour ones?
- **Agentic RAG**: What changes when an agent decides for itself what to search for and when to search again?
- **Deep Research Agent** (also: deep research): How does an AI research a question across dozens of sources and write it up?
- **Agent Skills**: How can an agent load expert know-how only when a task calls for it?

**Agents at the keyboard**

- **Computer Use** (also: browser agent): How does an AI click, type and scroll through apps built for people?
- **Coding Agent**: How does an AI agent write, run and fix code on its own?
- **Vibe Coding**: Can you build working software just by describing it, and where does that break down?
- **Agent Harness** (also: scaffolding): Why does the software wrapped around a model matter as much as the model itself?
- **Multi-Agent System** (also: multi-agent systems, subagent, orchestrator-worker pattern, orchestrator agent): When does splitting work across several AI agents beat one agent doing it all?

**Keeping agents safe**

- **Guardrails**: How do you stop an AI system from saying or doing what it should not, without crippling it?
- **Prompt Injection** (also: indirect prompt injection): Why can't a model reliably tell your instructions from instructions hidden in the text it reads?
- **Excessive Agency** (also: tool permissions, approval prompts): Why is giving an AI agent more access than its task needs a security risk?
- **Agent Observability** (also: tracing): How do you find out why an agent did what it did?

## Level 8: Seeing, hearing and creating (30)

_Learn how AI reads images and sound, and how it generates pictures, voices and video._

**Vision**

- **Image Classification** (also: computer vision): How does an app learn to tell a dog from a muffin from millions of labeled photos?
- **Object Detection** (also: image segmentation): How does a camera find and outline every person in a crowded scene, not just say 'people'?
- **OCR** (also: optical character recognition): How does software read the text in a photo of a crumpled receipt?
- **Vision Transformer** (also: ViT, image tokens): How can a model built for words read an image by cutting it into patches?
- **Image-Text Embedding** (also: CLIP, contrastive learning): How does a model learn that a photo and the words describing it mean the same thing?
- **Vision Language Model** (also: VLM): How does a chatbot describe what is in a photo you upload?
- **Document Understanding**: How does AI pull the right numbers out of messy invoices and forms?

**Speech and audio**

- **Fourier Transform** · CS (also: spectrogram): How can a sound be split into the separate pitches it is made of?
- **Speech Recognition** (also: speech-to-text, ASR): How does your phone turn your voice into text, even in a noisy room?
- **Text-to-Speech** (also: TTS): How does a computer voice sound human, with pauses and emphasis in the right places?
- **Voice Cloning**: How can a few seconds of someone's voice be enough to copy it?
- **Audio Tokens** (also: neural audio codec): How is sound squeezed into tokens a model can read and write?
- **Voice Agent** (also: voice AI, speech-to-speech model, native audio model): Why do some AI voice assistants pause awkwardly while newer ones reply as fast as a person?

**Generating images and video**

- **Diffusion Model** (also: diffusion): How does AI create an image by starting from pure static and removing noise step by step?
- **Latent Diffusion**: Why do image generators work on a compressed sketch of the image instead of its pixels?
- **Text-to-Image** (also: image generation): How does a sentence steer the noise removal toward the picture you described?
- **Classifier-Free Guidance** (also: guidance scale): How does turning up the guidance make an image follow your prompt more closely, and what does it cost?
- **Image-to-Image** (also: inpainting, outpainting): How does AI edit just part of a photo and leave the rest untouched?
- **Character Consistency** (also: consistent characters): Why is it so hard for AI to draw the same character twice, and how do tools fix it?
- **Video Compression** · CS (also: video codec): How does a two-hour movie fit through a home internet connection?
- **3D Rendering** · CS (also: ray tracing): How does a computer turn a 3D scene into a flat image with realistic light?
- **Diffusion Transformer** (also: DiT): Why did image generators switch to the same transformer design that chatbots use?
- **Text-to-Video** (also: video generation): How does AI keep a generated video consistent from one frame to the next?
- **Deepfake**: How are fake videos of real people made, and how are they caught?
- **Watermarking** (also: AI watermark): How can an invisible mark in an AI image survive cropping and screenshots?
- **Content Provenance** (also: C2PA): How can a photo carry a tamper-proof record of where it came from?

**Any-to-any and the physical world**

- **Native Multimodality** (also: any-to-any model): What changes when one model learns images, sound and text together from the start?
- **Embodied AI** (also: robotics AI): Why is folding laundry harder for AI than passing a written exam?
- **Vision-Language-Action Model** (also: VLA): How can a robot follow an instruction like 'put the red cup in the sink'?
- **Autonomous Vehicles** (also: self-driving cars): How does a self-driving car see, predict and decide in a fraction of a second?

## Level 9: Training, hardware and evaluation (43)

_Know how LLMs are trained and shaped after pre-training, the hardware that trains them, and how to measure whether a model or an AI system is any good._

**Pre-training at scale**

- **Pre-Training Data** (also: training corpus): Where does the text a model learns from come from, and is there enough of it?
- **Data Filtering** (also: data curation, deduplication): Why do model makers throw away most of the web before training?
- **Synthetic Data**: Can a model learn from data another AI wrote, and when does that help?
- **Model Collapse**: What happens when models train on other models' output, generation after generation?
- **Distributed Training** (also: training run, checkpoint, data parallelism, model parallelism): How do thousands of chips train one model together without tripping over each other?
- **Mixed Precision Training**: Why does training with less precise numbers barely hurt the model and save a fortune?
- **Compute-Optimal Training** (also: Chinchilla scaling): For a fixed budget, should you build a bigger model or feed it more data?

**Compute and hardware**

- **CUDA** · CS (also: GPU programming): How do programmers get thousands of GPU cores working on one problem at once?
- **VRAM** · CS (also: GPU memory, memory bandwidth): Why is a GPU's memory, more than its speed, what decides which models it can run?
- **TPU** · CS (also: tensor processing unit, AI accelerator): Why do companies build chips designed only for the math AI does?
- **FLOPs** · CS (also: floating-point operations): How do you count how much raw math a computer, or a whole training run, does?
- **Training Compute** (also: compute budget): How much computing does it take to train a frontier model, and why does it keep growing?
- **Data Center** · CS: What is inside a data center, and why does it need so much power and cooling?
- **GPU Cluster** (also: AI supercomputer): How do tens of thousands of GPUs act like one giant computer?
- **AI Energy Use** (also: AI power consumption): Where does the electricity behind an AI answer actually go?

**Post-training**

- **Post-Training**: What turns a raw text predictor into a helpful assistant?
- **Supervised Fine-Tuning** (also: SFT, instruction tuning): How do a few thousand example conversations teach a model to act like an assistant?
- **RLHF** (also: reinforcement learning from human feedback): How do people's thumbs-up and thumbs-down ratings reshape a model's behavior?
- **Reward Model** (also: preference data, human preference data): How does a model learn to score answers the way people would?
- **DPO** (also: direct preference optimization): How can a model learn from 'this answer beats that one' without a separate scoring model?
- **Constitutional AI** (also: RLAIF): How can a model be trained to follow a written set of principles, with AI feedback instead of human ratings?
- **RL With Verifiable Rewards** (also: RLVR, GRPO): How do models get better at math and code by being graded on answers a computer can check?
- **Safety Training** (also: refusal training, refusal, over-refusal): How is a model taught to refuse harmful requests without refusing harmless ones?
- **Catastrophic Forgetting**: Why does teaching a model something new make it forget what it knew?

**Tuning your own model**

- **LoRA** (also: low-rank adaptation, parameter-efficient fine-tuning, PEFT): How can you customize a giant model by training only a tiny add-on?
- **Distillation** (also: knowledge distillation): How does a small model learn to imitate a big one?
- **Model Merging**: How can two fine-tuned models be blended into one that does both jobs?
- **Fine-Tuning vs RAG**: When should you teach a model new behavior, and when should you just hand it the facts?

**Measuring AI**

- **Evals** (also: AI evaluation, golden dataset, eval set): How do you test whether an AI system is actually good at your task?
- **Statistical Significance** · CS (also: p-value): How do you know a better score is real and not just luck?
- **Benchmark** (also: benchmark saturation): What do AI benchmark scores really measure, and why do they keep hitting the ceiling?
- **Benchmark Contamination**: How can a model ace a test because the answers leaked into its training data?
- **LLM-as-a-Judge** (also: model grader): How can one AI grade another's work, and when can you trust the grade?
- **Error Analysis**: How do you find out what your AI gets wrong most often, so you know what to fix first?
- **Regression Testing**: How do you make sure improving one prompt doesn't quietly break ten other cases?
- **RAG Evaluation** (also: faithfulness, groundedness): How do you check that a RAG answer used the right sources and made nothing up?
- **Agent Evaluation** (also: agent benchmarks): How do you test an agent whose path to the answer is different every run?
- **Calibration** (also: model confidence): Does a model that says it is 90% sure turn out right 90% of the time?

**When models misbehave**

- **Sycophancy**: Why do chatbots tell you what you want to hear?
- **Jailbreak**: How do people trick a model into breaking its own rules?
- **Red-Teaming** (also: red teaming): How do teams attack their own AI to find its failures before users do?
- **Adversarial Examples** (also: adversarial attack): How can a tiny change a person can't even see fool an image model completely?
- **Data Poisoning** (also: backdoor): How can a few planted examples in training data give a model a secret trigger?

## Level 10: Running and building with AI (44)

_Run models fast and cheaply on reliable infrastructure, build products on them, and roll AI out in a business within the law._

**Running software at scale**

- **Caching** · CS (also: cache): Why does the second time you load something feel instant?
- **Load Balancing** · CS (also: horizontal scaling, autoscaling): How does a website spread a flood of visitors across many servers so none falls over?
- **Message Queue** · CS (also: job queue): How do busy systems take in more work than they can do right now without dropping any?
- **Rate Limit** · CS (also: throttling): Why do services cap how often you can call them, and what should your app do when it hits the cap?
- **Idempotency** · CS: Why should hitting 'pay' twice still charge you only once?
- **Container** · CS (also: containerization): How does code that runs on one laptop run exactly the same on any server?
- **Serverless** · CS (also: serverless computing): How can you run code without owning or managing a single server?
- **Microservices** · CS (also: microservice architecture): Why do big apps split into dozens of small services that talk to each other?
- **CDN** · CS (also: content delivery network): How does a video load fast whether you're in Tokyo or Toronto?
- **Failover** · CS (also: redundancy, high availability): How do big online services stay up when servers break every day?

**Serving models**

- **Time to First Token** (also: TTFT, streaming, streaming responses): Why does a chatbot start typing right away when the full answer takes seconds?
- **KV Cache** (also: prefill and decode): Why does a model not redo all its work for every new word it writes?
- **Continuous Batching** (also: throughput, tokens per second): How do AI servers pack many users' requests together without making anyone wait?
- **Speculative Decoding**: How can a small fast model make a big model answer faster without changing the answer?
- **Quantization**: How can a model shrink to a quarter of its size and still work almost as well?
- **Running Locally** (also: local LLM, on-device AI): How can a capable model run on a laptop or phone with no internet?

**Cost and token economics**

- **Token Pricing** (also: API pricing per token, input vs output tokens): Why does the answer cost more per token than the question?
- **Prompt Caching** (also: context caching): How does reusing the same opening of a prompt make AI calls cheaper and faster?
- **Batch API** (also: batch processing): Why do AI providers charge less if you are willing to wait hours for the answer?
- **Model Cascade**: How do you cut AI costs by trying a cheap model first and escalating only when needed?
- **Cost per Task** (also: AI unit economics): How do you work out what one AI-completed task really costs?

**Open models and the ecosystem**

- **Open-Weight Model** (also: open weights, open vs closed weights, closed model, proprietary model): What can you do with a model you can download that you cannot do with one behind an API?
- **Model Versioning** (also: model deprecation): Why can an AI app break when the model behind it gets an update?

**Building AI products**

- **LLM Gateway** (also: AI gateway, fallback model): How do apps keep working when their AI provider goes down or slows to a crawl?
- **PII Redaction** (also: data masking): How do you keep customers' personal details out of an AI system's prompts and logs?
- **MLOps** (also: LLMOps): What does it take to keep an AI system working well after launch?
- **Data Drift** (also: concept drift): Why does a model that worked great last year slowly get worse?
- **Data Flywheel** (also: feedback loop): How does using an AI product produce the data that makes it better?
- **A/B Test** · CS (also: split test): How do you prove a change made things better, not just different?
- **Online Evaluation**: How do you measure an AI system's quality on real users after it ships?

**AI in organizations**

- **AI Use Case**: How do you spot the tasks in a business where AI will actually pay off?
- **Build vs Buy**: When should a company build its own AI tool, and when should it just buy one?
- **AI Pilot** (also: proof of concept): Why do so many AI pilots impress in the demo and never reach real use?
- **AI ROI** (also: return on AI investment): How do you actually get a return from AI, not just an impressive demo?
- **Data Readiness** (also: AI-ready data): How do you get a company's data into shape before AI can use it?
- **AI Adoption** (also: AI change management): How do you get people to actually use the AI tools a company rolls out?
- **AI Governance** (also: AI policy): How does a company set rules for AI use without smothering it?
- **Automation vs Augmentation**: When should AI take a task over, and when should it help a person do it better?

**Law, policy and society**

- **Data Privacy** (also: GDPR, zero data retention, data retention policy): What happens to the personal data you type into an AI, and what rules protect it?
- **AI Copyright** (also: fair use): Can AI legally learn from copyrighted books and art, and who owns what it makes?
- **Algorithmic Fairness** (also: AI bias): How do you measure whether an AI treats groups of people fairly, and why can't one system meet every definition at once?
- **Explainable AI** (also: XAI): How can an AI show why it turned someone down for a loan?
- **AI Regulation** (also: risk-based regulation, EU AI Act): How do laws decide which uses of AI need strict rules and which need none?
- **AI and Jobs** (also: job displacement): Why does AI tend to change tasks within jobs before it replaces whole jobs?

## Level 11: The frontier (37)

_Reach expert depth: aligning powerful models, looking inside them, the open research questions, and the limits of computing itself._

**Alignment**

- **AI Alignment** (also: alignment): Why is it hard to make a powerful AI pursue what we actually meant?
- **Specification Gaming** (also: reward hacking): Why do AIs find loopholes that meet the letter of a goal and miss its point?
- **Goal Misgeneralization**: How can an AI learn the wrong goal even when it was trained with the right one?
- **Deceptive Alignment** (also: scheming): Could a model behave well while it's being tested and differently once it isn't?
- **Scalable Oversight**: How can people supervise an AI on tasks too hard for them to check themselves?
- **Weak-to-Strong Generalization**: Can a weaker supervisor train a model that ends up better than the supervisor?
- **AI Control**: How do you stop an AI from causing harm even if you can't be sure its goals are right?
- **Chain-of-Thought Faithfulness** (also: CoT monitoring): Does a model's written reasoning show what actually drove its answer?
- **Dangerous Capability Evals**: How do labs test whether a model could help with something truly dangerous?
- **Sandbagging**: Could a model deliberately underperform on a test to hide what it can do?
- **Responsible Scaling Policy** (also: frontier safety framework): How do labs decide ahead of time what safety steps a more capable model requires?
- **Superintelligence** (also: ASI): What would an AI that outthinks people at nearly everything look like, and why is it so hard to predict?
- **Existential Risk** (also: x-risk): What is the argument that advanced AI could threaten humanity itself, and what is the case against it?

**Interpretability**

- **Mechanistic Interpretability** (also: interpretability): How do researchers open up a neural network to see what it is actually computing?
- **Saliency Map** (also: feature attribution): How can you see which pixels an image model looked at to make its call?
- **Probing** (also: linear probe): How can a simple test reveal whether a model secretly represents something it never says?
- **Circuit** (also: circuits): How do groups of neurons wire together to do one specific job inside a model?
- **Induction Head**: How does a model learn to copy a pattern it saw earlier in the same text?
- **Polysemanticity**: Why does a single neuron inside a model respond to totally unrelated things?
- **Superposition**: How does a model pack in more ideas than it has neurons?
- **Sparse Autoencoder** (also: SAE): How do researchers untangle a model's crowded neurons into readable concepts?
- **Activation Steering** (also: steering vectors): How can nudging a model's internal signals change its behavior without retraining it?
- **Logit Lens**: Can you read a model's half-formed guess at each layer before it answers?

**Research frontiers**

- **State Space Model** (also: SSM): Can a model read a million words without attention's quadratic cost?
- **Multi-Token Prediction**: What changes if a model predicts several tokens at a time instead of one?
- **Diffusion Language Model**: Could text be written the way images are generated, all at once out of noise?
- **Test-Time Training**: What if a model kept learning while it worked on your problem?
- **Continual Learning**: Why can't today's models keep learning after they ship, the way people do?
- **Grokking**: Why does a model sometimes suddenly understand a task long after it memorized the answers?
- **Double Descent**: Why can making a model bigger first hurt, then help again?
- **World Model**: Can an AI learn how the physical world works just by watching video?
- **Recursive Self-Improvement**: What happens if AI starts doing the research that improves AI?
- **Compute Governance**: Why do some think controlling AI chips is the most practical way to govern AI?

**Limits of computing**

- **Halting Problem** · CS (also: undecidability): Why are there questions about programs that no computer can ever answer?
- **P vs NP** · CS (also: NP-complete): Why can checking an answer be easy when finding it seems impossibly hard?
- **Formal Verification** · CS: How can you prove code is correct instead of just testing it?
- **Quantum Computing** · CS (also: qubit): What makes a quantum computer different, and which problems could it actually solve faster?
