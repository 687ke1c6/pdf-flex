// "New signature" dialog: import an image, type a name in a script font, or draw. Saves to the library.
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { exportStrokes, drawStrokes, type Stroke } from "./drawing";
import { useEditor } from "./editor";
import { INK_COLORS, SCRIPT_FONTS, type ScriptFont } from "./fonts";
import { canvasToPng, cleanUp, DEFAULT_THRESHOLD, hasTransparency, toCanvas } from "./signatureImage";
import type { SignatureRecipe, SignatureSource } from "./signatureStore";
import { renderTyped } from "./typedSignature";

export type Tab = "import" | "type" | "draw";

/** What a tab has produced so far: the finished image, plus a suggested name. */
interface TabResult {
  canvas: HTMLCanvasElement;
  source: SignatureSource;
  name: string;
  recipe?: SignatureRecipe;
}

const TABS: { id: Tab; label: string }[] = [
  { id: "type", label: "Type" },
  { id: "draw", label: "Draw" },
  { id: "import", label: "Import" },
];

export function NewSignatureDialog(props: { initialTab?: Tab; onClose(): void }) {
  const editor = useEditor();
  let dialog!: HTMLDialogElement;
  let loadImport: ((file: File) => void) | undefined;

  const [tab, setTab] = createSignal<Tab>(props.initialTab ?? "type");
  // A plain signal, not a store: a store would wrap each result's recipe in a proxy, which IndexedDB can't clone.
  const [results, setResults] = createSignal<Partial<Record<Tab, TabResult | null>>>({});
  const setResult = (t: Tab, r: TabResult | null) => setResults((all) => ({ ...all, [t]: r }));
  const [name, setName] = createSignal("");
  const [nameEdited, setNameEdited] = createSignal(false);
  const [error, setError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const result = () => results()[tab()] ?? null;

  // Follow the active tab's suggested name until the user types their own.
  createEffect(() => {
    const suggested = result()?.name;
    if (!nameEdited() && suggested) setName(suggested);
  });

  onMount(() => dialog.showModal());

  async function save() {
    const r = result();
    if (!r) return;
    setError("");
    setSaving(true);
    try {
      await editor.addSignature({
        name: name().trim() || r.name || "Signature",
        source: r.source,
        png: await canvasToPng(r.canvas),
        width: r.canvas.width,
        height: r.canvas.height,
        recipe: r.recipe,
      });
      dialog.close();
    } catch (err) {
      setError(`Couldn't save: ${err instanceof Error ? err.message : err}`);
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      class="dialog"
      onClose={() => props.onClose()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        // Dropping an image anywhere on the dialog imports it.
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer?.files[0];
        if (file) {
          setTab("import");
          loadImport?.(file);
        }
      }}
    >
      <h2>New signature</h2>
      <div class="tabs" role="tablist">
        <For each={TABS}>
          {(t) => (
            <button role="tab" aria-selected={tab() === t.id} classList={{ active: tab() === t.id }} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          )}
        </For>
      </div>

      {/* All tabs stay mounted so switching doesn't lose work. */}
      <div role="tabpanel" hidden={tab() !== "type"}>
        <TypeTab onResult={(r) => setResult("type", r)} />
      </div>
      <div role="tabpanel" hidden={tab() !== "draw"}>
        <DrawTab onResult={(r) => setResult("draw", r)} />
      </div>
      <div role="tabpanel" hidden={tab() !== "import"}>
        <ImportTab onResult={(r) => setResult("import", r)} api={(load) => (loadImport = load)} />
      </div>

      <label class="row">
        Name
        <input
          type="text"
          value={name()}
          placeholder="Signature"
          onInput={(e) => {
            setName(e.currentTarget.value);
            setNameEdited(true);
          }}
        />
      </label>

      <Show when={error()}>
        <p class="dialog-error">{error()}</p>
      </Show>

      <div class="dialog-actions">
        <button onClick={() => dialog.close()}>Cancel</button>
        <button class="primary" disabled={!result() || saving()} onClick={save}>
          {saving() ? "Saving…" : "Save to library"}
        </button>
      </div>
    </dialog>
  );
}

function ColorPicker(props: { value: string; onChange(color: string): void }) {
  return (
    <div class="row">
      Ink
      <For each={INK_COLORS}>
        {(c) => (
          <button
            class="swatch"
            classList={{ active: props.value === c.value }}
            style={{ "--swatch": c.value }}
            title={c.name}
            aria-label={`${c.name} ink`}
            aria-pressed={props.value === c.value}
            onClick={() => props.onChange(c.value)}
          />
        )}
      </For>
    </div>
  );
}

// --- Type ---

function TypeTab(props: { onResult(r: TabResult | null): void }) {
  const [text, setText] = createSignal("");
  const [font, setFont] = createSignal<ScriptFont>(SCRIPT_FONTS[0]);
  const [color, setColor] = createSignal<string>(INK_COLORS[0].value);

  createEffect(() => {
    const [value, family, ink] = [text().trim(), font(), color()];
    let stale = false;
    onCleanup(() => (stale = true));
    void renderTyped(value, family, ink).then((canvas) => {
      if (stale) return;
      props.onResult(
        canvas ? { canvas, source: "typed", name: value, recipe: { kind: "typed", text: value, font: family, color: ink } } : null,
      );
    });
  });

  return (
    <>
      <label class="row">
        Your name
        <input type="text" value={text()} placeholder="Type your name" onInput={(e) => setText(e.currentTarget.value)} autofocus />
      </label>
      <div class="font-options" role="radiogroup" aria-label="Font">
        <For each={SCRIPT_FONTS}>
          {(family) => (
            <button
              role="radio"
              aria-checked={font() === family}
              classList={{ active: font() === family }}
              style={{ "font-family": `"${family}", cursive`, color: color() }}
              title={family}
              onClick={() => setFont(family)}
            >
              {text().trim() || "Your Name"}
            </button>
          )}
        </For>
      </div>
      <ColorPicker value={color()} onChange={setColor} />
    </>
  );
}

// --- Draw ---

/** Height of the drawing pad in CSS pixels; its width follows the dialog. */
const PAD_HEIGHT = 200;

function DrawTab(props: { onResult(r: TabResult | null): void }) {
  let pad!: HTMLCanvasElement;
  // Strokes are mutated in place while drawing; `count` drives the buttons.
  let strokes: Stroke[] = [];
  const [count, setCount] = createSignal(0);
  const [color, setColor] = createSignal<string>(INK_COLORS[0].value);

  function redraw() {
    const ctx = pad.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pad.width, pad.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStrokes(ctx, strokes, color());
  }

  function emit() {
    setCount(strokes.length);
    const canvas = exportStrokes(strokes, pad.clientWidth, PAD_HEIGHT, color());
    props.onResult(
      canvas
        ? {
            canvas,
            source: "drawn",
            name: "Drawn signature",
            recipe: { kind: "drawn", strokes: structuredClone(strokes), width: pad.clientWidth, height: PAD_HEIGHT, color: color() },
          }
        : null,
    );
  }

  onMount(() => {
    // Size the backing store to the pad's CSS size at device resolution. The pad starts in a
    // hidden tab (zero width), so this runs again when it becomes visible.
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      pad.width = Math.round(pad.clientWidth * dpr);
      pad.height = Math.round(PAD_HEIGHT * dpr);
      redraw();
    });
    observer.observe(pad);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    color();
    if (strokes.length) {
      redraw();
      emit();
    }
  });

  function point(e: PointerEvent) {
    const rect = pad.getBoundingClientRect();
    // Only pens report real pressure; mice report 0.5 while pressed, touch varies by device.
    const p = e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, p };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    strokes.push([point(e)]);
    redraw();
  }

  function onPointerMove(e: PointerEvent) {
    if (!pad.hasPointerCapture(e.pointerId)) return;
    const stroke = strokes[strokes.length - 1];
    // Coalesced events give every sample since the last frame, for smoother fast strokes.
    for (const ev of e.getCoalescedEvents?.() ?? [e]) stroke.push(point(ev));
    redraw();
  }

  function onPointerUp(e: PointerEvent) {
    if (!pad.hasPointerCapture(e.pointerId)) return;
    pad.releasePointerCapture(e.pointerId);
    emit();
  }

  return (
    <>
      <div class="pad-wrap">
        <canvas
          ref={pad}
          class="pad"
          style={{ height: `${PAD_HEIGHT}px` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        <div class="pad-baseline" />
        <Show when={!count()}>
          <span class="pad-hint">Sign here with your mouse, trackpad, finger or pen</span>
        </Show>
      </div>
      <div class="row">
        <ColorPicker value={color()} onChange={setColor} />
        <span class="spacer" />
        <button
          disabled={!count()}
          onClick={() => {
            strokes.pop();
            redraw();
            emit();
          }}
        >
          Undo stroke
        </button>
        <button
          disabled={!count()}
          onClick={() => {
            strokes = [];
            redraw();
            emit();
          }}
        >
          Clear
        </button>
      </div>
    </>
  );
}

// --- Import ---

function ImportTab(props: { onResult(r: TabResult | null): void; api(load: (file: File) => void): void }) {
  let preview!: HTMLCanvasElement;
  let input!: HTMLInputElement;

  const [source, setSource] = createSignal<HTMLCanvasElement | null>(null);
  const [fileName, setFileName] = createSignal("");
  const [removeBackground, setRemoveBackground] = createSignal(true);
  const [threshold, setThreshold] = createSignal(DEFAULT_THRESHOLD);
  const [empty, setEmpty] = createSignal(false);
  const [error, setError] = createSignal("");

  async function load(file: File) {
    setError("");
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = toCanvas(bitmap);
      bitmap.close();
      // Already transparent (e.g. a prepared PNG): leave it alone by default.
      setRemoveBackground(!hasTransparency(canvas));
      setFileName(file.name.replace(/\.[^.]+$/, ""));
      setSource(canvas);
    } catch {
      setError(`Couldn't read ${file.name} as an image. Use a PNG or JPEG.`);
    }
  }
  props.api((file) => void load(file));

  // Re-process on any option change, at most once per frame while the slider moves.
  createEffect(() => {
    const src = source();
    const options = { removeBackground: removeBackground(), threshold: threshold() };
    if (!src) return;
    const frame = requestAnimationFrame(() => {
      const out = cleanUp(src, options);
      setEmpty(!out);
      if (out) {
        preview.width = out.width;
        preview.height = out.height;
        preview.getContext("2d")!.drawImage(out, 0, 0);
      }
      props.onResult(out ? { canvas: out, source: "import", name: fileName() } : null);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void load(file);
        }}
      />
      <Show
        when={source()}
        fallback={
          <div class="dropzone">
            <button class="primary" onClick={() => input.click()}>
              Choose image…
            </button>
            <p class="hint">or drop a PNG or JPEG here. A photo or scan of your signature on white paper works.</p>
          </div>
        }
      >
        <div class="preview checkerboard">
          <canvas ref={preview} hidden={empty()} />
          <Show when={empty()}>
            <p class="hint">Nothing left. Lower the threshold.</p>
          </Show>
        </div>
        <label class="row">
          <input type="checkbox" checked={removeBackground()} onChange={(e) => setRemoveBackground(e.currentTarget.checked)} />
          Remove background
        </label>
        <label class="row" classList={{ disabled: !removeBackground() }}>
          Threshold
          <input
            type="range"
            min="60"
            max="250"
            value={threshold()}
            disabled={!removeBackground()}
            onInput={(e) => setThreshold(Number(e.currentTarget.value))}
          />
        </label>
        <p class="hint">Raise the threshold to remove a greyer background; lower it if strokes are fading.</p>
        <button class="link" onClick={() => input.click()}>
          Choose a different image…
        </button>
      </Show>
      <Show when={error()}>
        <p class="dialog-error">{error()}</p>
      </Show>
    </>
  );
}
