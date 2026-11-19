# Sound inbox: drop folders of effects here

This folder feeds the **central Helios sound library** (`explainers/design/sfx`). Every content
type that uses sound effects reads that one library: Explainers, Reel AI Drama, Real Case, and any
format added later. A sound you drop here reaches all of them.

1. Drop any folders of sound effects into this folder, e.g. `inbox/Whooshes/`,
   `inbox/Paper Pack 2/`, `inbox/hits/cinematic/`. Any of wav, mp3, ogg, flac, aif, m4a work.
   Nested subfolders are fine, and so are `.zip` files (they are unpacked next to themselves).
2. Run one command from the repo root:

   ```
   node explainers/design/sfx/tools/ingest-inbox.mjs
   ```

   Add `--dry-run` to see what would happen without writing anything. `--jobs 4` limits the
   worker count (the default uses every CPU core).

   **Zips anywhere (no need to copy or unzip them):** name them after the command. Each zip is
   read where it is; its audio is extracted one zip at a time to a temp folder that is deleted
   after, and a zip ingested before is skipped whole on a re-run:

   ```
   node explainers/design/sfx/tools/ingest-inbox.mjs --store ~/HELIOS/sfx-dropins ~/Downloads/*"Sound FX.zip"
   ```

   `--store <folder>` keeps the converted MP3s outside the repo (hundreds of MB are too big for
   git): `dropins/` becomes a link to that folder. `--limit 15` ingests an even sample of 15 files
   per zip, for a trial. A machine without the store (the render VM until it is copied there)
   simply does not see those drop-ins; nothing breaks. `dropins/`, the originals in `inbox/` and
   `.ingest-cache.json` are git-ignored; `catalog-inbox.json` is the part to commit.
3. That's it. The next reel of every format can reach the new sounds. The ingest ends with the
   **voice screen** (`tools/voice-screen.mjs`, Mac only): every new sound is measured for speech and
   singing, and one with a voice (or never measured) never plays in a reel. Commit
   `voice-screen.json` with `catalog-inbox.json`.

It is built for big drops (thousands of files): it walks the folders once, runs ffmpeg on every
CPU core at once, prints progress with an ETA every 50 files, and saves its work every few
seconds, so a crash or Ctrl-C keeps everything finished so far; run it again to carry on. A
re-run skips every file it has already seen (by content hash, in `.ingest-cache.json`), so it
takes milliseconds when nothing is new. One bad file is rejected with a reason and never stops
the run. To re-ingest from scratch, delete `catalog-inbox.json`, `.ingest-cache.json` and
`dropins/`.

## Name things plainly

The folder and file names are how every format understands a sound, so plain words help:
`Impacts/wood-block-hit.wav` or `Paper/page turn 03.mp3`. These words also decide which event
kind a sound serves:

| words in the name | the sound becomes a |
|---|---|
| whoosh, swoosh, swish, swipe, whip, flyby, transition | `whoosh` |
| sting, jingle, chime, ding, success, sparkle, reveal | `sting` |
| impact, hit, thud, slam, boom, punch, knock, bass | `impact` |
| pop, bubble, blip, bloop, plop, pluck | `pop` |
| click, switch, toggle, button, lock, latch, snap | `click` |
| tick, tock, tap, count, select, beep | `tick` |
| anything else (pencil, paper, door, coins…) | `foley`, found by its words |

Reel AI Drama's sound designer also offers drop-ins as designed stingers: names with riser,
build, swell or tension (a sound that builds) become risers; sub, rumble or subdrop become subs;
whoosh words whooshes; hit, impact, slam, boom or braam hits; and short foley becomes a `spot`
(the sound of a real thing). Its menu holds a few per kind, one per sound family first.

## What the script does to each file

- Measures it with ffmpeg: length, peak and average level, leading silence, attack, decay and
  brightness. These become tags (`short`, `long`, `sustain`, `sharp`, `soft-attack`, `bright`,
  `dark`) and a one-line description. The variety rules use them to pick a similar substitute.
- Skips files it already ingested, byte-identical copies, and duplicates of a sound already in
  the library.
- Rejects broken, silent or too-quiet files, files under 0.04 s and files over 60 s, and says
  why.
- Trims leading silence, normalizes the peak to -1 dBFS, and writes a 48 kHz stereo MP3 to
  `dropins/<folder>/` (the folder is named after the zip). Your originals stay untouched. Delete them after a run, or keep them.
- Adds every new sound to `catalog-inbox.json`. The library loads it beside the main
  `catalog.json`, which is never changed.

Check what's in the library at any time:
`node explainers/design/sfx/library.mjs --summary`, or search it:
`node explainers/design/sfx/library.mjs paper slide` (`--dropins` for your sounds only,
`--kind impact`). Explainers also has `node explainers/world-kit/sfx-find.mjs --families`.

Use only sounds you are licensed to use (CC0 or your own). Note the source in the folder name or
a text file next to it.

## For a new content type (developers)

Read sounds through `explainers/design/sfx/library.mjs`, never by opening `catalog.json` yourself:

- TS code: `import { loadLibrary, searchLibrary } from '@/explainers/design/sfx/library.mjs'`.
- A kit that is copied into a job workspace: add a symlink `sfx-library.mjs` in the kit pointing
  at `library.mjs` (as `explainers/world-kit/sfx-library.mjs` does) and import `./sfx-library.mjs`.
  The copy into the job keeps it pointing at the library.
- Load with `loadLibrary(dir)`, `dir` being the job's `assets/sfx-library` (a link to this
  library) or `SFX_DIR`; `{ ambience: true }` adds the long beds. Pick with
  `searchLibrary(catalog, { words, kind, tags, not, minDur, maxDur, attack, brightness, source })`
  or your format's own rules. For a model prompt, send `librarySummary()` counts or a small
  searched shortlist, never the whole catalog.
