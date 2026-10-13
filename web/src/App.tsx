import { batch, createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { documentId } from "./db";
import { download } from "./download";
import { DownloadButton, DownloadDialog } from "./DownloadDialog";
import { draftStore, formatSavedAt, usablePlacements, type Draft } from "./draftStore";
import { createDocState, SIGNATURE_DRAG_TYPE, useEditor } from "./editor";
import { openPdf } from "./pdf";
import { Sidebar } from "./Sidebar";
import { QuickBar, toolForKey } from "./ToolRail";
import { StatusBar } from "./StatusBar";
import { inspectPdf, sameLayout, stampPdf } from "./stamper";
import { clampZoom, stepZoom } from "./zoom";
import { UpdatePrompt } from "./pwa";
import { SettingsDialog } from "./SettingsDialog";
import { NewSignatureDialog } from "./NewSignatureDialog";
import { RecentDrafts } from "./RecentDrafts";
import { TabBar } from "./TabBar";
import {
  createSession,
  arrangeTabs,
  docTab,
  emptyTab,
  isEmptyTab,
  pendingTab,
  savedTabs,
  saveTabs,
  tabDocId,
  type DocSession,
  type Tab,
} from "./tabs";
import { Viewer, type ViewerApi } from "./Viewer";

export function App() {
  const editor = useEditor();
  const first = emptyTab();
  const [tabs, setTabList] = createSignal<Tab[]>([first]);
  const [activeKey, setActiveKey] = createSignal(first.key);
  /**
   * Every change to the tabs keeps the rule: at most one empty tab, always the
   * last one. If the tab in front goes, the empty tab takes its place in front.
   */
  const setTabs = (next: Tab[] | ((list: Tab[]) => Tab[])) => {
    const list = arrangeTabs(typeof next === "function" ? next(tabs()) : next, activeKey());
    setTabList(list);
    if (!list.some((t) => t.key === activeKey())) setActiveKey(list.find(isEmptyTab)?.key ?? list[0].key);
  };
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [dragging, setDragging] = createSignal(false);
  const [settings, setSettings] = createSignal(false);
  /** The download dialog is open (asking for a file name). */
  const [naming, setNaming] = createSignal(false);
  let viewer: ViewerApi | undefined;
  let fileInput!: HTMLInputElement;

  const activeTab = () => tabs().find((t) => t.key === activeKey()) ?? tabs()[0];
  /** The document in front, if its tab has one. */
  const active = () => activeTab()?.session ?? null;
  const sessions = () => tabs().flatMap((t) => (t.session ? [t.session] : []));

  // The editor works on the document in front; an empty tab gets a blank state.
  const blank = createDocState([]);
  createEffect(() => editor.activate(active()?.state ?? blank));

  // The browser tab (and the installed app's window) says which document is in front.
  createEffect(() => {
    const s = active();
    document.title = s ? `${s.name} — pdf-flex` : "pdf-flex";
  });

  // Remember the open tabs, to bring them back after a reload.
  let restored = false;
  createEffect(() => {
    const list = tabs();
    const key = activeKey();
    if (restored) saveTabs(list, key);
  });

  /** Replaces one tab, keeping its place. */
  const replaceTab = (key: number, next: Tab) => setTabs((list) => list.map((t) => (t.key === key ? next : t)));

  async function restore(session: DocSession, draft: Draft) {
    session.setOffer(null);
    await editor.restoreDraft(usablePlacements(draft), draft.signatures, session.state);
  }

  /** In the background: warns now, not at save time, if this PDF can't be edited. */
  function inspect(session: DocSession) {
    inspectPdf(session.bytes).then(
      ({ pages, digitallySigned }) => {
        const warnings = [];
        if (digitallySigned)
          warnings.push("This PDF is digitally signed. Saving changes to it will make the existing digital signature invalid.");
        if (!sameLayout(session.pdf.pages, pages))
          warnings.push("This PDF's page layout is unusual, so items may not land exactly where you place them. Check the downloaded file.");
        session.setWarning(warnings.join(" "));
      },
      (err) => session.setWarning(`You can view this PDF, but not edit it. ${err instanceof Error ? err.message : err}`),
    );
  }

  /**
   * Makes a session for a PDF. If it has a draft, that's offered for restoring,
   * or restored straight away with `resume` (picked from the drafts list, or a
   * tab coming back after a reload).
   */
  async function sessionFor(id: string, name: string, bytes: Uint8Array, resume: boolean): Promise<DocSession> {
    const pdf = await openPdf(bytes);
    const draft = await draftStore.get(id).catch(() => undefined);
    const session = createSession({ id, name: draft?.name ?? name, bytes, pdf, draft }, editor);
    if (draft?.placements.length) {
      if (resume) await restore(session, draft);
      else session.setOffer(draft);
    }
    inspect(session);
    return session;
  }

  /**
   * Opens a PDF in a tab: the empty tab in front, or a new one after it. A
   * document that's already open just comes to the front.
   */
  async function open(name: string, bytes: Uint8Array, resume = false) {
    setError("");
    setLoading(true);
    try {
      const id = await documentId(bytes);
      const existing = tabs().find((t) => tabDocId(t) === id);
      if (existing) {
        await show(existing.key);
        return;
      }
      const session = await sessionFor(id, name, bytes, resume);
      const here = activeTab();
      const tab = docTab(session);
      // The tab list and the tab in front change together.
      batch(() => {
        if (here && isEmptyTab(here)) replaceTab(here.key, tab);
        else
          setTabs((list) => {
            const at = list.findIndex((t) => t.key === activeKey());
            return [...list.slice(0, at + 1), tab, ...list.slice(at + 1)];
          });
        setActiveKey(tab.key);
      });
    } catch (err) {
      setError(`Couldn't open ${name}: ${err instanceof Error ? err.message : err}`);
    } finally {
      setLoading(false);
    }
  }

  /** Brings a tab to the front, loading its document if it came back after a reload. */
  async function show(key: number) {
    setActiveKey(key);
    const tab = tabs().find((t) => t.key === key);
    if (!tab?.pending) return;
    const { id, name } = tab.pending;
    setLoading(true);
    try {
      const bytes = await draftStore.pdf(id).catch(() => undefined);
      if (!bytes) throw new Error("its saved copy is no longer in this browser");
      const session = await sessionFor(id, name, bytes, true);
      // The tab may have been closed while loading.
      if (tabs().some((t) => t.key === key)) replaceTab(key, { key, session });
      else session.dispose();
    } catch (err) {
      setError(`Couldn't reopen ${name}: ${err instanceof Error ? err.message : err}`);
      if (tabs().some((t) => t.key === key)) replaceTab(key, { key, session: null });
    } finally {
      setLoading(false);
    }
  }

  /** Brings the empty tab to the front, adding it if there isn't one. */
  function newTab() {
    const existing = tabs().find(isEmptyTab);
    if (existing) return setActiveKey(existing.key);
    const tab = emptyTab();
    batch(() => {
      setTabs((list) => [...list, tab]);
      setActiveKey(tab.key);
    });
  }

  /** Closes a tab; its draft stays. Asks first only if its work isn't safely in a draft. */
  async function closeTab(key: number) {
    const list = tabs();
    const at = list.findIndex((t) => t.key === key);
    const tab = list[at];
    if (!tab) return;
    const session = tab.session;
    if (session?.atRisk() && !confirm(`Your changes to ${session.name} haven't been downloaded or saved as a draft. Close it anyway?`)) return;
    await session?.autosave.flush();
    session?.dispose();
    // The empty tab is the start screen: with no documents open, it stays.
    if (isEmptyTab(tab) && list.length === 1) return;
    const rest = arrangeTabs(list.filter((t) => t.key !== key));
    batch(() => {
      if (key === activeKey()) setActiveKey(rest[Math.min(at, rest.length - 1)].key);
      setTabs(rest);
    });
  }

  const openFile = async (f: File) => open(f.name, new Uint8Array(await f.arrayBuffer()));

  async function openDraft(id: string, name: string) {
    const existing = tabs().find((t) => tabDocId(t) === id);
    if (existing) return show(existing.key);
    const bytes = await draftStore.pdf(id).catch(() => undefined);
    if (bytes) await open(name, bytes, true);
    else setError(`The saved copy of ${name} couldn't be read. Open the file itself to start again.`);
  }

  const zoomTo = (z: number) => active()?.setZoom(clampZoom(z));

  // Drag and drop anywhere in the window.
  // Chrome also reports "Files" when an <img> is dragged, so exclude our own signature drag.
  // While a dialog is open, it handles its own drops (e.g. importing a signature image).
  const isFileDrag = (e: DragEvent) => {
    const types = e.dataTransfer?.types ?? [];
    return types.includes("Files") && !types.includes(SIGNATURE_DRAG_TYPE) && !document.querySelector("dialog[open]");
  };
  // Capture phase: runs even if a drop target (e.g. a page) stops propagation.
  const endDrag = () => setDragging(false);
  function onDragOver(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setDragging(true);
  }
  function onDragLeave(e: DragEvent) {
    // Only when leaving the window, not when moving between child elements.
    if (!e.relatedTarget) setDragging(false);
  }
  async function onDrop(e: DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setDragging(false);
    const pdfs = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (!pdfs.length) setError("That doesn't look like a PDF.");
    // Each in its own tab, one after another.
    for (const f of pdfs) await openFile(f);
  }

  /** Asks for a file name, then downloads (see `save`). */
  function startDownload() {
    editor.endEdit();
    if (active()?.state.placements.length) setNaming(true);
  }

  async function save(filename: string) {
    const s = active();
    editor.endEdit();
    if (!s || !s.state.placements.length) return;
    setError("");
    s.setSaving(true);
    try {
      const images = new Map<string, Uint8Array>();
      for (const p of s.state.placements) {
        if (p.kind !== "image" || images.has(p.signatureId)) continue;
        const sig = editor.signature(p.signatureId);
        if (sig) images.set(p.signatureId, new Uint8Array(await sig.png.arrayBuffer()));
      }
      download(await stampPdf(s.bytes, s.state.placements, images), filename);
      editor.markSaved(s.state);
    } catch (err) {
      setError(`Couldn't save: ${err instanceof Error ? err.message : err}`);
    } finally {
      s.setSaving(false);
    }
  }

  /** Brings the tab before or after the active one to the front. */
  function stepTab(by: number) {
    const list = tabs();
    const at = list.findIndex((t) => t.key === activeKey());
    const next = list[(at + by + list.length) % list.length];
    if (next) void show(next.key);
  }

  function onKeyDown(e: KeyboardEvent) {
    const typing =
      e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    // Dialogs (new signature) handle their own keys.
    if (document.querySelector("dialog[open]")) return;
    const mod = e.ctrlKey || e.metaKey;
    const doc = active();

    // Tabs: Alt+1…9 jumps to a tab, Alt+[ and Alt+] step through them.
    // (Browsers keep Ctrl+Tab, Ctrl+W and Alt+arrows for themselves.)
    if (e.altKey && !mod) {
      if (/^Digit[1-9]$/.test(e.code)) {
        const tab = tabs()[Number(e.code.slice(5)) - 1];
        if (tab) {
          e.preventDefault();
          void show(tab.key);
        }
        return;
      }
      if (e.code === "BracketLeft" || e.code === "BracketRight") {
        e.preventDefault();
        stepTab(e.code === "BracketLeft" ? -1 : 1);
        return;
      }
    }

    // Ctrl/Cmd + O opens files (into a new tab, unless the one in front is empty).
    if (mod && !e.altKey && e.key.toLowerCase() === "o") {
      e.preventDefault();
      fileInput.click();
      return;
    }

    // Undo / redo placements. In text fields, the field's own undo applies.
    if (mod && !typing && doc) {
      const key = e.key.toLowerCase();
      if (key === "z" || key === "y") {
        e.preventDefault();
        if (key === "y" || e.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
    }

    // Arrow keys nudge the selected placement: 1 pt, or 10 pt with Shift.
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1], // display space has y up
      ArrowDown: [0, -1],
    };
    if (editor.selection().length && !typing && !mod && e.key in arrows) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      const step = e.shiftKey ? 10 : 1;
      editor.nudge(dx * step, dy * step);
      return;
    }

    // Delete / Escape act on the selected placement; Enter edits selected text.
    const selected = editor.selected();
    if (selected && !typing && !mod && e.key === "Enter" && editor.selectedText()) {
      e.preventDefault();
      editor.beginEdit(selected);
      return;
    }
    if (editor.selection().length && !typing && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      editor.removeSelected();
      return;
    }
    // Ctrl/Cmd + A selects everything on the current page.
    if (mod && !typing && doc && e.key.toLowerCase() === "a") {
      e.preventDefault();
      editor.selectAll(doc.page());
      return;
    }
    // Escape steps back: an edit finishes in its own field; then the selection clears; then back to Select.
    if (e.key === "Escape") {
      if (editor.selection().length) editor.select(null);
      else if (editor.tool() !== "select") editor.setTool("select");
      return;
    }

    // Tool shortcuts: V Select, H Hand, S Signatures, T Text, R Shapes.
    const tool = !typing && !mod && !e.altKey && doc ? toolForKey(e.key) : undefined;
    if (tool) {
      e.preventDefault();
      editor.setTool(tool);
      return;
    }

    // Ctrl/Cmd + plus, minus, 0 zoom the document instead of the browser UI.
    if (!(e.ctrlKey || e.metaKey) || !doc) return;
    if (e.key === "=" || e.key === "+") zoomTo(stepZoom(doc.zoom(), 1));
    else if (e.key === "-") zoomTo(stepZoom(doc.zoom(), -1));
    else if (e.key === "0") zoomTo(1);
    else return;
    e.preventDefault();
  }

  /** Brings back the tabs that were open last time, from their drafts; the one in front loads now, the rest when shown. */
  async function restoreTabs() {
    try {
      const saved = savedTabs();
      if (!saved.ids.length) return;
      const drafts = new Map((await draftStore.list()).map((d) => [d.id, d]));
      const back = saved.ids.flatMap((id) => {
        const d = drafts.get(id);
        return d ? [pendingTab(id, d.name)] : [];
      });
      // Something may have been opened (e.g. dropped) while drafts were being read.
      if (!back.length || tabs().some((t) => t.session)) return;
      setTabs(back);
      await show(back[Math.min(saved.active, back.length - 1)].key);
    } catch {
      // Drafts unavailable: start with an empty tab.
    } finally {
      restored = true;
      saveTabs(tabs(), activeKey());
    }
  }

  onMount(() => {
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("drop", endDrag, { capture: true });
    window.addEventListener("keydown", onKeyDown);
    // Arrow-key nudges in a row undo as one step; releasing the key ends the run.
    const onKeyUp = (e: KeyboardEvent) => e.key.startsWith("Arrow") && editor.endChange();
    window.addEventListener("keyup", onKeyUp);
    // Leaving or hiding the app saves every waiting draft straight away.
    const flushAll = () => sessions().forEach((s) => void s.autosave.flush());
    const onHide = () => document.visibilityState === "hidden" && flushAll();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushAll);
    // Closing or reloading with work in any tab not yet downloaded or in a draft asks first.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!sessions().some((s) => s.atRisk())) return;
      e.preventDefault();
      e.returnValue = ""; // older browsers need this as well
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    onCleanup(() => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushAll);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("drop", endDrag, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    });
    editor
      .loadLibrary()
      .catch((err) => setError(`Couldn't load saved signatures: ${err instanceof Error ? err.message : err}`))
      .finally(() => void restoreTabs());
  });

  return (
    <div class="app">
      <TabBar
        tabs={tabs()}
        activeKey={activeKey()}
        canAdd={!tabs().some(isEmptyTab)}
        onSelect={(k) => void show(k)}
        onClose={(k) => void closeTab(k)}
        onNew={newTab}
      />
      <header class="toolbar">
        {/* Used by the start screen's Open PDF… button and Ctrl/Cmd+O. */}
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = "";
            for (const f of files) await openFile(f);
          }}
        />

        <Show when={active()}>
          {(s) => {
            const base = () => s().name.replace(/\.pdf$/i, "");
            const ext = () => s().name.slice(base().length);
            const pages = () => s().pdf.pages.length;
            return (
              <div class="doc-title" title={s().name}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 2.5h8l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1-1.5z" />
                  <path d="M14 2.5V7.5h5M8.5 12.5h7M8.5 16h5" />
                </svg>
                <h1 class="doc-name">
                  <span class="doc-base">{base()}</span>
                  <span class="doc-ext">{ext()}</span>
                </h1>
                <span class="doc-meta">
                  {pages()} {pages() === 1 ? "page" : "pages"}
                </span>
              </div>
            );
          }}
        </Show>
        <span class="spacer" />
        <Show when={active()}>
          {(s) => (
            <>
              <span class="edit-actions">
                <button class="icon-button" title="Undo (Ctrl Z)" aria-label="Undo" disabled={!editor.canUndo()} onClick={() => editor.undo()}>
                  ↶
                </button>
                <button class="icon-button" title="Redo (Ctrl Shift Z)" aria-label="Redo" disabled={!editor.canRedo()} onClick={() => editor.redo()}>
                  ↷
                </button>
                <DownloadButton
                  title="Download a copy with your changes"
                  label={s().saving() ? "Saving…" : "Download PDF"}
                  disabled={!editor.placements.length || s().saving()}
                  onClick={startDownload}
                />
              </span>
              <span class="separator" aria-hidden="true" />
              <label class="page-nav">
                Page
                <input
                  type="number"
                  min="1"
                  max={s().pdf.pages.length}
                  value={s().page()}
                  onChange={(e) => viewer?.goToPage(Number(e.currentTarget.value))}
                />
                / {s().pdf.pages.length}
              </label>
              <span class="zoom">
                <button title="Zoom out (Ctrl −)" onClick={() => zoomTo(stepZoom(s().zoom(), -1))}>
                  −
                </button>
                <span class="zoom-value">{Math.round(s().zoom() * 100)}%</span>
                <button title="Zoom in (Ctrl +)" onClick={() => zoomTo(stepZoom(s().zoom(), 1))}>
                  +
                </button>
                <button title="Actual size (Ctrl 0)" onClick={() => zoomTo(1)}>
                  100%
                </button>
                <button onClick={() => viewer?.fitWidth()}>Fit width</button>
              </span>
            </>
          )}
        </Show>
      </header>

      <UpdatePrompt />
      <Show when={settings()}>
        <SettingsDialog onClose={() => setSettings(false)} onDraftsDeleted={() => sessions().forEach((s) => s.autosave.forget())} />
      </Show>

      <Show when={error()}>
        <div class="error" role="alert">
          {error()}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      </Show>
      <Show when={active()?.warning()}>
        <div class="error" role="alert">
          {active()!.warning()}
          <button onClick={() => active()?.setWarning("")}>Dismiss</button>
        </div>
      </Show>

      <Show when={naming() && active()}>
        {(s) => <DownloadDialog name={s().name} onDownload={(name) => void save(name)} onClose={() => setNaming(false)} />}
      </Show>

      <Show when={editor.creatingSignature()}>
        <NewSignatureDialog onClose={() => editor.setCreatingSignature(false)} />
      </Show>

      <Show when={active()?.offer()}>
        {(draft) => (
          <div class="restore" role="status">
            <span>
              You have unsaved work on this document from {formatSavedAt(draft().savedAt)} ({draft().placements.length}{" "}
              {draft().placements.length === 1 ? "item" : "items"}).
            </span>
            <button class="primary" onClick={() => active() && restore(active()!, draft())}>
              Restore
            </button>
            <button title="Your next change replaces the saved work" onClick={() => active()?.setOffer(null)}>
              Start over
            </button>
          </div>
        )}
      </Show>

      <div class="body">
        <Show when={active()}>
          {(s) => <Sidebar currentPage={s().page()} onError={setError} />}
        </Show>
        <main class="main">
          <Show
            when={active()}
            keyed
            fallback={
              <Show when={!activeTab()?.pending}>
                <div class="empty">
                  <p>Open a PDF to get started.</p>
                  <button class="primary" title="Open PDF (Ctrl O)" onClick={() => fileInput.click()}>
                    Open PDF…
                  </button>
                  <p class="hint">or drop files anywhere in this window</p>
                  <p class="hint">Your files stay on this device. Nothing is uploaded.</p>
                  <RecentDrafts
                    openIds={tabs().flatMap((t) => tabDocId(t) ?? [])}
                    onOpen={(d) => openDraft(d.id, d.name)}
                    onError={setError}
                  />
                </div>
              </Show>
            }
          >
            {(s) => (
              <Viewer
                pdf={s.pdf}
                zoom={s.zoom()}
                onZoom={(z) => s.setZoom(clampZoom(z))}
                onPageChange={s.setPage}
                api={(api) => (viewer = api)}
                scroll={s.scroll}
                onLeave={(pos) => (s.scroll = pos)}
              />
            )}
          </Show>
          <Show when={loading()}>
            <div class="overlay">Opening…</div>
          </Show>
          <Show when={dragging()}>
            <div class="overlay drop">Drop to open</div>
          </Show>
        </main>
        {/* Centred on the whole width below the top bar, so opening a panel doesn't move it. */}
        <Show when={active()}>
          <QuickBar active={editor.tool()} last={editor.lastPanelTool()} onSelect={(t) => editor.setTool(t)} />
        </Show>
      </div>
      <StatusBar
        hasDocument={!!active()}
        onGoToPage={(n) => viewer?.goToPage(n)}
        autosave={active()?.autosave.state()}
        onSettings={() => setSettings(true)}
      />
    </div>
  );
}
