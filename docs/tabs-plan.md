# pdf-flex — Tabs plan

Work on several documents at once, each in its own tab inside the app. A tab is one document. A new tab shows the start screen (Open PDF…, drop a file, Continue where you left off); opening a PDF or a draft there turns it into that document's tab. A **+** after the last tab adds a new one.

The earlier plans ([mvp-plan.md](mvp-plan.md), [toolbox-plan.md](toolbox-plan.md), [drafts-plan.md](drafts-plan.md)) still apply.

---

## 1. How big is this?

**Medium–large, moderate risk.** The app was built around one open document, and that assumption sits in its two central pieces:

| Where | Per document today | Shared today, stays shared |
|---|---|---|
| `editor.tsx` (630 lines) | Placements, selection, text being edited, undo history, page sizes, "downloaded" state | Signature library, active tool, last panel tool, text and shape styles, New signature dialog |
| `App.tsx` (480 lines) | The open file and its pdf.js document, zoom, current page, draft and restore offer, open-time warnings, saving state | Error banner, About, drag-and-drop, keyboard handling |
| `autosave.ts` | Everything (one draft at a time) | The on/off switch |
| `Viewer.tsx` | Scroll position, rendered pages | — |

Nothing in the PDF writing (`pdf-stamp`, WASM) or the page geometry changes. The risk is in the refactor: undo, selection, editing text and autosave all have to keep working per tab, and the editor has no automated tests of its own (its pure parts do). That's why chunk 1 changes the structure **with no visible change**, so it can be checked on its own before tabs appear.

Rough size: four chunks, comparable to the drafts work plus the tool rework.

---

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Where's the tab bar? | A row **above** the top bar, like a browser's; the file name moved out of the top bar into the tab |
| 2 | Open PDF… (or a drop) while on a document's tab | Opens in a **new** tab, after the current one. In an empty tab, it fills that tab |
| 3 | Opening a document that's already open in a tab | Switches to that tab (documents are recognised by their contents, as drafts are). This also removes drafts' "two tabs, one draft" problem |
| 4 | Closing a tab | Its draft stays (as when closing the browser tab today). Asks first only if the work isn't safely in a draft. The last tab closing leaves one empty tab |
| 5 | Tabs after a reload or reopening the app | **The same tabs come back**, from their drafts, with the same one in front |
| 6 | What's shared between tabs | The signature library, the active tool and the styles for new text and shapes. Undo, selection and zoom are per tab |
| 7 | How many tabs | No limit. Each open tab keeps its PDF in memory; only the active tab's pages are rendered |

---

## 3. Roadmap

**Status key:** ✅ done · 🔜 next · ⬜ not started

| # | Chunk | Done when | Status |
|---|---|---|---|
| 1 | Document sessions | Everything works exactly as before, with the per-document state in a session object | ✅ (pending your check) |
| 2 | Tab bar | Open several PDFs in tabs, switch, close, add with +; each keeps its items, undo, selection, zoom and page | ✅ (pending your check) |
| 3 | Tabs and drafts | Every tab autosaves; the start screen marks drafts already open; tabs come back after a reload | ✅ (pending your check) |
| 4 | Polish | Long tab rows scroll; middle-click closes; keyboard switching; narrow screens | ✅ (pending your check) |

### Chunk 1: Document sessions (no visible change)
- **`session.ts`:** `createSession(file)` holds one document's state: the file and pdf.js document, placements, selection, text edit, undo history, page sizes, downloaded state, zoom, current page, scroll position, draft identity, restore offer, open-time warnings, and its own autosave.
- **The editor splits in two:** the shared part (library, tool, styles) stays in the editor; the per-document part moves to the session. `useEditor()` keeps its current shape and forwards document calls to the **active session**, so the panels, overlay and status bar don't change. This is the main risk: every forwarded call is checked by the existing manual checks.
- **`App.tsx`** holds an `activeSession` signal instead of the separate file, zoom, page, draft and offer signals.
- **Tests:** the session's pure parts (undo per session, independent selections) get unit tests where they can run without a browser.
- **Done when:** every check from the toolbox and drafts plans still passes, with one document as today.

