# Frame worker — AI News Explained delta (news-v1)

> Read it with the shared contract above as one role. Decisions: planning/Real Case Reels/DECISIONS.md
> (RC-39 to RC-52).

## The format (HARD CONSTRAINTS)

- **A true story told as a true-crime documentary.** Your frame is one act. Follow `frame.md`'s frame
  treatment for your `type`, in your `ground`'s scene, with that scene's components only.
- **The evidence explains, never words on tiles.** What happened is shown by real-world objects:
  clippings, printouts, notices, tags, cutouts, logos, drawings, and where the marks and the cord run.
  A short typed tag or a handwritten note of at most 4 words may name an item or a date, as on a real
  case board. Never a card or box whose words stand for a step or a concept.
- **Facts only.** Every number, date, name and outcome on screen is in your frame's `claims:` (as the
  facts state them) or in an artifact `## Artifacts` gives, word for word. Never add one, never round
  one, never paraphrase an artifact. A newspaper's body is facts or the kit's filler lines, never
  invented sentences.
- **Players only as allowed.** A logo only for a company `## Players` marks "logo banked", from
  `assets/bank/logos/`; a photo only for a person it marks "cutout banked", from
  `assets/bank/cutouts/`; anyone else a `silhouette` or their name. A private person is never named or
  shown.
- **Objects only from `assets/objects/`.** Each `## Case file` object your act lists: its cutout on the
  board or newspaper, its drawing on the whiteboard. If it is missing, leave it out.
- **The key detail** is the exact words or number `## Case file` names. In acts 1, 3 and 5 it is marked
  on its word as the voice says it: in Helios orange (`COLORS.marker`) on board and newspaper, in red
  dry-erase on the whiteboard. Nothing else in the reel is orange.
- **Circle a number or a single word; underline a phrase.** A circle around two words or more reads as
  a strikethrough.

## Your act

The `type` in your packet picks the treatment in `frame.md`. Notes the treatment table cannot hold:

- **Frame 1 (`cold_open`)** is moving at t = 0: the first item lands by 0.3s. The sting (a case folder
  stamped AI NEWS EXPLAINED) plays over your frame's last 1.2s and is code's: keep the board under it
  still, and put no event after `voice_end`.
- **Frame 2 (`setup`)** shows the `stamp:` value first, then each player as the voice names them.
- **Frame 3 (`moment`)** recreates the key artifact with `printout()` word for word; its key detail in
  `[[ ]]` so the mark can find it.
- **Frame 5 (`reveal`)** shows the term once, arriving on the word that names it, with the
  `term_card:` as its meaning: written in `markerNote` on the whiteboard (paper there is only the
  artifact and logos), the `dictionaryClipping` on the board or newspaper. The mechanism is the `## Case file` chain, drawn
  link by link on the voice.
- **Frame 8 (`branding`)** is code's. No worker builds it.
