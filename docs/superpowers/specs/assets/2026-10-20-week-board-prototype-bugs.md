# week-board-a12.html: bugs and edge cases (read-only review, code read, not run)

Line numbers refer to the prototype file.

## Real bugs

**State**
- **"Move it back to ready" does nothing.** The booked-post modal (L613) and `removeCard` (L584) never push the post into `READY`. The post just vanishes. Repro: remove a booked card, then look at "Ready to place".
- **LFD rule bypass.** Move-to (L465) and card-drag (L553) only check "Carousel onto an LFD day". Dragging an existing LFD card onto a Carousel day, or using Move to with an LFD card, gives LFD plus Carousels. Only the tray path (L557) has the confirm modal. The tray also allows two LFDs on one day.
- **Duplicates allowed.** `freeWins` and `nearestWin` (L325-333) are dead code. Dropping the same Story series twice at one time stacks two identical cards.
- **Move to ignores "now".** L465 keeps `c.t` and does no clamp. Move a 9:00 card to Today and it is born locked, so it cannot be moved or removed.
- **Gap fix creates unpostable cards.** "Add Morning Download" does `unshift(mk('sto'))` at 8:30 (L638). On Today that is before `NOW_MIN`.
- **Reset wipes data.** Reset (L463, L483, L645) clones standard, so `posted`, `booked` and `approved` are all lost. It works on folded past days and Today, and there is no booked modal.
- **Stale approved flag.** L572 deletes `booked` on a cross-day drag but leaves `approved` (Move-to at L465 deletes both).
- **Move-to select goes stale.** After "Keep it" in the modal, the select still shows the chosen day but nothing moved.
- **False "Edited" badge.** `sig` (L383) sorts by `t` only. Equal-`t` cards (two Stories at 8:30) compare in insertion order, so a move-away-and-back flips the badge.
- **Undo gaps.** `snap` omits `state.tab`. The Undo toast survives a tab switch and silently undoes the other tab's work. Ctrl+Z also fires with the modal open. There is no redo. "Make it every X" (L464, L600) never calls `push()`, so it can't be undone alone, and a later undo reverts it silently because `snap` includes `standard`. L601's text claims started slots are kept, but the whole day is copied.
- **"Make it every" label.** It names only the last weekday (L598), but saves every touched day.

**Drag**
- **Empty-state hint lost.** L523 removes `.empty` on dragover, and `clearDrag` doesn't restore it. Hover an empty day, leave, and the hint is gone.
- **Snap eats time slots.** The ±20 min magnet (L527) makes 8:30 and 9:00 impossible for Text, because 9:00 is within 20 minutes of 8:45. Every window start swallows about 5 slots.
- **Safari flicker.** The `dragleave` relatedTarget check (L475) fails because Safari gives null. The ghost is removed on every child crossing. The `.ins` also lacks `pointer-events:none`.
- **Dragging from inside the detail panel.** The panel is a child of the `draggable` card. Select and text interactions can start a card drag.
- **Listener leak.** `renderBoard` adds document click and keydown listeners every render (L414-415, duplicating L625-626).
- **`dragType` can throw.** It returns `undefined` type for an unknown READY id, and then `WIN[dt.type]` throws.

**Layout**
- **Cascade pushes cards off their times.** L499 does `max(yOf, bottom+3)` with about 38px cards, against 11px per 15 min at H≈600. The standard Mon 8:30/8:30/8:45/9:00 cluster drifts to roughly 10:30, so labels, gutter and hour lines disagree, and late clusters overflow the column bottom.
- **Ghost covers cards.** The 30px ghost (z-index 5) sits above existing cards, and nothing blocks dropping on an occupied time.
- **Panel positioning.** The 300px `.detail` flips only for `i>=4`. It clips at the viewport edge below ~1000px, and it can hang below the column on late cards.
- **Narrow screens.** At 40px + 7 columns under ~900px, cards truncate and the tag is `flex:none`.

**Dead code**
- Approve, retry and next-week handlers (L668-671) and `FAILS` are never rendered.
- `READY` and `FAILS` are in snapshots, but nothing sets `approved` true.

## Edge cases the real build must handle

- Clock ticking: cards lock mid-drag or while the panel is open, so validate the time server-side.
- Timezone, DST and the "usual windows" being per-account config.
- Optimistic update plus rollback on server rejection, and concurrent edits by two users.
- Booked or approved post moved, removed or reset: the post must go back to READY and the approval state must be defined.
- Standard-week edits versus already-materialized weeks: define propagation, and compute "Edited" with a canonical sort (t, type, series).
- Stable IDs for every handler (never an array index `k`).
- Multiple cards at one time: lane layout with a min height, not a cascade. Late cards must stay inside the column.
- Same-type conflicts (one per window, one Story per series) enforced in the model, not the UI.
- LFD invariant enforced in one domain function used by drag, Move-to, Ready and gap fixes.
- Drop on the same spot, outside a column, on a folded day or on a past time: all should be no-ops with feedback.
- A stale `ins` and `dataset.t/idx` should not live on the DOM. Keep ephemeral drag state in one store.
- Escape-to-cancel drag, and a cancelled drag restoring the empty-state hint.
- HTML escaping of post titles (innerHTML is used).
- Touch: HTML5 DnD is not reliable, so use pointer events or dnd-kit plus a long-press.
- Keyboard: focusable cards (role=button), a move-to-day plus time picker, arrow-key nudge by 15 min, `aria-live` toasts, dialog focus trap and restore, panel Escape returning focus, Trial/Main not conveyed by color or dash alone, gutter labels hidden from AT.
- Performance: dragover should be rAF-throttled, with cached geometry instead of `clientHeight` and `querySelectorAll` per event. Re-render only the affected days (memoized columns).

## Top 5 to design for

1. One domain layer (`canPlace`, `place`, `move`, `remove`) with all invariants (LFD, window or series uniqueness, now-lock, booked handling) used by every entry point (drag, Move-to, Ready, gap fixes, Reset).
2. Stable IDs plus a command-based history (undo and redo scoped per tab, "make it every" included) and a canonical edited-diff.
3. A booked or approved post lifecycle: a move, remove or reset returns the post to READY and keeps the approval state defined.
4. Overlap-safe time layout (lanes or collision groups, a min card height, honest time-to-pixel mapping) with the ghost, snap and "now" line.
5. Input parity: pointer/touch drag plus a keyboard and screen-reader path (a move dialog with day and time), with a focus-managed detail panel.