### Chunk 2: Tab bar
- **`TabBar.tsx`:** one tab per session: the file name (ellipsised, full name on hover), a dot for "not safely saved", and ×. **+** after the last tab adds an empty tab and switches to it.
- **Empty tab:** the start screen as it is now.
- **Switching** shows the tab's document as it was left: items, selection, undo history, zoom, page and scroll position. The viewer of an inactive tab is unmounted (its pages stop rendering, freeing memory) and its position is restored on return.
- **Opening** follows decisions 2 and 3. Drag-and-drop of several PDFs opens one tab each.
- **Closing** follows decision 4. Closing the active tab switches to its neighbour.
- **Window title:** "name — pdf-flex", so the browser tab and the taskbar say which document is in front.

### Chunk 3: Tabs and drafts
- Each session autosaves its own draft, in the background, whichever tab is active.
- **Start screen:** drafts already open in a tab are marked "Open" and switch to that tab instead of opening it twice.
- **Reopening tabs** (decision 5): the list of open tabs (by document id) and the active one are remembered; on start, tabs come back from their drafts, lazily (a tab's PDF loads when it's first shown). A tab whose draft was discarded is skipped.
- **Leaving the app** warns only if any tab's work isn't safely in a draft.

### Chunk 4: Polish
- More tabs than fit: the tab row scrolls sideways, keeping the active tab in view.
- Middle-click closes a tab.
- **Keyboard:** browsers keep Ctrl+Tab, Ctrl+T and Ctrl+W for themselves, so: **Alt+1…9** to jump to a tab, **Alt+←/→** for the previous/next one. (In the installed app, Ctrl+Tab may be available too; tested then.)
- **Narrow screens:** tabs shrink to their first letters and a dot, with the full name in the tooltip.
- Reordering tabs by dragging: later, if wanted.

