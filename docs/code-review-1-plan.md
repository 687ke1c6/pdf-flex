# pdf-flex — Code review 1 plan

Findings from `/code-review` on the autosave save-loop rewrite (uncommitted: `web/src/drafts/autosave.ts`, `web/src/drafts/autosave.test.ts`, `justfile`, `web/package.json`). Each one below has what's wrong, whether it holds up, a proposed fix and space for the decision.

**Status key:** ✅ done · 🔜 next · ⬜ not started · ❓ needs a decision

---

## 1. Summary

| # | Finding | Severity | Holds up? | Proposed fix | Status |
|---|---|---|---|---|---|
| 1 | `running` is shared across documents | High in theory, latent today | Yes, but `tabs.ts` never changes `doc` | Make `doc` fixed (option A) | ✅ |
| 2 | Back-to-back saves skip the 1 s wait | Medium | Yes | Timer saves once; a finished save restarts the wait; only `flush()` loops | ✅ |
| 3 | `flush()` can block open/close forever | Medium | Yes (it got worse, wasn't new) | Cap how long `flush()` waits (option A) | ✅ |
| 4 | No retry after a failure that absorbed an edit | Medium | Yes | Fixed by #2: a finished save, failed or not, restarts the wait if the document changed | ✅ |
| 5 | Turning drafts back on doesn't save | Low | Yes | Track `draftsEnabled` in the effect that schedules saves | ✅ |
| 6 | `.resolves` assertion not awaited | Low (test) | Yes | `await expect(...)` | ✅ |
| 7 | `flush()` retries a failed save on every tab hide | Low | Yes | Don't retry the version that just failed until it changes | ✅ (with #2) |
| 8 | `--conditions browser` written in two places | Low | Yes | `just test` runs `bun run test` | ✅ |

---

## 2. Findings

### 1. `running` is shared across documents
`web/src/drafts/autosave.ts:111`

If the document changes while a save is running, the new document's `flush()` joins the old document's loop. That loop then exits (`source.doc() !== doc`) and the new document's change is never saved. `saving()` also shows the old document's save as the new one's.

**Holds up?** Yes, for the `Source` interface as written. But `tabs.ts:91` passes `doc: () => draftDoc`, a constant: each tab gets its own autosave, and `doc` never changes. So the bug can't happen in the app today.

**Options:**
- **A. Make `doc` fixed** (recommended). `createAutosave` takes the `DraftDocument` directly, not a getter. That drops the "new document" effect, the document check in the loop and the last test, and the bug can't be written at all.
- **B. Keep `doc` changeable** and tie `running` and `saving` to the document they belong to.

**Decision:** A. `createAutosave(doc, source, store?)` takes the document itself, and `tabs.ts` passes its `draftDoc`. The "new document" effect, the document checks in the save loop and their test are gone. ✅

### 2. Back-to-back saves skip the 1 s wait
`web/src/drafts/autosave.ts:121`

During a long drag, `version` changes on every pointer move. Once one save is running, the `while` loop starts the next as soon as each finishes, so IndexedDB is written continuously, not once after the edits pause.

**Holds up?** Yes. The loop is the right shape for `flush()` (it has to catch up now), not for the timer.

**Fix:**
- The timer starts one save. If a save is already running, it does nothing.
- When a save finishes and the document has changed since it started, restart the 1 s wait. So during a drag there's at most one save per pause, and nothing ever overlaps.
- `flush()` cancels the wait and keeps saving until storage matches, as it does now.
- **Test:** edits every 100 ms for 5 s give one save, not dozens.

**Decision:** Go ahead (keep autosave rather than saving only on close or on a Save button). Done: `schedule()` (re)starts the wait, `save()` writes once or joins the running write and restarts the wait afterwards, and `flush()` loops. Tests: edit during a save waits for the next pause; a 5 s drag starting during a save gives one more save. ✅

### 3. `flush()` can block open/close forever
`web/src/drafts/autosave.ts:107`, called at `App.tsx:150`, `:221`, `:264`

App awaits `flush()` before replacing, opening or closing a document. If `draftStore.save` never settles (e.g. the database open blocked by another tab: `db.ts` only logs `onblocked`), those actions hang with nothing shown.

**Holds up?** Yes. The old `flush()` had the same risk whenever a save was waiting, but now it also waits for a save that's already running, so it happens more often.

**Options:**
- **A. Cap the wait** (recommended): `flush()` gives up after a few seconds (say 3 s) and returns. The draft may then be out of date, but the close-tab warning (`atRisk`) still covers that.
- **B. Leave it**, and treat a blocked database as a `db.ts` problem (reject after a timeout there).

**Decision:** A. `flush()` waits at most `FLUSH_LIMIT_MS` (3 s), then returns; the save carries on in the background and still catches the draft up if storage recovers. Nothing is lost silently: each caller asks first when the draft isn't up to date (`atRisk`), so the user has already agreed to close. Test: a stuck save releases `flush()` after 3 s, and the draft catches up once storage answers. ✅

### 4. No retry after a failure that absorbed an edit
`web/src/drafts/autosave.ts:138`

Edit v1, and its save starts. Edit v2: its timer fires during the save and joins the loop. Then v1's save fails, the loop ends, and no wait is pending, so v2 isn't retried until another edit.

**Holds up?** Yes.

**Fix:** comes with #2. A finished save, failed or not, restarts the wait if the document changed since that save started. A plain failure with no edit since doesn't retry on its own (see #7).
- **Test:** edit during a save that then fails → it saves again after the wait.

**Decision:** Fixed by #2, with that test. ✅

### 5. Turning drafts back on doesn't save
`web/src/drafts/autosave.ts:101`

The effect that schedules saves only tracks `version`. Edits made while drafts are off aren't saved when they're turned back on, until the next edit.

**Holds up?** Yes. (The old code had the same gap.)

**Fix:** have the effect track `draftsEnabled` as well, so turning drafts on schedules a save if the document differs from storage.
- **Test:** off → edit → on → saves after the wait.

**Decision:** Done. The effect tracks `[source.version, draftsEnabled]`, so turning drafts off also cancels a waiting save. Test: off → edit → on → saves after the wait. ✅

### 6. `.resolves` assertion not awaited
`web/src/drafts/autosave.test.ts:165`

**Holds up?** Yes: the assertion is never checked.

**Fix:** `await expect(autosave.flush()).resolves.toBeUndefined();`

**Decision:** Done. ✅

### 7. `flush()` retries a failed save on every tab hide
`web/src/drafts/autosave.ts:107`, via `flushAll` at `App.tsx:480`

After a quota error, each hide or tab switch writes the whole draft again, and it fails again.

**Holds up?** Yes. I flagged this behaviour change last time, but it's more wasteful than I said.

**Fix:** remember which version failed. `flush()` and the wait skip that version until the document changes. (A retry after an edit still happens, since storage may have freed up.)
- **Test:** fail, then `flush()` twice with no edit → no new writes.

**Decision:** Done with #2, which needed it: once a finished save restarts the wait, a failure would otherwise retry every second. The failed version is kept in `failed` and left out of `due()`. ✅

### 8. `--conditions browser` written in two places
`justfile:8`, `web/package.json:10`

**Holds up?** Yes.

**Fix:** `just test` runs `cd web && bun run test`, so the flag lives only in `package.json`.

**Decision:** Done. ✅

---

## 3. Your check

Once the fixes are in, after `just test`, `just lint` and `just build` pass:
- Drag a placement for several seconds: "Saving…" appears once after you let go, not throughout the drag.
- Edit, then undo before or during a save: settles on "Saved", and a reload offers the current version.
- Turn drafts off in Settings, edit, turn them back on: it saves within a second or so.
- With a storage failure forced (quota full in DevTools): the error shows; switching tabs back and forth doesn't flood the console with failed writes; undoing to the stored version clears it.
