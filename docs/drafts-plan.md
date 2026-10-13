# pdf-flex — Drafts plan

Keep work in progress safe. Today everything placed on a document lives only in the open tab: closing it (after the warning), a crash, a reload or a browser update loses it, and the only way to keep work is to download the finished PDF, which can't be edited again in pdf-flex.

The ground rules from [mvp-plan.md](mvp-plan.md) and [toolbox-plan.md](toolbox-plan.md) still apply: everything stays on the device, nothing is uploaded.

---

## 1. Options, by difficulty

| # | Option | Difficulty | Protects against | Limits |
|---|---|---|---|---|
| A | **Autosave drafts in the browser** (IndexedDB): the PDF and everything placed on it, saved as you work; reopen from a "Recent" list or by opening the same file again | Easy–medium | Closed tabs, crashes, reloads, coming back days later | Only in this browser on this device; browsers can evict storage (Safari: after 7 days without use, unless installed) |
| B | **Project file** (`.pdfflex`): download the PDF plus all items as one file, open it again later | Easy–medium | Everything A does, plus storage eviction, other devices and browsers, backups | Manual: you have to remember to save it |
| C | **Editable PDF**: the downloaded PDF carries its own pdf-flex data, so reopening it in pdf-flex brings the items back as editable | Hard | Same as B, with one file instead of two | Another tool that rewrites the PDF drops the data (it opens as a plain PDF). Needs incremental saving in `pdf-stamp` |
| — | Save over the original file (File System Access API) | Medium | Nothing on its own: a convenience on top of B or C | Chromium only |
| — | Sync between devices | — | — | Needs a server that stores documents: against the app's design. Not considered |

**Recommendation:** A first, since it covers the most common losses with no effort from the user. Then B, as the backup and portability A can't give. C is the nicest result but the most work and risk; decide after living with A and B.

---

## 2. Decisions

| # | Question | Decision |
|---|---|---|
| 1 | What identifies a document? | The **SHA-256 of its original bytes** (`crypto.subtle.digest`). Opening the same file again finds its draft, whatever its name or folder |
| 2 | What's in a draft? | The original PDF (a Blob), its name, the placements, a copy of each signature image used, and timestamps. Not the undo history |
| 3 | When is it saved? | 1 s after the last change (typing included, not only finished edits), and immediately when the tab is hidden or closed |
| 4 | When is it deleted? | Only when the user discards it. A download doesn't end a draft: you may keep working |
| 5 | Drafts on by default? | **On**, with a visible "Saved in this browser" status and an off switch in About, since PDFs (often personal) now stay in browser storage on this device |
| 6 | Old drafts | **Kept until discarded**; the Recent list shows their age and size |
| 8 | Scope | **Option A (chunks 1–3) now.** B and C stay in the plan for later |
| 7 | Signatures deleted from the library | A draft keeps its own copy of each signature it uses, so it always restores. On restore, a missing signature is added back to the library |

---

## 3. Roadmap

**Status key:** ✅ done · 🔜 next · ⬜ not started

| # | Chunk | Done when | Status |
|---|---|---|---|
| 1 | Shared database and document identity | Signatures still load after the database upgrade; a document's hash is computed on open | ✅ (pending your check) |
| 2 | Autosave and restore | Close the tab mid-work, open the same PDF again, and everything is back | ✅ (pending your check) |
| 3 | Recent drafts | The empty screen lists drafts; open one without picking the file; discard one | ✅ (pending your check) |
| 4 | Project file | Save a `.pdfflex`, open it in another browser, and everything is back | ⬜ |
| 5 | Editable PDF (optional) | A downloaded PDF reopened in pdf-flex offers to continue editing; in other viewers it's an ordinary PDF | ⬜ |

