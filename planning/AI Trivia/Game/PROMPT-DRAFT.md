# Prompt draft for AT-78 (approved by Lucas 2026-11-16; built)

Supply for the web game: the writer is asked for a count of questions instead of three, a cell can hold many
questions, and the repeat lists get narrower so they stay small for years. Three texts change; nothing else in
the prompts changes. Ids bump to `trivia-write@5` and `trivia-check@4` (the split had already made the writer @4, adding a Research paragraph, kept as is).

Review lens: one definition of "repeat" lives in one place (`REPEAT_RULE`); each prompt only says which list it
checks against. No examples added. Every rule that must hold says "required" or is in a required list.

---

## 1. The repeat rule (`lib/stories/trivia/quality.ts`)

**Now** (`NEVER_REPEAT`, used by both the writer and the fact-check):

> Never repeat a fact. The material lists, under asked, questions the series has already asked, each with its
> answer. A question repeats one of them when its answer turns on the same fact. A different question about the
> same subject is fine.

**New** (`REPEAT_RULE`, the definition only):

> A question repeats an earlier one when its answer turns on the same fact. A different question about the same
> subject is fine.

## 2. The writer (`trivia-write@4`)

**Task line, now:**

> Your task: write three multiple-choice questions about AI for this viewer. Across your three, vary the theme,
> the kind of fact and the shape of the question.

**New:**

> Your task: write the number of multiple-choice questions about AI the material asks for (count), for this
> viewer. Across them, vary the theme, the kind of fact and the shape of the question.

**The repeat paragraph, now:** the shared `NEVER_REPEAT` above.

**New:**

> Never repeat a fact. Each cell in the material lists, under asked, the questions already written in it, each
> with its answer. A question you anchor to a cell must not repeat any of them. ${REPEAT_RULE}

**The cells section, now:**

> Cells. The material lists today's open cells from the series' content map. A cell is a theme crossed with an
> angle: the theme is what the question is about, the angle is the kind of fact it turns on. These rules are
> required:
> - Anchor every question to one cell from the list and give its cell_id. The question fits both the cell's theme
>   and its angle.
> - Every question uses a different cell.
> - Choose the three cells that yield the strongest questions for this viewer. A cell you don't use stays open for
>   another day.

**New:**

> Cells. The material lists open cells from the series' content map. A cell is a theme crossed with an angle: the
> theme is what the question is about, the angle is the kind of fact it turns on. A cell holds many questions over
> time. These rules are required:
> - Anchor every question to one cell from the list and give its cell_id. The question fits both the cell's theme
>   and its angle.
> - Every question uses a different cell.
> - Choose the cells that yield the strongest questions for this viewer. A cell you don't use stays open for
>   another day.
> - spent_cells: the cell_id of every listed cell you judge has no fresh fact left that would make a strong
>   question for this viewer; an empty list when there is none.

The tool gains `spent_cells: string[]` (required).

## 3. The fact-check (`trivia-check@4`)

**Opening, now:** "… the writer's sources, and the questions the series has already asked."

**New:** "… the writer's sources, and the earlier questions it must not repeat."

**Test 4, now:** "4. It is not a repeat, by this rule: ${NEVER_REPEAT}"

**New:**

> 4. It is not a repeat. The material lists, under asked, the questions the series has posted on the same theme
> and any questions already chosen to post alongside this one, each with its answer. It repeats none of them.
> ${REPEAT_RULE}

---

## What the code feeds each list (for context, not prompt text)

- Writer `cells[].asked`: every question ever written in that cell (pooled, posted or archived), so a fact the
  check already failed is not tried again. About 9 a cell per year.
- Fact-check `asked`: questions posted on the question's theme (IG story or game), plus the questions already in
  the game day being built. About 120 a theme per year.
