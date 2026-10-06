# Helios photo bank (local until M9)

How to add press photos (hand-seed):
1. Put the image files in a folder per organization, for example `public/social/bank/openai/office-2026.jpg`.
2. Add one entry per photo to `manifest.json` (the schema is `BankEntry` in `lib/social/photos/bank.ts`):

```json
{
  "id": "openai-office-2026",
  "url": "/social/bank/openai/office-2026.jpg",
  "kind": "company",
  "qid": "Q21708200",
  "event": null,
  "tags": [],
  "credit": "Courtesy of OpenAI",
  "licence": "press kit, editorial use",
  "source": "https://openai.com/press (page the photo came from)",
  "width": 0,
  "height": 0,
  "faces": null,
  "addedAt": "2026-10-06"
}
```

3. Run `npx tsx scripts/social_bank_check.ts --write`. It does three things:
   - checks every entry;
   - fills in the width and height;
   - runs the face detector, recording `faces`.

## The rules
- **Company photos must show no people.** A company photo with a face is rejected. Use `kind: "person"` with the person's Wikidata id for photos of people.
- **Person and company photos** are only reused for the same Wikidata id (`qid`), never matched by name.
- **Event photos** are only reused for the same `event`.
- **Scenes and stat backgrounds** are matched by `tags`.
- **No photo is reused within 7 days**, across every source.

## Wikidata ids for the 8 companies (verify before use)
| Company | Wikidata id |
|---|---|
| OpenAI | Q21708200 |
| Anthropic | Q116758847 |
| Mistral AI | Q119718658 |

These three come from today's identity checks. Look up Google, Meta, Microsoft, Nvidia and xAI on wikidata.org before using them.
