# Helios Social images v1: handoff spec

## Read this first

This adds an image step to the v2 pipeline so slides get real, credited photos automatically. It builds on docs/DESIGN-V1-HANDOFF.md, which already defines where photos go on each slide type. Treat this as intended behavior and map it onto the code as it is.

What is fixed:
- **Only real photos from sources we're allowed to use** (below). Never AI-generated images, drawn shapes, stock photos, or photos lifted from news articles.
- **Every image is credited in the caption.** An image with no license and author doesn't ship.
- **No image is better than a wrong one.** When in doubt, the slide stays type-only.

## Why this change

The Reporter rarely finds a usable photo. In our test runs, every image it listed was dropped: the links pointed to article pages instead of image files, and the credits were empty. Photos in news articles also usually belong to agencies like Getty, AP or Reuters, and we can't repost them. So images need their own step, with sources that come with a license.

## Allowed sources, in order

1. **The organization's own press materials.** Newsroom and press-kit images published by the company or government office in the story, for media use. Credit: "Photo: [Organization]."
2. **Wikimedia Commons.** Photos of named people, companies' buildings, products and places. Only these licenses: public domain, CC0, CC BY, CC BY-SA. Never NC (non-commercial) or ND (no derivatives). Credit: "Photo: [Author] / Wikimedia Commons, [license]."
3. **U.S. federal government photos,** which are public domain. Credit: "Photo: [Agency]."

Not allowed: images from news articles or their `og:image` tags, Getty, AP, Reuters or other agency photos, search-engine image results, and social media posts.

## Accuracy rules (non-negotiable)

A wrong photo is worse than no photo, and a photo of the wrong person next to a quote is the worst failure this step can have.

- **Identity comes from the source's records, never from a model looking at a face.** The vision check does not identify people and must never be used to decide who someone is.
- **People:** the only allowed photos are ones Wikidata or Wikimedia Commons explicitly link to that exact person: the person's Wikidata main image (P18), or a Commons file whose structured "depicts" (P180) is that person's Wikidata ID. Never a free-text search result for a person's name.
- **Resolve the person first.** Find the Wikidata entity for the name, then check its description against the brief (for example, "Governor of California" for Gavin Newsom). If the match is ambiguous or doesn't fit the brief, stop: no photo.
- **Companies, buildings, products and places** follow the same rule: linked to the exact Wikidata entity by P18 or P180, not found by search text.
- **Group photos are rejected** for a person. The vision check confirms one clearly visible person, a real photograph, and no large text or watermarks. It confirms the kind of photo, not the identity.
- **Quote slides:** a speaker photo appears only when the QUOTE BY names that exact person and the photo passed the rules above. A quote from an organization ("OpenAI") never gets a person's photo.
- **Review shows the proof.** For every chosen photo, the summary and review screen list the subject, the Wikidata ID, the Commons file link and the license, so a reviewer can confirm it in seconds.

## How it works

### 1. The Writer names the subject

The Writer's IMAGE line changes from "brief image N or type only" to naming a **real subject** the slide is about:

```
IMAGE: photo of <a person, company, product or place named in the brief's TERMS> | type only
```

Examples: "photo of Gavin Newsom," "photo of the California State Capitol," "photo of OpenAI's headquarters." Never a scene or an event ("photo of the agent escaping"), and never a subject that isn't in TERMS.

### 2. Code finds candidates

A new image step runs after the Editor, before the Caption. For each distinct subject requested:
1. Search the organization's newsroom or press page if the brief's SOURCES include one.
2. Search Wikimedia Commons (its API returns license, author and file URL).
3. Keep at most 5 candidates per subject: real photos, at least 1080px on the short side for full-bleed slots (600px for the round speaker photo), with an allowed license and a known author.

### 3. A model checks each candidate

A cheap vision check (Haiku, with the image) answers yes or no for each candidate:
- Does it clearly show the named subject?
- Is it a photograph, not a logo, chart, screenshot or illustration?
- Is it free of large text, watermarks and other people's branding?
- For a person: is their face clear and not cropped?

Take the first candidate that passes all four. If none passes, the slide is type-only.

### 4. Place and credit

- Put each image in the slide's photo slot as defined in DESIGN-V1-HANDOFF.md.
- The same image never appears twice in one post.
- The cover gets the best image if the Writer asked for one.
- Append every credit to the caption after the "Source:" line: "Photos: [credit]; [credit]."
- Store each image's source URL, license, author and the vision check's answer in the debug log.

### 5. Fact-checker

Add the chosen images' subjects to what the Fact-checker sees (for example, "Slide 4 image: photo of Gavin Newsom, Wikimedia Commons"), so it can flag a photo that doesn't fit its slide.

## Prompt changes

Paste these as written. They replace the image wording added in the design handoff.

**Writer, "## The slides" section.** Replace the bullet that begins "For images, use a numbered image from the brief" with:

> - For images, name a real subject the slide is about: a person, company, product or place listed under TERMS, like "photo of Gavin Newsom." Never ask for a scene or an event. If no subject fits, write "type only." Ask for at most one photo every other slide, and give the cover one when the story has a clear subject.

**Writer, handoff format.** Change the COVER IMAGE and IMAGE lines to:

```
COVER IMAGE: photo of <subject from TERMS> or "type only"
IMAGE: photo of <subject from TERMS> or "type only"
```

**Writer, image slide.** In the list of slide kinds, change the Image slide line to:

> - Image slide: IMAGE set to a photo of the slide's subject, with a HEADLINE.

**Editor, "Images" check.** Replace the paragraph with:

> **Images.** Each IMAGE and COVER IMAGE names a real person, company, product or place from TERMS, or says "type only." Cut any request for a scene, an event, or a subject not in TERMS.

**Fact-checker, flag list.** Replace the image line with:

> - an image that doesn't show what the slide is about, or a request for a scene or event instead of a real subject

## Reporter

The Reporter's IMAGES section becomes optional. Keep it: if the Reporter finds an image from an allowed source with a real credit, use it first. Otherwise the image step does the work.

## Cost

Wikimedia's API is free. The vision check costs well under $0.01 per candidate with Haiku, so under $0.05 per post. Cache found images per subject for 30 days, so repeat subjects (OpenAI, Anthropic, Sam Altman) cost nothing after the first time.

## Acceptance

1. Mocked tests: subject parsing, license filter (NC and ND rejected), size filter, vision-check routing, one-image-per-post, credit line format, type-only fallback.
2. Free: run the image step alone (no writing stages) on a fixture post with hand-written IMAGE lines: "photo of Gavin Newsom" on the cover and "photo of the California State Capitol" on one Text slide. Render it with --render-preview and show me which images it picked, their licenses, and the credit line.
3. Then one live run on the California executive order story (e045bc07), with --render-preview.

## Not in scope

- Paid photo services (Getty, AP, Reuters).
- AI-generated or drawn images.
- A manual image picker in the review screen. That comes later.
