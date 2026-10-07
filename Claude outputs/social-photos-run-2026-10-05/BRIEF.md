# Brief: Helios Social: three test posts after the photo step (2026-10-05)

## What Helios Social is
An automated pipeline that turns the day's AI news into Instagram carousel posts for Helios (@heliosgroup.ai), an AI news account for non-specialist readers. Each post has a cover slide, 5–8 story slides, a follow slide and a caption. It's being rebuilt stage by stage, with a person (Tommy) reviewing every stage.

**Pipeline:**
1. **Selection (Jev):** Jev, a cheap yes/no model, picks the day's stories.
2. **Reporter (Claude):** reads the sources and writes a fact brief.
3. **Writer (Claude):** writes the slides and caption from the brief.
4. **Editor (Claude):** cuts and sharpens only, never adds facts.
5. **Fact-checker (Claude):** flags false claims. Code fixes them by swapping in the brief's own words or cutting.
6. **Photos:** finds a photo for every slide.
7. **Render:** draws the slides.

Rules that shape the text:
- Quotes and numbers are never typed by the model. The Writer refers to them by ID, and code fills in the exact text from the brief.
- Every line carries the IDs of the brief facts it rests on.

## What these files are
They're a **mid-build test snapshot, not finished posts.** Three real stories from 2026-10-05:

| Name | Story | Primary source |
|---|---|---|
| altman | Sam Altman, in a Politico interview, says the world should accept some bad things happening for AI's benefits | Politico interview, via Fortune, The Verge, Futurism and others |
| gemini | From Oct 9, Google limits free Gemini app users to Flash-Lite, and AI Plus users lose Pro | Google support page, via 9to5Google, TechCrunch, PCMag and others |
| nyc | NYC Council AI hearing: Anthropic, OpenAI, Google and Meta testified; Musk's SpaceXAI skipped | CNBC |

The words went through Reporter → Writer → Editor → Fact-checker in live runs. Then the new photo step ran live on them. Nothing has gone through the final mechanical checks (highlight colours, punctuation, character limits, credit lines) or the full design stage yet.

## Folder layout
| Path | What's in it |
|---|---|
| `posts/<name>.readable.md` | **Start here.** Each slide's text, the image request, the photo used (or NONE), its credit, and the identity check. |
| `posts/<name>.post.json` | The exact object the slide renderer draws. |
| `photo-logs/<name>.photos.json` | Per slide: the photo step's full trace. Every source tried, rejections and reasons, the fallback step used. |
| `drafts/<name>.edit-check.txt` | Human-readable Writer → Editor → Fact-checker changes, with flags and costs. |
| `drafts/<name>.edit-check.json` | The same in JSON. `final` is the post-Fact-checker draft. |
| `briefs/<name>.brief.json` / `.txt` | The Reporter's fact brief: facts (F#), quotes (Q#), numbers (N#), subjects, article photos, sources. |

## How the photo step works
Each slide asks for one image:
- `subject: <name>`: a person or company;
- `article: <photo URL>`: a photo from a source article;
- `stock: <scene>`.

Code goes down a fallback chain, and the first step that works wins:
1. **Article photo,** only if its caption and credit allow it. Agency credits (Getty, AP, Reuters…) and the outlet's own staff photos are rejected, and an unknown credit isn't used.
2. **The slide's subject.** First the subject named in the image request, else a quote speaker, else a subject named in the slide text. Before any subject photo is used, an identity check runs: Jev must agree that a Wikidata entry is the person or company the brief describes, and Wikidata must class it as a human or an organization. Then a Commons photo of that exact entry is used.
3. **The slide's stock scene,** from Openverse.
4. **Neutral scenes** (places and objects, never people).

No photo repeats within a post.

## Results and known problems
Only 7 of 23 slides got a photo (Altman 7/8, Gemini 0/7, NYC 0/8). Every slide is supposed to have one.

1. **Stock never returned a photo.** The Openverse code rejects every result: it requires a JPEG/PNG mime type that Openverse now leaves empty, and a ≥1080px short side, while Flickr results are 1024×683. Openverse does have results (34 for "server room"). This breaks steps 3 and 4. **Fix pending Tommy's call.**
2. **The identity check rejected several entries that look correct:** Julie Menin, Logan Graham ("Canadian Rhodes Scholar"), Jacob Coxon ("British AI researcher"), Alex Turner ("researcher"). Jev's scores weren't logged, so it's unclear whether the 0.7 threshold or the question wording is the problem.
3. **Combined subject name:** the NYC brief lists "SpaceXAI (xAI) / Elon Musk" as one subject, so it can't match any Wikidata entry.
4. **Order question:** the slide's subject outranks the Writer's own stock scene. A slide that asks for "warning sign" but names Altman gets an Altman photo.
5. **Content watch item (NYC):** the Reporter carried an outlet's paraphrase as fact and dropped a qualifier (fact F7, "more dangerous than China"). It survived to the post.
6. **Renderer and placeholders:**
   - quote slides don't show their headline;
   - the category chip is a placeholder ("TECH");
   - the issue number is 0;
   - the date is the run date, not the story's date;
   - all text is one colour (highlights come later).

## Constraints if you suggest changes
- **No patch from a single failure.** Fix patterns, at the stage that caused them.
- The Editor only cuts and sharpens; adding or creating belongs to the Writer.
- Identity comes from records (Wikidata, official captions), never from looking at a face.
- No photo is better than a wrong one. A slide must never show a person who could be mistaken for the subject.
- Live model calls need Tommy's explicit OK and a cost estimate first.

## Useful questions for a review
- Reading `posts/*.readable.md` as a non-specialist: does each post tell the story clearly, cover to caption?
- Do any slides overstate the brief? Compare the slide text with the cited fact IDs in `briefs/`.
- In `photo-logs/`, which rejections look right and which look like false negatives?
- What should the fallback order be (point 4)?