### Chunk 1: Shared database and document identity
- `web/src/db.ts`: one place that opens the `pdf-flex` IndexedDB with versioned upgrades. Version 2 adds a `drafts` store (key: document hash); `signatures` is unchanged, so existing libraries survive. `signatureStore.ts` uses it.
- `documentId(bytes)`: SHA-256, hex.
- **Tests:** the upgrade from version 1 keeps signatures (run against `fake-indexeddb` in `bun test`, or a hand-rolled check if adding a dev dependency isn't wanted); hashing is stable.

### Chunk 2: Autosave and restore
- `draftStore.ts`: `put`, `get(id)`, `list()` (without PDF bytes), `remove(id)`.
- **Saving:** the editor's placements are watched; 1 s after the last change the draft is written (placements, used signature PNGs, `savedAt`). Flushed on `visibilitychange` (hidden) and `pagehide`. The original PDF is written once per draft, not on every save.
- **Restoring:** opening a PDF whose hash has a draft shows a banner: "You have unsaved work on this document from 14:32. **Restore** · Start over". Start over keeps the old draft until the first new change replaces it, so a misclick can be undone by reloading.
- **Status bar:** "Saved in this browser · 14:32" next to Unsaved changes / Downloaded. On failure (quota, private mode): "Couldn't save a draft" with the reason, and the close-tab warning stays the safety net.
- `navigator.storage.persist()` requested on the first draft, as for signatures.
- **Tests:** draft round trip (placements of every kind, signature copies), debounce and flush logic as pure functions.

### Chunk 3: Recent drafts
- The empty screen lists drafts: name, pages, items, last saved, size. Click to open (the PDF comes from the draft, no file picker); × to discard (with confirmation).
- **About** gains "Drafts are kept in this browser on this device" and **Delete all drafts**.
- If decision 5 lands on an off switch: it lives here and in About.

### As built: chunks 1–3
- **`db.ts`:** opens the `pdf-flex` database at version 2. The upgrade only adds what each version introduced (v1 `signatures`, v2 `drafts` and `draftFiles`), so existing signature libraries are kept. A tab still holding version 1 lets go when another tab upgrades. `runAll` writes to several stores in one transaction. `documentId` is the SHA-256 of the bytes. `signatureStore.ts` now uses it.
- **`draftStore.ts`:** a draft record (name, page count, size, placements, copies of the signatures used, `createdAt`, `savedAt`, `version: 1`), with its PDF in `draftFiles`, written only on the first save. `usablePlacements` leaves out kinds this version doesn't know.
- **`autosave.ts`:** watches the placements; saves 1 s after the last change (typing included); flushes when the tab is hidden or closed, and before another document opens. Quota errors read "the browser's storage is full". On by default; the switch is remembered in `localStorage` (`pdf-flex:drafts`).
- **Opening:** a PDF with a draft shows "You have unsaved work on this document from 14:32 (3 items). **Restore** · Start over". Placing anything instead also starts over, and the first change replaces the old draft. Restoring puts back signatures that have left the library, and new items never reuse restored ids.
- **Leaving:** the close-tab and open-another warnings now only appear when work isn't safely in a draft (drafts off, a save failed, or the last second of changes isn't written yet).
- **Status bar:** "Saving…", "Saved in this browser · 14:32", or "Couldn't save a draft: …"; "Downloaded" alongside once downloaded. With drafts off, it shows Unsaved changes / Downloaded as before.
- **Empty screen:** "Continue where you left off": each draft's name, items, pages, size and when it was saved; click to open it straight from storage (restored without asking); × to discard, after confirming.
- **About:** what drafts are and where they live, **Keep drafts of my work in this browser** (on), and **Delete all drafts**.
- **Tests:** 5 new (document identity, summaries, unknown kinds, time and size formats): 67 web tests. The database upgrade and the save timing run in the browser only, so they're in your checks rather than automated (no IndexedDB in `bun test` without adding `fake-indexeddb`).
- **Known limits:** the drafts list is only on the empty screen (reload, or open the file, to get back to another draft). Two tabs on the same document both save to its draft; the last write wins.
- **Your checks:**
  1. Reload after updating: your signature library is still there (the database upgrade).
  2. Place a few items of each kind, wait a second (status: Saved in this browser), close the tab: no warning. Reopen the app: the draft is listed; click it and everything is back, including text mid-edit if you closed while typing.
  3. Open the same PDF with Open PDF… instead: the Restore banner appears. Try Restore, and Start over.
  4. With a draft that uses a signature, open a different PDF and delete that signature from the library there. Then open the draft: the signature is back in the library and on the page.
  5. Discard a draft from the list; in About, delete all drafts; turn drafts off and check the old warnings come back.

### Chunk 4: Project file
- **Save project** (top bar, next to Download) writes `<name>.pdfflex`: JSON with the original PDF and signature PNGs base64-encoded, the placements, and a format name and version (like the signature library export). Base64 adds about a third to the size; acceptable for documents of a few MB.
- **Opening:** the Open button and drag-and-drop accept `.pdfflex` as well as PDFs. The project becomes a draft as if it had been worked on here; signatures missing from the library are added.
- Older or newer format versions are refused with a clear message.
- **Tests:** round trip; refusing other JSON and unknown versions.

### Chunk 5: Editable PDF (optional, decide after chunk 4)
- `pdf-stamp` gains **incremental saving**: the stamp is appended as an update to the original file, so the original bytes are still the start of the output (already a later idea in the MVP plan: it also keeps existing digital signatures valid for the revision they signed).
- The pdf-flex data (placements and signature images, as in chunk 4) is stored in the new revision as an embedded file, `pdf-flex.json`.
- **Opening** a PDF with that data offers "This PDF was made with pdf-flex. **Continue editing** · Open as is". Continue editing cuts the file back to the original revision and restores the items.
- **Limits:** files that needed xref repair can't be saved incrementally; they get a full rewrite and no embedded data. Any other tool that rewrites the file (print to PDF, "optimise", some editors) drops the data, and the file simply opens as a plain PDF. Must be tested against the corpus and in Acrobat, Preview and Chrome.

---

## 4. Blind spots

- **Storage limits:** browsers allow a share of free disk space, usually ample, but a few large scanned PDFs add up. Show sizes in the Recent list, and handle quota errors on save without losing the session.
- **Eviction:** Safari deletes storage of sites not installed after 7 days without use; any browser may evict under pressure unless storage is persistent. Drafts are a safety net, not an archive: the project file (chunk 4) is the durable copy.
- **Privacy:** drafts put whole PDFs into browser storage. On a shared computer that matters. Say so in About, and make deleting all drafts one click (and see decision 5).
- **Two tabs on the same document:** both would autosave the same draft. Last write wins; a `BroadcastChannel` notice ("This document is open in another tab") is a cheap mitigation.
- **Schema changes:** placements will grow new kinds and fields. Drafts and project files carry a version, and restoring ignores what it doesn't understand rather than failing.
