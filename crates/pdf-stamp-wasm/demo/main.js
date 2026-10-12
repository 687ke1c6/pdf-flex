// Bare test page for the WASM build: pick a PDF and a signature, stamp, download.
import init, { stamp } from "./pkg/pdf_stamp_wasm.js";

const $ = (id) => document.getElementById(id);
const state = { pdf: null, pdfName: "", sig: null, aspect: null };

function status(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

function refresh() {
  $("go").disabled = !(state.pdf && state.sig);
  if (state.aspect) {
    const height = Number($("width").value) / state.aspect;
    $("height").textContent = `Height: ${height.toFixed(1)} pt (from the signature's aspect ratio)`;
  }
}

async function loadPdf(name, bytes) {
  state.pdf = bytes;
  state.pdfName = name;
  $("pdf-name").textContent = `${name} — ${(bytes.length / 1024).toFixed(1)} KB`;
  refresh();
}

async function loadSig(name, bytes) {
  // Decode in the browser just to learn the aspect ratio; Rust decodes it again for embedding.
  const bitmap = await createImageBitmap(new Blob([bytes]));
  state.sig = bytes;
  state.aspect = bitmap.width / bitmap.height;
  $("sig-name").textContent = `${name} — ${bitmap.width} × ${bitmap.height} px`;
  bitmap.close();
  refresh();
}

const readFile = async (file) => new Uint8Array(await file.arrayBuffer());
const fetchBytes = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer());

$("pdf").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) await loadPdf(file.name, await readFile(file));
});

$("sig").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) await loadSig(file.name, await readFile(file)).catch((err) => status(`Could not read image: ${err}`, true));
});

$("sample-sig").addEventListener("click", async () => loadSig("sample sig.png", await fetchBytes("samples/sig.png")));

$("sample-pdf").addEventListener("change", async (e) => {
  const name = e.target.value;
  if (name) await loadPdf(name, await fetchBytes(`samples/${name}`));
});

// Drag and drop anywhere on the page.
for (const type of ["dragenter", "dragover"]) {
  document.addEventListener(type, (e) => {
    e.preventDefault();
    $("drop").classList.add("over");
  });
}
document.addEventListener("dragleave", () => $("drop").classList.remove("over"));
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  $("drop").classList.remove("over");
  const file = [...e.dataTransfer.files].find((f) => f.type === "application/pdf" || f.name.endsWith(".pdf"));
  if (file) await loadPdf(file.name, await readFile(file));
  else status("That doesn't look like a PDF.", true);
});

$("width").addEventListener("input", refresh);

$("go").addEventListener("click", () => {
  const width = Number($("width").value);
  const placement = [Number($("page").value), Number($("x").value), Number($("y").value), width, width / state.aspect];
  try {
    const started = performance.now();
    const out = stamp(state.pdf, state.sig, new Float64Array(placement));
    const ms = (performance.now() - started).toFixed(1);
    download(out, state.pdfName.replace(/\.pdf$/i, "") + "-signed.pdf");
    status(`Stamped in ${ms} ms → ${(out.length / 1024).toFixed(1)} KB, downloaded.`);
  } catch (err) {
    status(`Error: ${err.message ?? err}`, true);
  }
});

function download(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  // Revoking in the same tick can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Startup: load the WASM, report its size, list the sample PDFs.
const wasmUrl = new URL("./pkg/pdf_stamp_wasm_bg.wasm", import.meta.url);
const started = performance.now();
await init({ module_or_path: wasmUrl });
const loadMs = (performance.now() - started).toFixed(0);
const size = (await fetch(wasmUrl, { method: "HEAD" })).headers.get("content-length");
status(`WASM ready: ${(size / 1024).toFixed(0)} KB, loaded in ${loadMs} ms.`);

const samples = await fetch("samples/index.json").then((r) => (r.ok ? r.json() : [])).catch(() => []);
for (const name of samples) $("sample-pdf").append(new Option(name, name));