### As built: chunks 1–4
Built in one go, with chunks 1 and 2 together rather than the refactor first on its own, since the tab bar was the best way to exercise it.
- **`docState.ts`:** `DocState`, one document's editing state (placements, selection, text being edited, undo history and its version, page sizes, next item id, what was last downloaded), with `createDocState`, `snapshotOf` and `isDirty`. It's plain TypeScript, so it's unit-tested.
- **Editor:** keeps the shared state (library, active signature, tool, last panel tool, styles, the New signature dialog) and an active `DocState`. Every per-document call works on the active one, so components are unchanged. `activate(doc)` switches, finishing any text edit on the previous document first. `restoreDraft`, `usedSignatures` and `markSaved` take a document, so they work on tabs that aren't in front.
- **`tabs.ts`:** `DocSession`: a tab's file, pdf.js document, `DocState`, its own autosave, zoom, page, scroll position, restore offer, open-time warning and saving state, in its own reactive root (`dispose` stops its autosave and frees its PDF). `Tab` is `{ key, session }`, `session: null` for an empty tab, or `pending` for a tab brought back after a reload whose PDF loads when first shown.
- **`TabBar.tsx`:** above the top bar. Each tab: the name (ellipsised; full name and Alt+N in the tooltip), an amber dot while its work isn't safely in a draft, ×. **+** adds an empty tab. Middle-click closes. The row scrolls sideways when full, keeping the active tab in view. Below 640 px tabs shrink further.
- **Opening:** Open PDF… now takes several files, and dropping several PDFs opens one tab each. A document already open (or waiting to reopen) in a tab comes to the front instead. The start screen marks drafts open in a tab ("open in a tab"), opening them switches to it, and their × is disabled until the tab is closed.
- **Switching** unmounts the inactive document's viewer (its pages stop rendering) and brings it back at its zoom and scroll position. Undo, selection, the restore offer and open-time warnings are per tab; the tool and styles are shared.
- **Closing:** its draft stays; it asks first only if the work isn't safely in a draft. Closing the last tab leaves an empty one.
- **Leaving the app:** every tab's waiting draft is saved when the app is hidden or closed; the warning appears only if some tab's work isn't safe.
- **Reopening:** the open tabs (by document id) and the one in front are remembered in `localStorage` (`pdf-flex:tabs`). On start, those with a draft come back; the front one loads straight away, the others when first shown. A tab whose draft is gone becomes empty, with a message. (With drafts turned off, new documents have no draft, so they don't come back.)
- **Window title:** "name — pdf-flex".
- **One empty tab at most, always last** (after review): document tabs keep their order and the empty tab (the start screen) sits after them; **+** is disabled while it exists. Every change to the tabs goes through `arrangeTabs`, so the rule holds however a tab ends up empty. With no documents open, the empty tab can't be closed.
- **No Open PDF… in the top bar** (removed after review): + then the start screen's Open PDF…, dropping files, or **Ctrl/Cmd+O** (opens into a new tab unless the one in front is empty).
- **Keyboard:** **Alt+1…9** jumps to a tab, **Alt+[** / **Alt+]** steps back and forward. Changed from Alt+←/→ in the plan: browsers use those for Back and Forward, which would leave the app.
- **Tests:** 2 new (separate state per document; tab names and what's remembered): 78 web tests. Typecheck, build and lint pass.
- **Your checks:**
  1. Open a PDF: it fills the empty tab. Open two more (Open PDF… with several selected, or drop several): each gets a tab after the current one.
  2. Place different items in each, select something, zoom and scroll differently; switch around: each tab is as you left it, including undo history.
  3. Open a PDF that's already in a tab: that tab comes to the front.
  4. + then Open PDF…: the new empty tab is filled. Close tabs with × and middle-click; closing the last leaves an empty tab.
  5. Edit text in one tab and switch mid-edit: the edit is finished and undoes in its own tab.
  6. Reload: the same tabs come back with the same one in front; the others load when you click them. The start screen marks drafts that are open in a tab.
  7. Alt+1…9 and Alt+[ / Alt+]. Many tabs: the row scrolls. Narrow window.
  8. Download from a tab that isn't the first: the right document, named after it.

### After review: one top row, and tab mode
- **One row at the top** (the tab bar and the top bar merged, saving about 40 px): tabs on the left, then undo, redo and Download on the right. Tabs are rounded and the active one is white. The active tab is the document's header, so the separate document title only shows with tabs off.
- **Page and zoom moved to the status bar**, on the right before Settings: `Page 2/5 │ − 100% + Fit`. Clicking the percentage goes back to 100%. On narrow screens "Page" and Fit are hidden.
- **Tab mode** (Settings → Tabs → "Open documents in tabs", on by default, remembered as `pdf-flex:tabs-mode`):
  - **Off:** no tab bar. The top row shows the document title, with **×** to close it (its draft is kept) and go back to the start screen. Opening another document (Ctrl+O, drop, or a draft) replaces the current one, asking first only if its work isn't safely in a draft. Several files at once: only the first opens, with a message. Alt+1…9 and Alt+[ ] do nothing. After a reload, only the document that was in front comes back.
  - **Switching off** with several open: the tab in front stays, the rest close (drafts kept), asking first if any has unsaved work. Cancelling leaves tabs on.
  - **Switching on:** the current document becomes the first tab.
- **Your checks:**
  1. With tabs on: one row at the top; page and zoom at the bottom right.
  2. Settings → turn tabs off with two documents open, one with changes not yet saved: it asks; cancel keeps tabs. Confirm: one document left, its title at the top with ×.
  3. With tabs off: open another PDF (it replaces the current one), drop two PDFs (only the first opens, with a message), close with ×, reload (only that document comes back).
  4. Turn tabs back on: the document is a tab, + is available.

---

## 4. Blind spots

- **Memory:** every open tab keeps its PDF bytes and pdf.js document. Ten 20 MB scans is 200 MB plus pdf.js's own use. Only the active tab renders pages; if this bites, inactive tabs can release their pdf.js document and reload it from the draft on return.
- **Forwarding mistakes:** a component reading per-document state directly instead of through the active session would show the wrong tab's data. Keep all document state behind the session.
- **Background work:** an open-time check (`inspect`) or a save finishing after its tab was closed or switched must land in its own session, not the active one. Every async step carries its session.
- **Keyboard shortcuts** act on the active tab only; global ones (tools) stay global.
- **Undo across tabs:** each tab's undo is its own; there's no app-wide undo, which matches how browsers and editors behave.
