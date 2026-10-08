# Image strategy (a) and (b): build proposal

**Status:** PROPOSAL, not built. It needs Tommy's approval first.
**Spec:** §5.1, "Image strategy: AGREED DIRECTION" (2026-10-07).

**Starting point:**
- The page reader already extracts every `<figure>` and the `og:image` from each page the Reporter opens, with caption and credit.
- The Reporter tags each SOURCES entry `original | official | aggregator`.
- The identity check already resolves SUBJECTS organizations to a verified Wikidata QID.

---

## (a) Official images from the company's own announcement page

**What it is:** when a SUBJECTS company announces something on its own site, the images on that page are the company's own. We use them, credited "Image: <Company>", even when the page has no credit line. Today that case fails the credit check as "unknown".

### Changes

**Reporter: no prompt change.**
- It already opens official pages and tags them `official`.
- Code decides which pages count as the company's own.
- A SOURCES entry counts when it is tagged `official` **and** its URL host matches the company's official website from Wikidata (P856, on the QID the identity check verified).
- The match is a code check. The Reporter's tag alone isn't enough, so a partner's or reseller's page never counts.

**Credit check (`credit.ts`):** a new allowed rule, `official page of <Company>`.
- **It applies when** the photo was found on a page that passed the check above.
- **Rejection still wins.** An agency or stock credit in the caption or credit line (Getty, AFP, Shutterstock, etc.) still rejects the photo.
- **The credit is built by code:** "Image: Anthropic". It's never copied from the page.

**Photo chain (`find.ts`):**
- **Requests:** the Writer keeps requesting `article: <url>`, and ARTICLE PHOTOS lists these images with an `official: <Company>` marker. So there's no new IMAGE kind, and the Writer's only change is one line about the marker.
- **Source:** the photo gets the source `official`, which ranks above other article photos.
- **The vision check runs on official images too:**
  - **Rejected:** banner graphics with baked-in headline text, and images whose main subject is a person not named in SUBJECTS.
  - **Allowed:** product shots, UI screenshots and event photos of the company.
- **Kind:** official images count as `subject` (own region, never full bleed under text), because many show people or product UI.

**Renderer: no new layout.**
- Official images use the subject region, like article photos.
- The credit pill shows "Image: Anthropic".

**Stages and AI calls:** 0 new stages. The only extra AI is the vision check on official candidates, about $0.0025 each and at most 2–3 per post.

### Risks
- **Text-heavy banners:** many `og:image` files are title cards. Shown next to slide copy, they repeat or contradict it. The vision check needs a sixth question, "mostly text or a graphic banner?", or `og:image` is skipped unless it's the only image.
- **Terms:**
  - Newsroom pages generally permit editorial use, but not all do.
  - Proposal: an allow-list of companies whose newsroom terms have been checked once (Tommy). Pages outside the list stay "unknown".
- **People in official photos** are identified only by the company's caption. They're never matched to a SUBJECTS person by face. A person shown without a caption naming them stays a scene-free rejection (vision: person prominent).
- **Wrong owner:** a page hosted on a CDN or a partner domain fails the P856 host match, and the photo is not used. It's conservative.
- **Repetition:** a company reuses one hero image across announcements. The 7-day rule and the photo bank handle this.

---

## (b) Logo cover cards for company stories

**What it is:** for a story about a company, the cover can be a Helios-designed card with the company's official logo, instead of a stock or starter photo. This fixes cases like the Mistral cover, where the company's main image (P18) wasn't usable and the cover fell back to a padlock and then a microchip.

### Changes

**Reporter: none.** SUBJECTS already names the company.

**Identity:** reuse the existing check. The logo comes only from the verified QID, never matched by name.

**Logo source:**
- **Where it comes from:** Wikidata P154 ("logo image") on that QID. Pick the current value: preferred rank, else the one without an end date.
- **Licence:** fetched from Commons with the existing imageinfo licence check. Commons' PD-textlogo and free-licensed logos pass. A logo hosted only on English Wikipedia (non-free) is never used, and the card falls back.

**Credit check:** a logo is allowed when the Commons licence passes. The credit is "Logo: <Company> · Wikimedia Commons".

**Photo chain:**
- **When:** a new cover-only step, after the subject's P18 and official images, before stock and the starter set.
- **Trigger:** the chosen cover's subject (or the brief's main SUBJECTS organization) is an organization with a usable P154.
- **Photo record:** `source: 'logo'`, `kind: 'logo'`.

**Renderer: a new cover mode, `logo-card`.**
- **Background:** Helios-designed, built from brand tokens (canvas, a subtle grid or gradient). There are no photos behind the logo.
- **Logo:** centred in its own region and rasterized from SVG with `sharp`.
- **Light or dark plate:** chosen by code from the logo's luminance and alpha, so contrast always holds. The logo itself is never recoloured, cropped or edited.
- **Headline:** below, as in the split cover.
- **Fit check:** a minimum logo size, the logo must stay inside its frame, and face detection is skipped (`kind: 'logo'`).

**Stages and AI calls:** 0 new stages, 0 new AI calls.

### Risks
- **Endorsement and trademark:** a logo card can read as the company's own post. The card must look like Helios (a Helios mark and layout, never the company's colours as the background), and the logo stays small enough to read as "about" the company. Editorial use of a logo to identify the subject is normal, but Tommy should confirm the policy.
- **Outdated logos:** P154 can hold old logos. The rank and end-date rule picks the current one, and the bench checks it.
- **Monotony:** company stories are common. Logo cards are for covers only, and the 7-day rule applies per logo, so the same company twice in a week falls back to the next source.
- **SVG edge cases:** some logos are white-on-transparent or very wide. The plate rule and a maximum aspect ratio handle these. The bench gets a few hard logos as fixtures.

---

## Testing (both)
- **Bench:** extend the photo-finder bench with fixed company stories: Anthropic, Mistral, Google, OpenAI, plus one with a partner-hosted page.
- **Offline tests:** the P856 host match, the credit rule, the P154 value choice, and the plate choice.
- **Pass bar:** same as the bench, 0 misleading images and every miss explained.
