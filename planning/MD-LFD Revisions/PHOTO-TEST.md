# Photo grading: Jev vs Haiku (2026-11-23)

## Setup
- Test set: 49 images in `.memes-local/news-ranker-lab/photo-test/`.
  - 31 candidates: the article images of 20 posted stories.
  - Controls: 8 logos and 10 AI-generated pictures, from Wikimedia Commons.
- Briefs: one Haiku call per story writes the photo brief.
- Graders: Haiku and Jev answer the same six questions (logo, AI-made, overlay, specific subject, related, clarity) and get the same tier rule (`scripts/photo-vision-test.ts`).
- Reference: a fresh Opus agent viewed every image.
- Spend: briefs $0.058, Haiku $0.139, Jev $0.0045.
- Jev rejected 4 very wide logos with "Invalid image dimensions". A width-to-height ratio above about 3.7 fails, so production must pad these.

## Results
| | Tier agreement with Opus, all / candidates | Good photos found (of 14) | Bad photos let through | Per image | Latency |
|---|---|---|---|---|---|
| Haiku | 80% / 71% | 9 | 1 | $0.0031 | 1.8 s |
| Jev | 60% / 42% | 1 | 0 | $0.0001 | 0.15 s |
| Jev without its AI-made question | 82% / 74% | 9 | 2 | $0.0001 | 0.15 s |

- Per question, agreement with Opus (Jev / Haiku):
  - logo 100 / 98
  - AI-made **44** / 93
  - overlay 89 / 84
  - specific subject 89 / 89
  - related 73 / 78
- Jev's AI-made probabilities do not separate real from AI. Real photos scored 0.11–0.97 and AI pictures 0.59–0.96, so no threshold works: at 0.8 it misses 2 of 10 AI pictures and still rejects many real ones. This one question caused nearly all of Jev's misses.
- Both graders caught every logo and every AI control.

## Lenient AI check, Haiku on finalists (D19), 2026-11-23
- Run on 41 images (logos excluded), $0.081.
- Real candidates: 1 of 31 removed, and Opus agreed it was AI-made. The strict question had flagged 5.
- AI controls: 4 of 10 removed. Jev's own checks still drop the 6 it kept:
  - 3 are AI-drawn badges, which Jev marks as logos.
  - 3 are unrelated or murky (clarity 2–7).
- The one suspected-AI real candidate it kept is a generic warehouse photo that Jev already grades none (clarity 3.6).
- So the full pipeline posts none of the AI images, and loses 1 real photo instead of 5.
