# pdf-flex — Reorder pages plan

Drag pages in the Pages panel to put them in a new order. A small follow-up to the [pages plan](pages-plan.md): the page list already supports moving pages (`movePages`, with items following their page and one undo step per move). What was missing is the UI.

---

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Drag mechanism | **Pointer events**, not HTML drag and drop. HTML drag and drop doesn't work on touch, and the list already uses it for dropping PDF files, which this must not disturb |
| 2 | What gets dragged | A **selected** page drags the whole selection, which stays in its order. Any other page drags just itself and becomes the selection |
| 3 | Where it goes | The same line as dropping PDFs: the gap nearest the pointer (`gapAt`), then `movePages(pages, gap)` |
| 4 | Starting a drag | After the pointer moves 4 px (mouse or pen). **On touch, after a 350 ms long press**, so a swipe still scrolls the panel |
| 5 | Keyboard | **Alt+↑ / Alt+↓** move the selected pages one step (`stepAt`) |
| 6 | Cancelling | Escape during a drag, or the browser cancelling the pointer, puts nothing anywhere |

## 2. Roadmap

| # | Chunk | Done when | Status |
|---|---|---|---|
| 1 | Drag and keyboard reorder | Pages move by drag (mouse and touch) and Alt+arrows; items follow; one undo step | ✅ (pending your check) |

### Chunk 1: Drag and keyboard reorder

**As built**
- **`PagesPanel.tsx`, `onPagePointerDown`:**
  - Listens on `window` for the rest of the gesture.
  - Shows the drop line (`dropAt`, shared with PDF drops). The dragged pages fade (`.page-item.dragging`), and the ＋ buttons hide while dragging.
  - The panel scrolls when the pointer is within 40 px of its top or bottom.
  - The click that ends a drag doesn't select. The browser's own image drag is suppressed.
- **Touch:**
  - Thumbnails have `touch-action: pan-y`, so a swipe scrolls.
  - After the long press, a non-passive `touchmove` listener stops the panel scrolling under the finger.
- **`pages.ts`:** `stepAt(pages, count, ±1)`, where Alt+arrows put the selection: just before the page before it, or just after the page after it. It's tested. Moves that change nothing make no undo step (`editor.movePages` already checks).
- **Status bar hint:** "Drag (or Alt+↑↓) to move".
- **Verified (no browser):** `just test` (Rust, plus 120 web tests with 1 new), `just lint` and `just build` pass.

**Your checks**
1. Drag a page to the start, the middle and the end. The line shows where it'll go, and the document's pages follow. Items on the page move with it. Ctrl+Z undoes the move in one step.
2. Select three pages (Ctrl+click, non-adjacent), then drag one of them: all three move together, in their order.
3. Drag an unselected page: only it moves, and it becomes the selection.
4. In a long document, drag near the panel's bottom or top edge: it scrolls.
5. Escape during a drag: nothing moves. A plain click still selects and scrolls to the page.
6. Alt+↑ / Alt+↓ with pages selected: they move one step, and stop at the ends.
7. Dropping a PDF file between thumbnails still inserts it.
8. **Touch (the riskiest):** a swipe scrolls the panel; a long press then drag moves the page, and the panel doesn't scroll under the finger. If the browser cancels the drag as soon as you move, the fix is to make the thumbnails `touch-action: none` and scroll the panel some other way.
9. Download after reordering: pages are in the new order, with items where they were placed.
